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

One vote unit per VEHICLE: a read bound to a (canonical) vehicle id always goes to
THE track of that vehicle, which stays open as long as the vehicle is alive (the
keys of `paths`) instead of closing after `max_gap_seconds` without the plate. It
emits once and the vehicle is then consumed: later reads of it never emit again (a
winner that flips after the emission only logs a warning). The emitted text is
decided at emission time with every read accumulated so far, and a confirmed plate
whose winner share is still low waits up to `vote_settle_seconds` for more reads.
Reads without a vehicle keep the old behaviour (distance association + max gap).
"""
import logging
import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from lpr.utils.direction import (
    DIRECTION_BOTH, DIRECTION_ENTRY, DIRECTION_EXIT, DIRECTION_UNKNOWN, RESOLVED_SOURCES,
    SOURCE_NONE, DirectionLine, PathPoint, resolve_direction,
)
from lpr.utils.pii import mask_plate

Box = Tuple[float, float, float, float]

# Max readings/widths kept per track (a parked car with a noisy OCR would grow forever).
MAX_HISTORY = 200

# Winner share at which the text is considered settled (no settle wait).
SETTLE_SHARE = 0.8
# Post-emission winner flip that is worth a warning: share of the new winner.
CORRECTION_MIN_SHARE = 0.6

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
    # ByteTrack ids that fed the canonical `vehicle_id` (telemetry) and whether the
    # settle wait (see `vote_settle_seconds`) was used for this emission.
    vehicle_raw_ids: List[int] = field(default_factory=list)
    settled: bool = False

    def track_meta(self) -> Dict[str, Any]:
        """The `meta.track` object of the ingestion contract. `reads` is the total of
        valid readings of the vehicle; `vehicle_id` and `vehicle_uid` are the canonical id."""
        meta: Dict[str, Any] = {'id': self.track_id, 'reads': self.reads, 'votes': self.votes,
                                'winner_share': round(self.winner_share, 3), 'settled': self.settled}
        if self.vehicle_id is not None:
            meta['vehicle_id'] = self.vehicle_id
            meta['vehicle_uid'] = self.vehicle_id
            meta['vehicle_ids'] = list(self.vehicle_raw_ids)
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
    # Waiting for more reads before emitting (low winner share at confirmation).
    settled: bool = False
    raw_ids: List[int] = field(default_factory=list)  # ByteTrack ids of the vehicle (telemetry)
    emitted_text: Optional[str] = None
    correction_warned: bool = False


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
        # Seconds a confirmed plate of a LIVE vehicle waits for more reads while its
        # winner share is below SETTLE_SHARE. 0 = never wait.
        vote_settle_seconds: float = 0.0,
        # Decide the text with the reads up to the end of the settle window, ignoring
        # the ones that arrive during the direction wait (default: every read votes).
        freeze_text_after_settle: bool = False,
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
        self.vote_settle_seconds = max(0.0, float(vote_settle_seconds))
        self.freeze_text_after_settle = bool(freeze_text_after_settle)
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
               frame_size: Optional[Tuple[int, int]] = None,
               raw_ids: Optional[Mapping[int, Sequence[int]]] = None) -> List[PlateEmission]:
        """Feed the boxes of one frame; returns the emissions it triggered.

        `paths` maps vehicle id -> trajectory (px) and `frame_size` is (w, h):
        both feed the direction; without them the direction falls back to the
        plate width trend. The keys of `paths` are also the vehicles ALIVE now: a
        track bound to a vehicle stays open while its vehicle is alive; without
        `paths` (no vehicle tracker) every track closes by `max_gap_seconds`.
        `raw_ids` (vehicle id -> ByteTrack ids) is telemetry for the emission."""
        t = self._clock() if now is None else float(now)
        if frame_size is not None:
            self._frame_size = (int(frame_size[0]), int(frame_size[1]))
        alive: Optional[set] = None if paths is None else set(paths)
        emissions: List[PlateEmission] = []
        # Close the tracks that ended (plate gap, or vehicle gone for those bound to
        # one); a new box never joins them. A closed track that was waiting for its
        # direction / more reads emits now.
        open_tracks: List[_Track] = []
        for tr in self._tracks:
            if self._is_open(tr, t, alive):
                open_tracks.append(tr)
            elif tr.pending is not None and not tr.done:
                self._refresh_path(tr, paths, raw_ids)
                emissions.append(self._finalize(tr))
        self._tracks = open_tracks

        claimed: set = set()  # a track takes at most one box per frame
        # Strongest detections first so a weak box cannot steal a track.
        for obs in sorted(observations, key=lambda o: -o.det_conf):
            if obs.vehicle_id is not None:
                owner = self._vehicle_track(obs.vehicle_id)
                if owner is not None and owner.id in claimed:
                    continue  # one read per frame and vehicle: the strongest box already voted
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
                self._absorb_vehicleless(track, obs, t, claimed)
            if track.done:
                # Already emitted. A vehicle-less track only stays alive so the same
                # (maybe parked) vehicle does not open a new track. A vehicle track is
                # CONSUMED (never emits again) but keeps voting to detect a late correction.
                if track.vehicle_id is not None and obs.text:
                    track.reads.append(_Read(t, obs.text, float(obs.ocr_conf), float(obs.det_conf),
                                             obs.box, obs.ref))
                    del track.reads[:-MAX_HISTORY]
                    self._check_correction(track)
                continue
            track.widths.append((t, _width(obs.box)))
            del track.widths[:-MAX_HISTORY]
            if obs.text:
                track.reads.append(_Read(t, obs.text, float(obs.ocr_conf), float(obs.det_conf),
                                         obs.box, obs.ref))
            if obs.text and obs.evidence is not None:
                self._remember_evidence(track, obs)
            # Bound the history of a track whose votes never converge.
            del track.reads[:-MAX_HISTORY]
            if track.pending is not None or len(track.reads) < self.confirm_reads:
                continue  # confirmed already (the reads keep voting) / not confirmed yet
            candidate = self._vote(track)
            if candidate is None:
                continue
            track.pending = candidate
            track.pending_since = t
            track.settled = (self.vote_settle_seconds > 0 and track.vehicle_id is not None
                             and alive is not None and track.vehicle_id in alive
                             and candidate.winner_share < SETTLE_SHARE)

        # Confirmed plates: emit when the direction is known (or its wait is over) AND
        # the text has settled (or its wait is over). The vehicle may have crossed the
        # line in a frame where the plate was not read, hence this runs for all of them.
        for tr in self._tracks:
            if tr.pending is None or tr.done:
                continue
            self._refresh_path(tr, paths, raw_ids)
            if self._ready(tr, t, alive):
                emissions.append(self._finalize(tr))
        return emissions

    def flush(self) -> List[PlateEmission]:
        """Emit every confirmed plate still waiting for its direction (end of a
        recorded clip; a live stream never needs it: tracks close on their own)."""
        return [self._finalize(tr) for tr in self._tracks if tr.pending is not None and not tr.done]

    def _is_open(self, track: _Track, t: float, alive: Optional[set]) -> bool:
        """A vehicle track lives as long as its vehicle; anything else, `max_gap_seconds`."""
        if track.vehicle_id is not None and alive is not None:
            return track.vehicle_id in alive
        return t - track.last_seen <= self.max_gap_seconds

    def _vehicle_track(self, vehicle_id: int) -> Optional[_Track]:
        for tr in self._tracks:
            if tr.vehicle_id == vehicle_id:
                return tr
        return None

    def _absorb_vehicleless(self, track: _Track, obs: TrackObservation, t: float, claimed: set) -> None:
        """A track born without vehicle that is now seen with one merges into THE track
        of that vehicle (its reads belong to it). If it had already emitted, the vehicle
        is consumed. Only tracks close to this box (the usual distance gate) are taken."""
        for other in list(self._tracks):
            if other is track or other.vehicle_id is not None or other.id in claimed:
                continue
            if not self._within_gate(obs.box, other, t):
                continue
            if other.done:
                if not track.done:
                    track.done, track.pending, track.evidence = True, None, {}
                    track.emitted_text = other.emitted_text
            elif not track.done:
                track.reads = sorted(track.reads + other.reads, key=lambda r: r.t)[-MAX_HISTORY:]
                track.widths = sorted(track.widths + other.widths)[-MAX_HISTORY:]
                for text, ev in other.evidence.items():
                    mine = track.evidence.get(text)
                    if mine is None or ev.key > mine.key:
                        track.evidence[text] = ev
                while len(track.evidence) > MAX_EVIDENCE_TEXTS:
                    del track.evidence[min(track.evidence, key=lambda k: track.evidence[k].key)]
            self._tracks.remove(other)

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

    def _refresh_path(self, track: _Track, paths: Optional[Mapping[int, Sequence[PathPoint]]],
                      raw_ids: Optional[Mapping[int, Sequence[int]]] = None) -> None:
        if track.vehicle_id is None:
            return
        if paths is not None:
            path = paths.get(track.vehicle_id)
            if path:
                track.last_path = list(path)
        if raw_ids is not None and track.vehicle_id in raw_ids:
            track.raw_ids = list(raw_ids[track.vehicle_id])

    def _should_wait(self, track: _Track) -> bool:
        """Waiting only makes sense when a line is configured and the plate belongs
        to a tracked vehicle. A fixed camera direction does NOT skip the wait: the
        line (and the measured motion) win over it, which then only serves as the fallback on timeout."""
        return (self.direction_wait_seconds > 0 and self.direction_line is not None
                and track.vehicle_id is not None and self._frame_size is not None)

    def _ready(self, track: _Track, t: float, alive: Optional[set]) -> bool:
        """A confirmed track emits when BOTH waits are satisfied: the direction one
        (resolved, not needed, or its deadline passed) and the settle one (share high
        enough, vehicle gone, or its deadline passed). Each wait is bounded, so the
        emission never comes later than the later of the two deadlines."""
        waited = t - track.pending_since
        _direction, source = self._direction_of(track)
        if not (source in RESOLVED_SOURCES or not self._should_wait(track)
                or waited >= self.direction_wait_seconds):
            return False
        if track.settled and waited < self.vote_settle_seconds:
            vehicle_alive = alive is not None and track.vehicle_id in alive
            if vehicle_alive and self._current_share(track) < SETTLE_SHARE:
                return False
        return True

    def _current_share(self, track: _Track) -> float:
        fresh = self._vote(track)
        if fresh is not None:
            return fresh.winner_share
        return track.pending.winner_share if track.pending is not None else 0.0

    def _finalize(self, track: _Track) -> PlateEmission:
        # The text is decided NOW with every read accumulated (direction / settle
        # waits vote too); the confirmed candidate is only the fallback if the
        # current vote no longer qualifies (diluted share).
        until = None
        if self.freeze_text_after_settle:
            until = track.pending_since + (self.vote_settle_seconds if track.settled else 0.0)
        emission = self._vote(track, until) or track.pending
        if emission is None:
            raise RuntimeError('track without a confirmed plate cannot be finalized')
        emission.direction, emission.direction_source = self._direction_of(track)
        emission.vehicle_id = track.vehicle_id
        emission.vehicle_raw_ids = list(track.raw_ids)
        emission.settled = track.settled
        emission.frame_box = track.box
        evidence = track.evidence.get(emission.text)
        if evidence is not None:
            emission.box, emission.det_conf = evidence.box, evidence.det_conf
            emission.best_ref, emission.evidence = evidence.ref, evidence.frame
        track.pending = None
        track.done = True
        track.emitted_text = emission.text
        track.evidence = {}   # one emission per track: release the frames
        return emission

    def _check_correction(self, track: _Track) -> None:
        """After the emission the vehicle keeps voting: a different winner with at
        least `confirm_reads` votes and a clear share is worth a WARNING (never re-sent)."""
        if track.correction_warned or track.emitted_text is None:
            return
        winner, weights, counts = self._tally(track)
        total = sum(weights.values())
        share = (weights[winner] / total) if total > 0 else 0.0
        if winner != track.emitted_text and counts[winner] >= self.confirm_reads and share >= CORRECTION_MIN_SHARE:
            track.correction_warned = True
            logging.warning('posible lectura corregida (vehiculo %s): emitida=%s ahora=%s votos=%d share=%.2f',
                            track.vehicle_id, mask_plate(track.emitted_text), mask_plate(winner),
                            counts[winner], share)

    def _within_gate(self, box: Box, track: _Track, t: float) -> bool:
        dt = t - track.last_seen
        if dt < 0:
            return False
        cx, cy = _center(box)
        tx, ty = _center(track.box)
        gate = (max(self.gate_min_px, self.gate_width_factor * max(_width(box), _width(track.box)))
                + self.gate_speed_px_s * dt)
        return math.hypot(cx - tx, cy - ty) <= gate

    def _associate(self, obs: TrackObservation, t: float, claimed: set) -> Optional[_Track]:
        # 1) Same vehicle track: THE track of that vehicle, far more stable than
        #    distance when two cars pass close to each other.
        if obs.vehicle_id is not None:
            owner = self._vehicle_track(obs.vehicle_id)
            if owner is not None and t - owner.last_seen >= 0:
                return owner
        # 2) Fallback by distance, never across two different vehicles. A vehicle
        #    track only matches within the plate gap (it lives longer than that).
        box = obs.box
        cx, cy = _center(box)
        best: Optional[Tuple[float, _Track]] = None
        for tr in self._tracks:
            if tr.id in claimed:
                continue
            if obs.vehicle_id is not None and tr.vehicle_id is not None and tr.vehicle_id != obs.vehicle_id:
                continue
            dt = t - tr.last_seen
            if dt < 0 or (tr.vehicle_id is not None and dt > self.max_gap_seconds):
                continue
            tx, ty = _center(tr.box)
            dist = math.hypot(cx - tx, cy - ty)
            gate = (max(self.gate_min_px, self.gate_width_factor * max(_width(box), _width(tr.box)))
                    + self.gate_speed_px_s * dt)
            if dist <= gate and (best is None or dist < best[0]):
                best = (dist, tr)
        return best[1] if best else None

    def _tally(self, track: _Track, until: Optional[float] = None
               ) -> Tuple[str, Dict[str, float], Dict[str, int]]:
        weights: Dict[str, float] = defaultdict(float)
        counts: Dict[str, int] = defaultdict(int)
        for r in track.reads:
            if until is not None and r.t > until:
                continue
            weights[r.text] += r.ocr_conf
            counts[r.text] += 1
        winner = max(weights, key=lambda k: (weights[k], counts[k]))
        return winner, weights, counts

    def _vote(self, track: _Track, until: Optional[float] = None) -> Optional[PlateEmission]:
        reads = [r for r in track.reads if until is None or r.t <= until]
        if not reads:
            return None
        winner, weights, counts = self._tally(track, until)
        if counts[winner] < self.confirm_reads:
            return None
        winning = [r for r in reads if r.text == winner]
        best = max(winning, key=lambda r: (r.ocr_conf, r.det_conf))
        total = sum(weights.values())
        share = (weights[winner] / total) if total > 0 else 0.0
        if share < self.min_winner_share:
            return None
        return PlateEmission(
            track_id=track.id,
            text=winner,
            reads=len(reads),
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
