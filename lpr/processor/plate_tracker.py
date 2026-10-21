"""Plate tracker: associates plate reads across frames and votes per vehicle.

Pure Python (no OpenCV/ultralytics), so it is fully testable in CI. It models
the configuration validated offline ("voto por texto", N=3): every plate box is
associated with a track by center distance (gate proportional to the box
size), the valid readings of a track vote for the full plate text weighted by
the OCR confidence, and the track emits ONCE when the winning text reaches
`confirm_reads` readings.

Why a track and not just counting texts (the previous behaviour): counting
texts confirms a plate after N sightings even if they came from different
vehicles, and the old "1 reading after 5 s" branch accepted a single reading.
A track ties the readings to one vehicle, so the same OCR mistake repeated on
two different cars never adds up.

Direction (when the camera sees both ways): first the crossing of the
configured direction line by the VEHICLE track (ByteTrack, see
`vehicle_tracker.py` and `utils/direction.py`), then the net motion, and finally
the plate box trend (it grows while the vehicle approaches the camera and
shrinks while it moves away). Once the plate is confirmed, the emission WAITS
for the direction up to `direction_wait_seconds` (clock injectable, so it is
testable); a track that closes while waiting emits with whatever it has: the
reading is never lost.
"""
import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from lpr.utils.direction import (
    DIRECTION_BOTH, DIRECTION_ENTRY, DIRECTION_EXIT, DIRECTION_UNKNOWN, RESOLVED_SOURCES,
    SOURCE_NONE, DirectionLine, PathPoint, resolve_direction,
)

Box = Tuple[float, float, float, float]

# Max readings/widths kept per track (a parked car with a noisy OCR would grow forever).
MAX_HISTORY = 200

# Cameras configured as 'both' infer the direction; 'entry'/'exit' are fixed
# (the DIRECTION_* constants live in `utils/direction.py` and are re-exported here).


@dataclass
class TrackObservation:
    """One plate box seen in a frame.

    `text` is the corrected plate text, or None when the reading is not valid:
    such a box still keeps its track alive (and feeds the direction trend) but
    casts no vote. `ref` is an opaque payload (the `PlateRead`) handed back in
    the emission so the caller can save the snapshot of the best reading.
    """
    box: Box
    text: Optional[str]
    ocr_conf: float = 0.0
    det_conf: float = 0.0
    ref: Any = None
    # Vehicle track (ByteTrack) whose box contains the plate; None when there is
    # no vehicle tracker or no box contains it (association then falls back to distance).
    vehicle_id: Optional[int] = None
    # Opaque evidence of this reading (the worker passes the FRAME it was read
    # from, by reference: frames must not be mutated afterwards). The tracker keeps
    # only the best one per candidate text, never one per reading.
    evidence: Any = None


@dataclass
class PlateEmission:
    track_id: int
    text: str
    reads: int            # valid readings accumulated by the track
    votes: int            # readings that voted for the winning text
    winner_share: float   # confidence-weighted share of the winner (0-1)
    direction: str
    box: Box              # box of the best winning reading
    frame_box: Box        # box of the track in the frame that triggered the emission
    ocr_conf: float       # mean OCR confidence of the winning readings
    det_conf: float       # detector confidence of the best winning reading
    best_ref: Any = None  # `ref` of the best winning reading (highest ocr_conf)
    direction_source: str = SOURCE_NONE  # camera | line | motion | width | none
    vehicle_id: Optional[int] = None
    # Evidence (frame) of the best winning reading: `box`, `best_ref` and `evidence`
    # all describe THAT reading, so the saved picture, its box and the crop agree
    # even when the emission is delayed (direction wait / flush).
    evidence: Any = None

    def track_meta(self) -> Dict[str, Any]:
        """The `meta.track` object of the ingestion contract."""
        meta: Dict[str, Any] = {'id': self.track_id, 'reads': self.reads, 'votes': self.votes,
                                'winner_share': round(self.winner_share, 3)}
        if self.vehicle_id is not None:
            meta['vehicle_id'] = self.vehicle_id
        return meta


@dataclass
class _Read:
    t: float
    text: str
    ocr_conf: float
    det_conf: float
    box: Box
    ref: Any


# Max candidate texts whose best evidence a track keeps (a noisy OCR must not
# make a track hold one full frame per distinct misreading).
MAX_EVIDENCE_TEXTS = 3


