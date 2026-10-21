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

Direction (when the camera sees both ways): the plate box grows while the
vehicle approaches the camera and shrinks while it moves away.
"""
import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

Box = Tuple[float, float, float, float]

# Max readings/widths kept per track (a parked car with a noisy OCR would grow forever).
MAX_HISTORY = 200

DIRECTION_ENTRY = 'entry'
DIRECTION_EXIT = 'exit'
DIRECTION_UNKNOWN = 'unknown'
# Cameras configured as 'both' infer the direction; 'entry'/'exit' are fixed.
DIRECTION_BOTH = 'both'


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

    def track_meta(self) -> Dict[str, Any]:
        """The `meta.track` object of the ingestion contract."""
        return {'id': self.track_id, 'reads': self.reads, 'votes': self.votes,
                'winner_share': round(self.winner_share, 3)}


@dataclass
class _Read:
    t: float
    text: str
    ocr_conf: float
    det_conf: float
    box: Box
    ref: Any


@dataclass
class _Track:
    id: int
    box: Box
    last_seen: float
    reads: List[_Read] = field(default_factory=list)
    widths: List[Tuple[float, float]] = field(default_factory=list)  # (t, width)
    done: bool = False


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
        self._clock = clock
        self._tracks: List[_Track] = []
        self._next_id = 1

    @property
    def active_tracks(self) -> int:
        return len(self._tracks)

    def update(self, observations: List[TrackObservation],
               now: Optional[float] = None) -> List[PlateEmission]:
        """Feed the boxes of one frame; returns the emissions it triggered."""
        t = self._clock() if now is None else float(now)
        # Close tracks not seen for longer than the gap (a new box never joins them).
        self._tracks = [tr for tr in self._tracks if t - tr.last_seen <= self.max_gap_seconds]

        emissions: List[PlateEmission] = []
        claimed: set = set()  # a track takes at most one box per frame
        # Strongest detections first so a weak box cannot steal a track.
        for obs in sorted(observations, key=lambda o: -o.det_conf):
            track = self._associate(obs.box, t, claimed)
            if track is None:
                track = _Track(id=self._next_id, box=obs.box, last_seen=t)
                self._next_id += 1
                self._tracks.append(track)
            claimed.add(track.id)
            track.box = obs.box
            track.last_seen = t
            if track.done:
                # Already emitted: it only stays alive so the same (maybe
                # parked) vehicle does not open a new track. Stop accumulating
                # so a long stop does not grow memory without bound.
                continue
            track.widths.append((t, _width(obs.box)))
            if obs.text:
                track.reads.append(_Read(t, obs.text, float(obs.ocr_conf), float(obs.det_conf),
                                         obs.box, obs.ref))
            # Bound the history of a track whose votes never converge.
            del track.reads[:-MAX_HISTORY]
            del track.widths[:-MAX_HISTORY]
            if len(track.reads) < self.confirm_reads:
                continue
            emission = self._vote(track)
            if emission is not None:
                track.done = True
                emissions.append(emission)
        return emissions

    def _associate(self, box: Box, t: float, claimed: set) -> Optional[_Track]:
        cx, cy = _center(box)
        best: Optional[Tuple[float, _Track]] = None
        for tr in self._tracks:
            if tr.id in claimed:
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
            direction=self._direction_of(track),
            box=best.box,
            frame_box=track.box,
            ocr_conf=sum(r.ocr_conf for r in winning) / len(winning),
            det_conf=best.det_conf,
            best_ref=best.ref,
        )

    def _direction_of(self, track: _Track) -> str:
        if self.direction in (DIRECTION_ENTRY, DIRECTION_EXIT):
            return self.direction
        if self.direction != DIRECTION_BOTH:
            return DIRECTION_UNKNOWN  # sin configuracion no se adivina
        return infer_direction(track.widths, self.direction_ratio)


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
