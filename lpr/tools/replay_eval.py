"""Replay of recorded clips through the worker's decision path, scored against a ground truth.

Why it exists: the LPR is tuned with real footage from the gate camera, and that
tuning (sampling rate, detector resolution, crop filter, zone, N readings per
vehicle) used to live in throwaway scripts that duplicated the production logic.
This tool runs the SAME code as `LprWorker._process_frame`
(`pipeline.process_frame`: zone-aware detection -> shape filter -> OCR -> plate
format -> tracker + vote) frame by frame, without any POST, and counts how many
plates came out right, WRONG (the serious one: a wrong plate can open a gate or
register a stranger), or not at all.

Usage (from the repo root):

    python -m lpr.tools.replay_eval --clips lpr/eval-data/clips --gt lpr/eval-data/gt.csv \\
        --imgsz 1920 --fps 8 --confirm 3 --crop 60,250,0.8,6 --device cuda:0

    # with a detection zone (normalized x,y points; ';' between points, '|' between polygons)
    python -m lpr.tools.replay_eval ... --zone "0.36,0.33;0.90,0.33;0.90,0.98;0.36,0.98"

    # with a direction line (from;to;exitSide): the vehicle tracker (ByteTrack) runs and the
    # report splits the direction score by source (line / motion / width / none)
    python -m lpr.tools.replay_eval ... --direction-line "0.45,0.60;0.85,0.60;left"

Ground truth CSV (UTF-8, header required; extra columns are ignored):

    clip,t_inicio_s,t_fin_s,patente_real,certeza[,entra_sale]

* `clip`: an identifier contained in the clip file name (split on '-', e.g. `162139`).
* `t_inicio_s`/`t_fin_s`: window, in video seconds, in which the vehicle is visible.
* `patente_real`: the true plate; `certeza`: `alta`/`media` rows are real plates that
  count for the score; `no-placa` (detector false positive) and `ilegible` rows are
  not scored, but an emission that lands in one is reported as a false emission.
* `entra_sale` (optional): `entra`/`sale`, to score the inferred direction.

PERSONAL DATA: clips, ground truth and the emissions JSON contain plates and people
(Ley 21.719). They live OUTSIDE version control: `lpr/eval-data/` (and any video
file under `lpr/`) is git-ignored. The report masks plates (`AB**12`) unless you
pass `--show-plates`; do not commit them or paste real plates into documents.

Exit code: 0, or 2 when at least one WRONG plate was emitted (usable as a CI/regression gate).
"""
import argparse
import csv
import json
import logging
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from lpr.utils.pii import mask_plate

REAL_CERTAINTIES = ('alta', 'media')
# Local, git-ignored directory for clips, ground truth and outputs (personal data).
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / 'eval-data'
DIRECTION_BY_GT = {'entra': 'entry', 'sale': 'exit'}


# --------------------------------------------------------------------------
# Ground truth and scoring (pure: testable without video or models)
# --------------------------------------------------------------------------
@dataclass
class GtRow:
    clip: str
    t0: float
    t1: float
    plate: str
    certainty: str
    direction: str = ''  # 'entry' | 'exit' | ''

    @property
    def real(self) -> bool:
        return self.certainty in REAL_CERTAINTIES


def load_gt(path: Path) -> List[GtRow]:
    rows: List[GtRow] = []
    with Path(path).open(encoding='utf-8-sig', newline='') as fh:
        for raw in csv.DictReader(fh):
            t0 = raw.get('t_inicio_s', raw.get('t_inicio'))
            t1 = raw.get('t_fin_s', raw.get('t_fin'))
            rows.append(GtRow(
                clip=str(raw['clip']).strip(),
                t0=float(t0), t1=float(t1),
                plate=str(raw.get('patente_real', '')).strip().upper(),
                certainty=str(raw.get('certeza', '')).strip().lower(),
                direction=DIRECTION_BY_GT.get(str(raw.get('entra_sale', '')).strip().lower(), ''),
            ))
    return rows


@dataclass
class Emission:
    clip: str
    t: float
    text: str
    direction: str = 'unknown'
    reads: int = 0
    votes: int = 0
    direction_source: str = 'none'
    vehicle_id: Optional[int] = None


