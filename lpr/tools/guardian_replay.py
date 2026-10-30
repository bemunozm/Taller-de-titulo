"""Replay de clips por el camino de decisión del Guardián, puntuado contra una verdad terreno.

Para qué sirve: afinar y comparar las reglas del Guardián (intrusión / merodeo) con
grabaciones reales, sin cámara ni backend. Corre EXACTAMENTE el mismo código que
`GuardianWorker._process_frame` (`GuardianPipeline.process`: motion gating con
retención -> YOLO track clase 0 con ByteTrack -> `GuardianRules`) cuadro a cuadro,
con el reloj = tiempo del video, y cuenta aciertos, falsas alarmas, omitidos y
alertas duplicadas por el mismo evento.

Uso (desde la raíz del repo):

    python -m lpr.tools.guardian_replay --clips lpr/eval-data/guardian --gt lpr/eval-data/guardian-gt.csv \\
        --fps 1 --imgsz 960 --device cuda:0 --zone-file zonas.json --label despues

    # línea base "antes": las reglas ACTUALES de main (merodeo ciego a las zonas,
    # cooldown solo por track_id, sin re-enlace, gating sin retención)
    python -m lpr.tools.guardian_replay ... --rules legacy --label antes

Verdad terreno (CSV UTF-8, encabezado obligatorio, columnas extra se ignoran):

    clip,t_inicio_s,t_fin_s,evento,zona,personas

* `clip`: token contenido en el nombre del archivo (separado por '-'), como en replay_eval.
* `t_inicio_s`/`t_fin_s`: ventana (segundos de video) en que ocurre el evento.
* `evento`: `intrusion`, `loitering` o `ninguno` (ventana en que NO debe haber alerta).
* `zona`: informativa (índice o nombre de la zona).
* `personas`: cuántas personas protagonizan el evento (default 1); una alerta por
  persona es lo ideal, las demás cuentan como duplicadas.

`--zone-file`: JSON con `guardianZones` en formato legacy (lista de polígonos) o
nuevo (`[{points, type, loiterSeconds}]`), o la respuesta completa
`{enableGuardian, guardianZones}` del backend.

DATOS PERSONALES: los clips y la verdad terreno muestran personas (Ley 21.719). Viven
FUERA del control de versiones (`lpr/eval-data/` está en .gitignore). El replay no
guarda imágenes; el JSON de salida solo lleva tiempos, tipos e ids.

Código de salida: 0 siempre que corra (es una herramienta de medición, no una compuerta).
"""
import argparse
import csv
import json
import logging
import re
import statistics
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from lpr.processor.guardian_rules import (
    ANOMALY_INTRUSION,
    ANOMALY_LOITERING,
    GuardianConfig,
    GuardianRules,
    LegacyRules,
    max_gap_for_poll_interval,
    parse_guardian_zones,
)
from lpr.tools.replay_eval import clip_matches, iter_sampled_frames

EVENT_NONE = 'ninguno'
EVENT_TYPES = (ANOMALY_INTRUSION, ANOMALY_LOITERING)
VALID_EVENTS = EVENT_TYPES + (EVENT_NONE,)
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / 'eval-data'


# --------------------------------------------------------------------------
# Verdad terreno y puntaje (puros: se prueban sin video ni modelos)
# --------------------------------------------------------------------------
@dataclass
class GtRow:
    clip: str
    t0: float
    t1: float
    event: str          # 'intrusion' | 'loitering' | 'ninguno'
    zone: str = ''
    people: int = 1


@dataclass
class Alert:
    clip: str
    t: float
    type: str
    track_id: int = -1
    zone_index: int = -1
    conf: float = 0.0


def _parse_people(value: Any) -> int:
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        return 1
    return n if n >= 1 else 1


