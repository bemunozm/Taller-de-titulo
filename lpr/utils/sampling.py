"""Deadline-based frame sampling for the capture loop.

Resetting the clock to `now` on every submitted frame (`now - last < interval`)
quantises the rate to the stream cadence: at 15 fps (67 ms) with a 125 ms target
it takes one frame every 133 ms (~7.5 fps) plus jitter. Here the next deadline
advances by `interval` instead, so the long-run rate matches the target.
"""
import time
from typing import Callable, Optional


class FrameScheduler:
    """`due(now)` -> True when the frame read at `now` must be submitted.

    - Deadline schedule: `next_due += interval` on each accepted frame.
    - If it fell behind by more than one interval (stream slower than the target,
      or a stall), it resyncs to `now + interval`: no burst of backlog frames.
    - `interval` can change at runtime (settings sync): pass it per call.
    """

    def __init__(self, interval: float, clock: Callable[[], float] = time.time) -> None:
        if interval <= 0:
            raise ValueError('interval must be > 0')
        self.interval = float(interval)
        self._clock = clock
        self._next_due: Optional[float] = None

    def due(self, now: Optional[float] = None, interval: Optional[float] = None) -> bool:
        if now is None:
            now = self._clock()
        if interval is not None and interval > 0:
            self.interval = float(interval)
        if self._next_due is None:
            self._next_due = now + self.interval
            return True
        if now < self._next_due - 1e-9:
            return False
        self._next_due += self.interval
        if self._next_due <= now:  # more than one interval behind: resync
            self._next_due = now + self.interval
        return True