@dataclass
class Score:
    n_real: int = 0
    correct: int = 0
    wrong: int = 0          # real rows with at least one wrong emission (the serious metric)
    missed: int = 0         # real rows without any emission
    extra: int = 0          # emissions outside a real window (no-placa / ilegible / orphan)
    latencies: List[float] = field(default_factory=list)
    direction_ok: int = 0
    direction_total: int = 0
    direction_wrong: int = 0      # called the OPPOSITE way (the serious one)
    direction_unknown: int = 0    # said 'unknown'
    # source -> {'ok': n, 'wrong': n, 'unknown': n}
    direction_by_source: Dict[str, Dict[str, int]] = field(default_factory=dict)
    wrong_detail: List[str] = field(default_factory=list)
    extra_detail: List[str] = field(default_factory=list)


def score(emissions: Sequence[Emission], gt: Sequence[GtRow], margin: float = 1.0,
          show_plates: bool = False) -> Score:
    """Attribute each emission to a GT window (± `margin` s) and score it.

    An emission whose text equals the plate of any real row covering its time is
    correct for that row. Otherwise, if real rows cover it, it is WRONG for the
    closest of them. Without a covering real row it is an extra emission (a
    `no-placa` false positive, an illegible plate, or nothing at all).
    The detail lines mask the plates unless `show_plates` (they end up in
    terminals and shared logs).
    """
    shown = (lambda p: p) if show_plates else mask_plate
    result = Score()
    real = [r for r in gt if r.real]
    result.n_real = len(real)
    per_row: Dict[int, List[Emission]] = {id(r): [] for r in real}
    wrong_rows = set()
    for em in emissions:
        covering = [r for r in real if r.clip == em.clip and r.t0 - margin <= em.t <= r.t1 + margin]
        match = next((r for r in covering if r.plate == em.text), None)
        if match is not None:
            per_row[id(match)].append(em)
        elif covering:
            nearest = min(covering, key=lambda r: abs((r.t0 + r.t1) / 2 - em.t))
            wrong_rows.add(id(nearest))
            result.wrong_detail.append(f'{em.clip} t={em.t:.1f}s leyó {shown(em.text)} (esperada {shown(nearest.plate)})')
        else:
            result.extra += 1
            result.extra_detail.append(f'{em.clip} t={em.t:.1f}s {shown(em.text)}')
    result.wrong = len(wrong_rows)
    for r in real:
        hits = per_row[id(r)]
        if hits:
            result.correct += 1
            first = min(hits, key=lambda e: e.t)
            result.latencies.append(first.t - r.t0)
            if r.direction:
                result.direction_total += 1
                bucket = result.direction_by_source.setdefault(
                    first.direction_source, {'ok': 0, 'wrong': 0, 'unknown': 0})
                if first.direction == r.direction:
                    result.direction_ok += 1
                    bucket['ok'] += 1
                elif first.direction in ('entry', 'exit'):
                    result.direction_wrong += 1
                    bucket['wrong'] += 1
                else:
                    result.direction_unknown += 1
                    bucket['unknown'] += 1
        elif id(r) not in wrong_rows:
            result.missed += 1
    return result


# --------------------------------------------------------------------------
# Parsing of CLI values
# --------------------------------------------------------------------------
def parse_zone(text: Optional[str]) -> Optional[List[List[Dict[str, float]]]]:
    """'x,y;x,y;x,y|x,y;...' -> list of normalized polygons."""
    if not text:
        return None
    polygons = []
    for chunk in text.split('|'):
        points = []
        for pair in chunk.split(';'):
            x, y = pair.split(',')
            points.append({'x': float(x), 'y': float(y)})
        if len(points) < 3:
            raise ValueError('a zone polygon needs at least 3 points')
        polygons.append(points)
    return polygons