def load_gt(path: Path) -> List[GtRow]:
    rows: List[GtRow] = []
    with Path(path).open(encoding='utf-8-sig', newline='') as fh:
        for line_no, raw in enumerate(csv.DictReader(fh), start=2):
            event = str(raw.get('evento', '')).strip().lower()
            if event not in VALID_EVENTS:
                raise ValueError(f'{path}:{line_no}: evento "{event}" no válido (usa {", ".join(VALID_EVENTS)})')
            t0 = float(raw.get('t_inicio_s', raw.get('t_inicio')))
            t1 = float(raw.get('t_fin_s', raw.get('t_fin')))
            if t1 < t0:
                raise ValueError(f'{path}:{line_no}: t_fin_s < t_inicio_s')
            rows.append(GtRow(clip=str(raw['clip']).strip(), t0=t0, t1=t1, event=event,
                              zone=str(raw.get('zona', '')).strip(), people=_parse_people(raw.get('personas', 1))))
    return rows


@dataclass
class Score:
    n_events: int = 0                 # filas intrusion/loitering
    hits: int = 0
    missed: int = 0
    false_alarms: int = 0
    duplicates: int = 0               # alertas de más sobre un evento acertado
    alerts_total: int = 0
    alerts_by_type: Dict[str, int] = field(default_factory=dict)
    hits_by_type: Dict[str, int] = field(default_factory=dict)
    missed_by_type: Dict[str, int] = field(default_factory=dict)
    latencies: List[float] = field(default_factory=list)   # primera alerta - t_inicio
    missed_detail: List[str] = field(default_factory=list)
    false_detail: List[str] = field(default_factory=list)
    duplicate_detail: List[str] = field(default_factory=list)


def score(alerts: Sequence[Alert], gt: Sequence[GtRow], margin: float = 2.0) -> Score:
    """Atribuye cada alerta a una fila de la verdad terreno del MISMO tipo y clip
    cuya ventana (± `margin` s) la cubra.

    * acierto: fila de evento con al menos una alerta atribuida; su latencia es
      la primera alerta menos `t_inicio_s`.
    * duplicadas: alertas atribuidas a la fila por encima de `personas`.
    * falsa alarma: alerta que no cae en ninguna fila de su tipo (incluye las que
      caen en una ventana `ninguno` o en una fila de OTRO tipo).
    * omitido: fila de evento sin ninguna alerta.
    """
    sc = Score()
    events = [r for r in gt if r.event in EVENT_TYPES]
    sc.n_events = len(events)
    per_row: Dict[int, List[Alert]] = {id(r): [] for r in events}
    for a in alerts:
        sc.alerts_total += 1
        sc.alerts_by_type[a.type] = sc.alerts_by_type.get(a.type, 0) + 1
        covering = [r for r in events
                    if r.clip == a.clip and r.event == a.type and r.t0 - margin <= a.t <= r.t1 + margin]
        if not covering:
            sc.false_alarms += 1
            sc.false_detail.append(f'{a.clip} t={a.t:.1f}s {a.type} (track {a.track_id})')
            continue
        # Con ventanas solapadas, a la fila cuyo centro está más cerca.
        row = min(covering, key=lambda r: abs(a.t - (r.t0 + r.t1) / 2.0))
        per_row[id(row)].append(a)
    for r in events:
        got = sorted(per_row[id(r)], key=lambda a: a.t)
        if got:
            sc.hits += 1
            sc.hits_by_type[r.event] = sc.hits_by_type.get(r.event, 0) + 1
            sc.latencies.append(got[0].t - r.t0)
            extra = len(got) - r.people
            if extra > 0:
                sc.duplicates += extra
                sc.duplicate_detail.append(
                    f'{r.clip} [{r.t0:.0f}-{r.t1:.0f}s] {r.event}: {len(got)} alertas para {r.people} persona(s)')
        else:
            sc.missed += 1
            sc.missed_by_type[r.event] = sc.missed_by_type.get(r.event, 0) + 1
            sc.missed_detail.append(f'{r.clip} [{r.t0:.0f}-{r.t1:.0f}s] {r.event}')
    return sc


# --------------------------------------------------------------------------
# Zonas y reglas
# --------------------------------------------------------------------------
def load_zones(path: Optional[str]) -> Tuple[List[Any], Any]:
    """JSON de zonas -> (zonas tipadas, crudo). Acepta la lista directa o `{guardianZones}`."""
    if not path:
        return [], None
    raw = json.loads(Path(path).read_text(encoding='utf-8'))
    if isinstance(raw, dict):
        raw = raw.get('guardianZones', [])
    return parse_guardian_zones(raw), raw


