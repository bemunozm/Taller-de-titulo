"""Effective-throughput telemetry of a worker (cheap counters, no per-frame logging).

The capture loop offers a frame every `1 / sample_fps` seconds; the worker drops
it when it is still busy with the previous one. Under GPU/CPU contention the
processed rate falls below the configured one and the vote loses reads silently,
so every `interval` seconds one INFO line reports offered / processed / dropped
and the effective fps (WARNING when it is under `warn_ratio` of the configured).
"""
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

DEFAULT_INTERVAL_SECONDS = 60.0
WARN_RATIO = 0.8


@dataclass(frozen=True)
class ThroughputReport:
    seconds: float
    offered: int
    processed: int
    dropped: int
    configured_fps: float
    effective_fps: float
    low: bool


class ThroughputMeter:
    """Thread-safe counters. `offered` = frames the capture handed to the worker,
    `dropped` = offered while busy, `processed` = frames whose processing finished."""

    def __init__(self, interval: float = DEFAULT_INTERVAL_SECONDS, warn_ratio: float = WARN_RATIO,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.interval = float(interval)
        self.warn_ratio = float(warn_ratio)
        self._clock = clock
        self._lock = threading.Lock()
        self._offered = 0
        self._processed = 0
        self._dropped = 0
        self._since = clock()

    def offered(self) -> None:
        with self._lock:
            self._offered += 1

    def dropped(self) -> None:
        with self._lock:
            self._dropped += 1

    def processed(self) -> None:
        with self._lock:
            self._processed += 1

    def poll(self, configured_fps: float) -> Optional[ThroughputReport]:
        """Returns the report of the window and starts a new one once `interval`
        elapsed; None before that (the common, near-free case)."""
        now = self._clock()
        if now - self._since < self.interval:
            return None
        with self._lock:
            seconds = max(now - self._since, 1e-9)
            effective = self._processed / seconds
            configured = float(configured_fps or 0.0)
            report = ThroughputReport(
                seconds=seconds, offered=self._offered, processed=self._processed,
                dropped=self._dropped, configured_fps=configured, effective_fps=effective,
                low=configured > 0 and effective < self.warn_ratio * configured,
            )
            self._offered = self._processed = self._dropped = 0
            self._since = now
        return report


def format_report(report: ThroughputReport) -> str:
    return ('Throughput %.0fs: offered=%d processed=%d dropped(busy)=%d effective=%.2f fps '
            'configured=%.2f fps (%.0f%%)' % (
                report.seconds, report.offered, report.processed, report.dropped,
                report.effective_fps, report.configured_fps,
                100.0 * report.effective_fps / report.configured_fps if report.configured_fps else 0.0))