def parse_direction_line(text: Optional[str]) -> Optional[Dict[str, Any]]:
    """'fx,fy;tx,ty;left|right' -> `lprSettings.directionLine` (normalized 0-1)."""
    if not text:
        return None
    parts = [p.strip() for p in text.split(';')]
    if len(parts) != 3:
        raise ValueError('--direction-line expects "fx,fy;tx,ty;left|right"')
    fx, fy = (float(v) for v in parts[0].split(','))
    tx, ty = (float(v) for v in parts[1].split(','))
    line = {'from': {'x': fx, 'y': fy}, 'to': {'x': tx, 'y': ty}, 'exitSide': parts[2]}
    from lpr.utils.direction import DirectionLine
    if DirectionLine.from_settings(line) is None:
        raise ValueError('--direction-line is not a valid directionLine (0-1 coords, length >= 0.05, left|right)')
    return line


def parse_crop(text: Optional[str]) -> Dict[str, Any]:
    """'minW,maxW,minRatio,maxRatio' (maxW empty or 'none' = no cap) -> WorkerConfig fields."""
    if not text:
        return {}
    parts = [p.strip() for p in text.split(',')]
    if len(parts) != 4:
        raise ValueError('--crop expects minW,maxW,minRatio,maxRatio')
    max_w = None if parts[1].lower() in ('', 'none', '0') else int(parts[1])
    return {'min_crop_w': int(parts[0]), 'max_crop_w': max_w,
            'min_crop_ratio': float(parts[2]), 'max_crop_ratio': float(parts[3])}


def clip_matches(gt_clip: str, path: Path) -> bool:
    """A GT `clip` token identifies a file when it is one of the '-' separated parts of its stem."""
    return gt_clip in path.stem.split('-')


# --------------------------------------------------------------------------
# Video + replay (needs OpenCV and, for the real run, the models)
# --------------------------------------------------------------------------
def iter_sampled_frames(path: Path, fps: float) -> Iterator[Tuple[float, np.ndarray]]:
    """Yield (video_time_s, BGR frame) sampled at ~`fps` from the native stream."""
    import cv2

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f'cannot open {path}')
    native = cap.get(cv2.CAP_PROP_FPS) or 8.0
    step = 1.0 / fps
    next_t = 0.0
    index = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                return
            t = index / native
            index += 1
            if t + 1e-6 >= next_t:
                next_t += step
                if next_t <= t:  # skipped frames (fps above native): resync
                    next_t = t + step
                yield t, frame
    finally:
        cap.release()


def save_evidence(emission: Any, directory: Path, clip: str, t: float) -> Path:
    """Evidence picture of an emission, as the worker saves it: the frame of the
    best reading with the yellow box of THAT reading. Contains the real plate and
    people: only to a local, git-ignored folder."""
    import cv2

    directory.mkdir(parents=True, exist_ok=True)
    image = emission.evidence.copy()
    x1, y1, x2, y2 = (int(v) for v in emission.box)
    cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 255), 3)
    out = directory / f'{clip}-t{t:.1f}-{emission.direction}-{emission.direction_source}.jpg'
    cv2.imwrite(str(out), image)
    return out


def replay_clip(path: Path, cfg: Any, detector: Any, ocr: Any,
                vehicle_tracker: Any = None, evidence_dir: Optional[Path] = None
                ) -> Tuple[List[Emission], List[float]]:
    """Run one clip through `pipeline.process_frame`; returns emissions and ms per frame.

    `vehicle_tracker` must be FRESH per clip (ByteTrack keeps ids between calls).
    Confirmed plates still waiting for their direction when the clip ends are
    flushed (a live track would close on its own)."""
    from lpr.processor.pipeline import make_tracker, process_frame

    tracker = make_tracker(cfg)
    emissions: List[Emission] = []
    timings: List[float] = []
    last_t = 0.0

    def _collect(t: float, found: Sequence[Any]) -> None:
        for em in found:
            if evidence_dir is not None and getattr(em, 'evidence', None) is not None:
                save_evidence(em, evidence_dir, path.stem.split('-')[3] if path.stem.count('-') >= 3 else path.stem, t)
            emissions.append(Emission(clip=path.stem, t=t, text=em.text, direction=em.direction,
                                      reads=em.reads, votes=em.votes,
                                      direction_source=em.direction_source, vehicle_id=em.vehicle_id))

    for t, frame in iter_sampled_frames(path, cfg.sample_fps):
        last_t = t
        started = time.perf_counter()
        _reads, found = process_frame(frame, detector, ocr, cfg, tracker, t, vehicle_tracker=vehicle_tracker)
        timings.append((time.perf_counter() - started) * 1000.0)
        _collect(t, found)
    _collect(last_t, tracker.flush())
    return emissions, timings