def sanitize_label(label: str) -> str:
    """Solo [A-Za-z0-9._-]: el label forma parte del nombre del JSON de salida y no
    puede traer separadores de ruta (ni `..`)."""
    clean = re.sub(r'[^A-Za-z0-9._-]', '_', str(label))
    while '..' in clean:
        clean = clean.replace('..', '_')
    return clean.strip('.') or 'config'


def build_rules(kind: str, zones: Sequence[Any], poll_interval: Optional[float] = None) -> Any:
    rules: Any = LegacyRules() if kind == 'legacy' else GuardianRules(
        GuardianConfig(max_gap_seconds=max_gap_for_poll_interval(poll_interval)))
    rules.set_zones(zones)
    return rules


# --------------------------------------------------------------------------
# Replay (requiere OpenCV y ultralytics)
# --------------------------------------------------------------------------
@dataclass
class ReplayStats:
    frames: int = 0
    inferences: int = 0
    inference_ms: List[float] = field(default_factory=list)


def replay_clip(path: Path, clip_token: str, model: Any, fps: float, rules_kind: str, zones: Sequence[Any],
                imgsz: int, device: Optional[str], retention: Optional[float],
                stats: ReplayStats) -> List[Alert]:
    """Un clip por el pipeline del worker. Todo lo con estado (tracker, MOG2, reglas)
    es NUEVO por clip."""
    from lpr.processor.guardian_pipeline import GuardianPipeline, MotionGate, reset_tracker

    reset_tracker(model)
    legacy = rules_kind == 'legacy'
    # La línea base "antes" no tenía retención del gating.
    gate_retention = 0.0 if legacy else (retention if retention is not None else None)
    gate = MotionGate() if gate_retention is None else MotionGate(retention_seconds=gate_retention)
    pipeline = GuardianPipeline(model=model, rules=build_rules(rules_kind, zones, 1.0 / fps), gate=gate,
                                device=device, imgsz=imgsz)
    alerts: List[Alert] = []
    for t, frame in iter_sampled_frames(path, fps):
        result = pipeline.process(frame, t)
        stats.frames += 1
        if result.ran_inference:
            stats.inferences += 1
            stats.inference_ms.append(result.inference_ms)
        for d in result.decisions:
            alerts.append(Alert(clip=clip_token, t=t, type=d.type, track_id=d.track_id,
                                zone_index=d.zone_index, conf=d.conf))
    return alerts


def format_report(label: str, args: argparse.Namespace, sc: Score, stats: ReplayStats,
                  device: str, n_clips: int, n_zones: int) -> str:
    lat = sc.latencies
    ms = stats.inference_ms
    by_type = ', '.join(f'{k}={v}' for k, v in sorted(sc.alerts_by_type.items())) or 'ninguna'
    lines = [
        f'== {label}: reglas={args.rules} fps={args.fps:g} imgsz={args.imgsz} zonas={n_zones} clips={n_clips}',
        f'   alertas={sc.alerts_total} ({by_type})',
        f'   eventos reales={sc.n_events}  aciertos={sc.hits}  omitidos={sc.missed}  '
        f'FALSAS_ALARMAS={sc.false_alarms}  duplicadas={sc.duplicates}',
    ]
    for kind in EVENT_TYPES:
        total = sc.hits_by_type.get(kind, 0) + sc.missed_by_type.get(kind, 0)
        if total:
            lines.append(f'     {kind}: {sc.hits_by_type.get(kind, 0)}/{total} detectados')
    lines.append('   latencia (s desde t_inicio): '
                 + (f'mediana={statistics.median(lat):.1f} max={max(lat):.1f}' if lat else 'n/a'))
    lines.append(f'   inferencia: {statistics.mean(ms):.1f} ms/inferencia sobre {stats.inferences}/{stats.frames} '
                 f'frames (el resto los salto el gating), device={device}' if ms
                 else f'   inferencia: ninguna sobre {stats.frames} frames, device={device}')
    lines += [f'   OMITIDO: {d}' for d in sc.missed_detail]
    lines += [f'   FALSA ALARMA: {d}' for d in sc.false_detail]
    lines += [f'   DUPLICADA: {d}' for d in sc.duplicate_detail]
    return '\n'.join(lines)