@dataclass
class _Evidence:
    key: Tuple[float, float]   # (ocr_conf, det_conf): same criterion as the vote's "best reading"
    box: Box
    det_conf: float
    ref: Any
    frame: Any


@dataclass
class _Track:
    id: int
    box: Box
    last_seen: float
    reads: List[_Read] = field(default_factory=list)
    widths: List[Tuple[float, float]] = field(default_factory=list)  # (t, width)
    done: bool = False
    vehicle_id: Optional[int] = None
    # Last known trajectory of the bound vehicle (kept: the vehicle tracker may
    # forget it before this track closes).
    last_path: List[PathPoint] = field(default_factory=list)
    # Confirmed plate waiting for its direction (see `direction_wait_seconds`).
    pending: Optional[PlateEmission] = None
    pending_since: float = 0.0
    # Best evidence per candidate text (see MAX_EVIDENCE_TEXTS).
    evidence: Dict[str, _Evidence] = field(default_factory=dict)


def _center(box: Box) -> Tuple[float, float]:
    return (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0


def _width(box: Box) -> float:
    return max(0.0, box[2] - box[0])


class PlateTracker:
    def __init__(
        self,
        confirm_reads: int = 3,
        max_gap_seconds: float = 1.5,
        direction: str = DIRECTION_UNKNOWN,
        # Association gate: max(gate_min_px, gate_width_factor * widest box)
        # plus what the plate may travel meanwhile (gate_speed_px_s * dt). The
        # defaults come from the 1920x1080 evaluation; they scale with the box.
        gate_min_px: float = 110.0,
        gate_width_factor: float = 1.5,
        gate_speed_px_s: float = 150.0,
        # Direction: width ratio (last third / first third) needed to call it.
        direction_ratio: float = 1.05,
        # Minimum confidence-weighted share of the winning text to emit. A track
        # whose readings are split (e.g. 3 votes of 8 reads) is not trustworthy
        # even if the winner reached N: it keeps accumulating instead.
        min_winner_share: float = 0.0,
        # Seconds a CONFIRMED plate waits for the vehicle to cross the direction
        # line before emitting with the best fallback. 0 = never wait.
        direction_wait_seconds: float = 0.0,
        direction_line: Optional[DirectionLine] = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.confirm_reads = max(1, int(confirm_reads))
        self.max_gap_seconds = float(max_gap_seconds)
        self.direction = direction
        self.gate_min_px = gate_min_px
        self.gate_width_factor = gate_width_factor
        self.gate_speed_px_s = gate_speed_px_s
        self.direction_ratio = direction_ratio
        self.min_winner_share = float(min_winner_share)
        self.direction_wait_seconds = max(0.0, float(direction_wait_seconds))
        self.direction_line = direction_line
        self._frame_size: Optional[Tuple[int, int]] = None
        self._clock = clock
        self._tracks: List[_Track] = []
        self._next_id = 1

    @property
    def active_tracks(self) -> int:
        return len(self._tracks)

    def set_direction_line(self, line: Optional[DirectionLine]) -> None:
        """Changing the line does NOT rebuild the tracker (the voting state does
        not depend on it) but the trajectories cached per track were measured
        against the old line, so they are dropped and the direction is recomputed
        from the vehicle tracker's (also reset) paths."""
        if line != self.direction_line:
            self.direction_line = line
            for tr in self._tracks:
                tr.last_path = []

    def update(self, observations: List[TrackObservation], now: Optional[float] = None,
               *, paths: Optional[Mapping[int, Sequence[PathPoint]]] = None,
               frame_size: Optional[Tuple[int, int]] = None) -> List[PlateEmission]:
        """Feed the boxes of one frame; returns the emissions it triggered.

        `paths` maps vehicle id -> trajectory (px) and `frame_size` is (w, h):
        both feed the direction; without them the direction falls back to the
        plate width trend."""
        t = self._clock() if now is None else float(now)
        if frame_size is not None:
            self._frame_size = (int(frame_size[0]), int(frame_size[1]))
        emissions: List[PlateEmission] = []
        # Close tracks not seen for longer than the gap (a new box never joins
        # them). A closed track that was waiting for its direction emits now.
        alive: List[_Track] = []
        for tr in self._tracks:
            if t - tr.last_seen <= self.max_gap_seconds:
                alive.append(tr)
            elif tr.pending is not None and not tr.done:
                self._refresh_path(tr, paths)
                emissions.append(self._finalize(tr))
        self._tracks = alive

        claimed: set = set()  # a track takes at most one box per frame
        # Strongest detections first so a weak box cannot steal a track.
        for obs in sorted(observations, key=lambda o: -o.det_conf):
            track = self._associate(obs, t, claimed)
            if track is None:
                track = _Track(id=self._next_id, box=obs.box, last_seen=t)
                self._next_id += 1
                self._tracks.append(track)
            claimed.add(track.id)
            track.box = obs.box
            track.last_seen = t
            if obs.vehicle_id is not None:
                track.vehicle_id = obs.vehicle_id
            if track.done:
                # Already emitted: it only stays alive so the same (maybe
                # parked) vehicle does not open a new track. Stop accumulating
                # so a long stop does not grow memory without bound.
                continue
            track.widths.append((t, _width(obs.box)))
            del track.widths[:-MAX_HISTORY]
            if track.pending is not None:
                continue  # confirmed: only the direction evidence keeps growing
            if obs.text:
                track.reads.append(_Read(t, obs.text, float(obs.ocr_conf), float(obs.det_conf),
                                         obs.box, obs.ref))
            if obs.text and obs.evidence is not None:
                self._remember_evidence(track, obs)
            # Bound the history of a track whose votes never converge.
            del track.reads[:-MAX_HISTORY]
            if len(track.reads) < self.confirm_reads:
                continue
            candidate = self._vote(track)
            if candidate is None:
                continue
            self._refresh_path(track, paths)
            _direction, source = self._direction_of(track)
            if source in RESOLVED_SOURCES or not self._should_wait(track):
                emissions.append(self._finalize(track, candidate))
            else:
                track.pending = candidate
                track.pending_since = t

        # Confirmed plates still waiting: the vehicle may have crossed the line
        # in a frame where the plate was not read, or the wait may be over.
        for tr in self._tracks:
            if tr.pending is None or tr.done:
                continue
            self._refresh_path(tr, paths)
            _direction, source = self._direction_of(tr)
            if source in RESOLVED_SOURCES or t - tr.pending_since >= self.direction_wait_seconds:
                emissions.append(self._finalize(tr))
        return emissions

    def flush(self) -> List[PlateEmission]:
        """Emit every confirmed plate still waiting for its direction (end of a
        recorded clip; a live stream never needs it: tracks close on their own)."""
        return [self._finalize(tr) for tr in self._tracks if tr.pending is not None and not tr.done]

    def _remember_evidence(self, track: _Track, obs: TrackObservation) -> None:
        """Keep only the best evidence per text, replaced only by a better reading
        of the SAME text; a new winner then has its own best reading available."""
        key = (float(obs.ocr_conf), float(obs.det_conf))
        current = track.evidence.get(obs.text or '')
        if current is not None and key <= current.key:
            return
        track.evidence[obs.text or ''] = _Evidence(key, obs.box, float(obs.det_conf), obs.ref, obs.evidence)
        if len(track.evidence) > MAX_EVIDENCE_TEXTS:
            weight: Dict[str, float] = defaultdict(float)
            for r in track.reads:
                weight[r.text] += r.ocr_conf
            loser = min(track.evidence, key=lambda t: (weight.get(t, 0.0), track.evidence[t].key))
            del track.evidence[loser]

    def _refresh_path(self, track: _Track, paths: Optional[Mapping[int, Sequence[PathPoint]]]) -> None:
        if paths is not None and track.vehicle_id is not None:
            path = paths.get(track.vehicle_id)
            if path:
                track.last_path = list(path)

    def _should_wait(self, track: _Track) -> bool:
        """Waiting only makes sense when a line is configured and the plate belongs
        to a tracked vehicle. A fixed camera direction does NOT skip the wait: the
        line (and the measured motion) win over it, which then only serves as the fallback on timeout."""
        return (self.direction_wait_seconds > 0 and self.direction_line is not None
                and track.vehicle_id is not None and self._frame_size is not None)

    def _finalize(self, track: _Track, candidate: Optional[PlateEmission] = None) -> PlateEmission:
        emission = candidate or track.pending
        if emission is None:
            raise RuntimeError('track without a confirmed plate cannot be finalized')
        emission.direction, emission.direction_source = self._direction_of(track)
        emission.vehicle_id = track.vehicle_id
        emission.frame_box = track.box
        evidence = track.evidence.get(emission.text)
        if evidence is not None:
            emission.box, emission.det_conf = evidence.box, evidence.det_conf
            emission.best_ref, emission.evidence = evidence.ref, evidence.frame
        track.pending = None
        track.done = True
        track.evidence = {}   # one emission per track: release the frames
        return emission

    def _associate(self, obs: TrackObservation, t: float, claimed: set) -> Optional[_Track]:
        # 1) Same vehicle track: far more stable than distance when two cars
        #    pass close to each other.
        if obs.vehicle_id is not None:
            for tr in self._tracks:
                if tr.id not in claimed and tr.vehicle_id == obs.vehicle_id and t - tr.last_seen >= 0:
                    return tr
        # 2) Fallback by distance, never across two different vehicles.
        box = obs.box
        cx, cy = _center(box)
        best: Optional[Tuple[float, _Track]] = None
        for tr in self._tracks:
            if tr.id in claimed:
                continue
            if obs.vehicle_id is not None and tr.vehicle_id is not None and tr.vehicle_id != obs.vehicle_id:
                continue
            dt = t - tr.last_seen
            if dt < 0:
                continue
            tx, ty = _center(tr.box)
            dist = math.hypot(cx - tx, cy - ty)
            gate = (max(self.gate_min_px, self.gate_width_factor * max(_width(box), _width(tr.box)))
                    + self.gate_speed_px_s * dt)
            if dist <= gate and (best is None or dist < best[0]):
                best = (dist, tr)
        return best[1] if best else None

    def _vote(self, track: _Track) -> Optional[PlateEmission]:
        weights: Dict[str, float] = defaultdict(float)
        counts: Dict[str, int] = defaultdict(int)
        for r in track.reads:
            weights[r.text] += r.ocr_conf
            counts[r.text] += 1
        winner = max(weights, key=lambda k: (weights[k], counts[k]))
        if counts[winner] < self.confirm_reads:
            return None
        winning = [r for r in track.reads if r.text == winner]
        best = max(winning, key=lambda r: (r.ocr_conf, r.det_conf))
        total = sum(weights.values())
        share = (weights[winner] / total) if total > 0 else 0.0
        if share < self.min_winner_share:
            return None
        return PlateEmission(
            track_id=track.id,
            text=winner,
            reads=len(track.reads),
            votes=counts[winner],
            winner_share=share,
            direction=DIRECTION_UNKNOWN,  # decided at emission (`_finalize`)
            box=best.box,
            frame_box=track.box,
            ocr_conf=sum(r.ocr_conf for r in winning) / len(winning),
            det_conf=best.det_conf,
            best_ref=best.ref,
        )

    def _direction_of(self, track: _Track) -> Tuple[str, str]:
        """`(direction, source)`: line > motion > camera (fixed) > width > none."""
        width_dir = (infer_direction(track.widths, self.direction_ratio)
                     if self.direction == DIRECTION_BOTH else DIRECTION_UNKNOWN)
        return resolve_direction(self.direction, self.direction_line, track.last_path,
                                 width_dir, self._frame_size)


def infer_direction(widths: List[Tuple[float, float]], ratio: float = 1.05) -> str:
    """Direction from the trend of the plate width: growing = approaching the
    camera = 'entry'; shrinking = 'exit'; too flat or too few samples = 'unknown'.

    Compares the median width of the first and last third of the samples
    (medians resist a single bad box)."""
    ws = [w for _t, w in widths if w > 0]
    if len(ws) < 3:
        return DIRECTION_UNKNOWN
    third = max(1, len(ws) // 3)
    first = sorted(ws[:third])[third // 2]
    last = sorted(ws[-third:])[third // 2]
    if first <= 0 or last <= 0:
        return DIRECTION_UNKNOWN
    growth = last / first
    if growth >= ratio:
        return DIRECTION_ENTRY
    if growth <= 1.0 / ratio:
        return DIRECTION_EXIT
    return DIRECTION_UNKNOWN