def build_cfg(args: argparse.Namespace) -> Any:
    from lpr.settings import WorkerConfig, build_worker_config

    base = build_worker_config('rtsp://offline', 'eval', 'http://127.0.0.1:9/api/v1', None)
    overrides: Dict[str, Any] = {
        'dry_run': True,
        'sample_fps': args.fps, 'poll_interval': 1.0 / args.fps,
        'detector_imgsz': args.imgsz, 'confirm_reads': args.confirm,
        'direction': args.direction, 'zone': parse_zone(args.zone),
        'direction_line': parse_direction_line(args.direction_line),
        'min_det_conf': args.det_conf,
    }
    if args.zone_file:
        overrides['zone'] = json.loads(Path(args.zone_file).read_text(encoding='utf-8'))
    if args.device:
        overrides['device'] = args.device
    if args.ocr_device:
        overrides['ocr_device'] = args.ocr_device
    overrides.update(parse_crop(args.crop))
    return WorkerConfig.model_validate({**base.model_dump(), **overrides})


def format_report(label: str, cfg: Any, sc: Score, ms_frame: float, n_frames: int, n_emissions: int) -> str:
    lat = sc.latencies
    lines = [
        f'== {label}: imgsz={cfg.detector_imgsz} fps={cfg.sample_fps:g} N={cfg.confirm_reads} '
        f'crop=[{cfg.min_crop_w},{cfg.max_crop_w},{cfg.min_crop_ratio:g},{cfg.max_crop_ratio:g}] '
        f'zona={"si" if cfg.zone else "no"} direccion={cfg.direction} '
        f'linea={"si" if getattr(cfg, "direction_line", None) else "no"}',
        f'   reales={sc.n_real}  correctas={sc.correct}  INCORRECTAS={sc.wrong}  sin_lectura={sc.missed}  '
        f'emisiones_extra={sc.extra}  (emisiones totales={n_emissions})',
        f'   latencia (s desde inicio de la pasada): '
        + (f'mediana={statistics.median(lat):.2f} max={max(lat):.2f}' if lat else 'n/a'),
        f'   ms/frame={ms_frame:.1f} sobre {n_frames} frames muestreados',
    ]
    if sc.direction_total:
        lines.append(f'   direccion correcta: {sc.direction_ok}/{sc.direction_total}  '
                     f'EQUIVOCADA={sc.direction_wrong}  unknown={sc.direction_unknown}')
        for source in sorted(sc.direction_by_source):
            b = sc.direction_by_source[source]
            lines.append(f'     fuente {source}: correcta={b["ok"]} equivocada={b["wrong"]} unknown={b["unknown"]}')
    lines += [f'   INCORRECTA: {d}' for d in sc.wrong_detail]
    lines += [f'   extra: {d}' for d in sc.extra_detail]
    return '\n'.join(lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description='Replay clips through the LPR worker pipeline and score them.')
    ap.add_argument('--clips', required=True, help='directory with the clips (*.mkv, *.mp4, *.avi)')
    ap.add_argument('--gt', required=True, help='ground truth CSV')
    ap.add_argument('--imgsz', type=int, default=640, help='detector input size (default 640 = production default)')
    ap.add_argument('--fps', type=float, default=1.0, help='sampling rate (default 1 = production default)')
    ap.add_argument('--confirm', type=int, default=3, help='N readings per vehicle')
    ap.add_argument('--crop', help='minW,maxW,minRatio,maxRatio (default: worker defaults)')
    ap.add_argument('--zone', help='normalized polygons: "x,y;x,y;x,y|x,y;..."')
    ap.add_argument('--zone-file', help='JSON file with the zone (same shape as lprSettings.zone)')
    ap.add_argument('--direction', default='both', choices=['entry', 'exit', 'both', 'unknown'])
    ap.add_argument('--direction-line', help='"fx,fy;tx,ty;left|right" (normalized): runs the vehicle tracker; '
                    'exitSide = side the vehicle moves to when EXITING, looking from "from" to "to"')
    ap.add_argument('--device', help='detector device (cuda:0, cpu); default: ultralytics auto')
    ap.add_argument('--ocr-device', default=None, help='OCR device (default: LPR_OCR_DEVICE)')
    ap.add_argument('--det-conf', type=float, default=0.3, help='min detector confidence (default 0.3)')
    ap.add_argument('--margin', type=float, default=1.0, help='seconds of tolerance around each GT window')
    ap.add_argument('--only', help='only clips whose name contains this text')
    ap.add_argument('--label', default='config')
    ap.add_argument('--out-json', help='write the emissions (real plates!) to this JSON file; default: '
                    'lpr/eval-data/replay-<label>.json, which is git-ignored')
    ap.add_argument('--save-evidence', help='folder where to save the evidence picture of every emission '
                    '(frame of the best reading + its box; contains real plates: keep it outside the repo)')
    ap.add_argument('--show-plates', action='store_true',
                    help='print real plates in the report (default: masked)')
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.WARNING)
    from lpr.detector.yolo_detector import detect, load_detector
    from lpr.ocr.fast_ocr_adapter import FastPlateOCR
    from lpr.settings import settings

    cfg = build_cfg(args)
    gt = load_gt(Path(args.gt))
    clips = sorted(p for ext in ('*.mkv', '*.mp4', '*.avi') for p in Path(args.clips).glob(ext)
                   if not args.only or args.only in p.name)
    if not clips:
        print('no clips found', file=sys.stderr)
        return 1

    model = load_detector(cfg.detector_model)
    ocr = FastPlateOCR(device=cfg.ocr_device)
    detector = lambda frame, min_conf=cfg.min_det_conf, imgsz=None: detect(  # noqa: E731
        model, frame, min_conf, imgsz=imgsz or cfg.detector_imgsz, device=cfg.device)

    from lpr.processor.pipeline import make_tracker, process_frame, wants_vehicle_tracking
    from lpr.processor.vehicle_tracker import VehicleTracker
    use_vehicles = wants_vehicle_tracking(cfg)

    def new_vehicle_tracker() -> Any:
        return VehicleTracker(model_ref=settings.LPR_VEHICLE_MODEL or None, device=cfg.device) if use_vehicles else None

    # Warm-up (CUDA context, model load) so it does not count as ms/frame.
    warm_t, warm_frame = next(iter_sampled_frames(clips[0], cfg.sample_fps))
    process_frame(warm_frame, detector, ocr, cfg, make_tracker(cfg), warm_t, vehicle_tracker=new_vehicle_tracker())

    emissions: List[Emission] = []
    timings: List[float] = []
    for clip in clips:
        found, ms = replay_clip(clip, cfg, detector, ocr, vehicle_tracker=new_vehicle_tracker(),
                                evidence_dir=Path(args.save_evidence) if args.save_evidence else None)
        emissions += found
        timings += ms
    clip_gt = [r for r in gt if any(clip_matches(r.clip, c) for c in clips)]
    # Emissions carry the file stem; normalize to the GT token for matching.
    for em in emissions:
        stem_parts = em.clip.split('-')
        em.clip = next((r.clip for r in clip_gt if r.clip in stem_parts), em.clip)
    sc = score(emissions, clip_gt, args.margin, show_plates=args.show_plates)
    print(format_report(args.label, cfg, sc, statistics.mean(timings) if timings else 0.0,
                        len(timings), len(emissions)))
    out_path = Path(args.out_json) if args.out_json else DEFAULT_DATA_DIR / f'replay-{args.label}.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps([e.__dict__ for e in emissions], ensure_ascii=False, indent=2), encoding='utf-8')
    return 2 if sc.wrong else 0


if __name__ == '__main__':
    sys.exit(main())