def find_clips(directory: Path, only: Optional[str] = None) -> List[Path]:
    return sorted(p for ext in ('*.mkv', '*.mp4', '*.avi') for p in directory.glob(ext)
                  if not only or only in p.name)


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description='Replay clips through the Guardian decision path and score them.')
    ap.add_argument('--clips', required=True, help='directory with the clips (*.mkv, *.mp4, *.avi)')
    ap.add_argument('--gt', required=True, help='ground truth CSV (clip,t_inicio_s,t_fin_s,evento,zona,personas)')
    ap.add_argument('--fps', type=float, default=1.0, help='sampling rate (default 1)')
    ap.add_argument('--zone-file', help='JSON with guardianZones (legacy or new format) or the backend response')
    ap.add_argument('--device', help='YOLO device (cuda:0, cpu); default: ultralytics auto')
    ap.add_argument('--imgsz', type=int, default=960, help='YOLO input size (default 960 = worker)')
    ap.add_argument('--rules', choices=['current', 'legacy'], default='current',
                    help='current = GuardianRules; legacy = rules of main (baseline "before")')
    ap.add_argument('--retention', type=float, default=None,
                    help='motion-gating retention seconds (default: worker default; legacy forces 0)')
    ap.add_argument('--margin', type=float, default=2.0, help='seconds of tolerance around each GT window')
    ap.add_argument('--only', help='only clips whose name contains this text')
    ap.add_argument('--label', default='config')
    ap.add_argument('--out-json', help='write alerts + summary to this JSON file (default: '
                    'lpr/eval-data/guardian-replay-<label>.json, git-ignored)')
    args = ap.parse_args(argv)
    args.label = sanitize_label(args.label)
    if args.fps <= 0:
        ap.error('--fps must be > 0')

    logging.basicConfig(level=logging.WARNING)
    gt = load_gt(Path(args.gt))
    zones, _raw = load_zones(args.zone_file)
    clips = find_clips(Path(args.clips), args.only)
    labelled = [c for c in clips if any(clip_matches(r.clip, c) for r in gt)]
    if not labelled:
        print('no clips with ground truth found', file=sys.stderr)
        return 1
    if len(labelled) < len(clips):
        print(f'(se omiten {len(clips) - len(labelled)} clips sin filas en la verdad terreno)', file=sys.stderr)

    from lpr.processor.guardian_pipeline import effective_device, load_model
    model = load_model()
    # Warm-up (contexto CUDA, carga de pesos) para que no cuente como ms/inferencia.
    _t, warm_frame = next(iter_sampled_frames(labelled[0], args.fps))
    model.track(warm_frame, classes=[0], persist=True, tracker='bytetrack.yaml', verbose=False,
                imgsz=args.imgsz, device=args.device)

    stats = ReplayStats()
    alerts: List[Alert] = []
    for clip in labelled:
        token = next(r.clip for r in gt if clip_matches(r.clip, clip))
        alerts += replay_clip(clip, token, model, args.fps, args.rules, zones, args.imgsz, args.device,
                              args.retention, stats)
    clip_tokens = {r.clip for r in gt if any(clip_matches(r.clip, c) for c in labelled)}
    sc = score(alerts, [r for r in gt if r.clip in clip_tokens], args.margin)
    device = effective_device(model, args.device)
    print(format_report(args.label, args, sc, stats, device, len(labelled), len(zones)))

    out_path = Path(args.out_json) if args.out_json else DEFAULT_DATA_DIR / f'guardian-replay-{args.label}.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    summary = asdict(sc)
    summary['ms_per_inference'] = statistics.mean(stats.inference_ms) if stats.inference_ms else None
    summary['device'] = device
    out_path.write_text(json.dumps({'summary': summary, 'alerts': [asdict(a) for a in alerts]},
                                   ensure_ascii=False, indent=2), encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
