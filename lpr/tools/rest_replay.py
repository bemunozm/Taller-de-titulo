"""Emulacion offline del modo reposo para `replay_eval --rest-mode`.

Sobre un clip HD ya grabado:
- el "sub-stream" es el mismo cuadro reducido a 640x360 a `sub_fps` (2 fps): corre la
  MISMA `MotionGate` que en produccion para decidir si hay un vehiculo en movimiento;
- se emula un GOP de `gop_seconds` (2 s) con los timestamps del clip: al disparar, se
  entregan primero los cuadros muestreados desde el ULTIMO keyframe (el inicio del
  paso no se pierde) y luego en vivo, siempre muestreando por timestamp con el
  `FrameScheduler` de produccion;
- mientras esta en reposo no se entrega ningun cuadro HD; al vencer `idle_seconds`
  sin movimiento se emite un paso 'flush' (el consumidor libera lo pendiente);
- el reloj del pipeline (`track_t`) comprime los huecos de reposo igual que el worker.

Reporta el % de tiempo activo (desde el keyframe de arranque hasta el fin).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from lpr.utils.rest_mode import ACTIVE, ChangeDetector, MotionGate, RestStateMachine
from lpr.utils.sampling import FrameScheduler

BRIDGE_SECONDS = 1.0
SUB_SIZE = (640, 360)


@dataclass
class RestStep:
    kind: str            # 'frame' | 'flush'
    t: float             # tiempo del clip
    track_t: float       # reloj del pipeline (huecos de reposo comprimidos)
    frame: Optional[np.ndarray] = None


@dataclass
class RestStats:
    total_seconds: float = 0.0
    active_seconds: float = 0.0
    hd_frames_decoded: int = 0
    activations: int = 0

    @property
    def active_pct(self) -> float:
        return 100.0 * self.active_seconds / self.total_seconds if self.total_seconds > 0 else 0.0

    def add(self, other: 'RestStats') -> None:
        self.total_seconds += other.total_seconds
        self.active_seconds += other.active_seconds
        self.hd_frames_decoded += other.hd_frames_decoded
        self.activations += other.activations


class RestReplay:
    """Un clip = una instancia (compuertas y maquina de estados frescas)."""

    def __init__(self, cfg: Any, detect_boxes: Callable[[np.ndarray], Sequence[Tuple[float, float, float, float]]],
                 idle_seconds: float = 4.0, gop_seconds: float = 2.0, sub_fps: float = 2.0) -> None:
        self.cfg = cfg
        self.detect_boxes = detect_boxes
        self.gop_seconds = float(gop_seconds)
        self.sub_interval = 1.0 / float(sub_fps)
        self.fps = float(cfg.sample_fps)
        self.sm = RestStateMachine(idle_seconds)
        self.sub_gate = MotionGate(getattr(cfg, 'zone', None))
        self.hd_gate = MotionGate(getattr(cfg, 'zone', None))
        self.change = ChangeDetector(getattr(cfg, 'zone', None))
        self.yolo_calls = 0
        self.sub_checks = 0
        self.intervals: List[Tuple[float, float]] = []     # (inicio del decode, fin) de cada periodo activo
        self.activation_times: List[float] = []
        self.stats = RestStats()
        self._now_t = 0.0

    # el consumidor llama esto tras procesar un cuadro HD (evidencia de movimiento del HD)
    def hd_motion(self, boxes: Sequence[Tuple[float, float, float, float]], frame: np.ndarray,
                  track_t: float) -> None:
        h, w = frame.shape[:2]
        if self.hd_gate.update(boxes, w, h, track_t):
            self.sm.touch(self._now_t)

    def steps(self, path: Path) -> Iterator[RestStep]:
        import cv2

        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise RuntimeError(f'cannot open {path}')
        native = cap.get(cv2.CAP_PROP_FPS) or 8.0
        gop_frames = max(1, int(round(self.gop_seconds * native)))
        interval = 1.0 / self.fps
        bridge = max(BRIDGE_SECONDS, 2.0 * interval)   # igual que el worker
        cand: List[Tuple[float, np.ndarray]] = []       # cuadros muestreados del GOP en curso
        cand_sched = FrameScheduler(interval)
        sched = FrameScheduler(interval)
        next_sub = 0.0
        last_ts: Optional[float] = None                 # ultimo cuadro entregado
        skipped = 0.0
        decode_from: Optional[float] = None             # inicio del decode del periodo activo
        gop_start = 0.0
        t = 0.0
        index = 0

        def deliver(tf: float, frame: np.ndarray) -> Optional[RestStep]:
            nonlocal last_ts, skipped
            if last_ts is not None and tf <= last_ts:
                return None
            if last_ts is not None and tf - last_ts > bridge:
                skipped += tf - last_ts - bridge
            last_ts = tf
            return RestStep('frame', tf, tf - skipped, frame)

        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                t = index / native
                self._now_t = t
                if index % gop_frames == 0:
                    gop_start = t
                    cand = []
                    cand_sched = FrameScheduler(interval)
                if cand_sched.due(t, interval):
                    cand.append((t, frame))
                    del cand[:-(int(self.gop_seconds * self.fps) + 4)]
                index += 1
                if self.sm.state == ACTIVE:
                    self.stats.hd_frames_decoded += 1
                activated_now = False
                # --- chequeo de presencia sobre el "sub-stream" (2 fps) ---
                if t + 1e-6 >= next_sub:
                    next_sub += self.sub_interval
                    if next_sub <= t:
                        next_sub = t + self.sub_interval
                    small = cv2.resize(frame, SUB_SIZE, interpolation=cv2.INTER_AREA)
                    moving = False
                    if not getattr(self.cfg, 'detection_blocked', False):
                        if self.change.should_detect(small, t):
                            self.yolo_calls += 1
                            moving = self.sub_gate.update(self.detect_boxes(small), SUB_SIZE[0], SUB_SIZE[1], t)
                        moving = moving or self.change.sustained_change
                    self.sub_checks += 1
                    if self.sm.observe(t, moving) == 'activate':
                        self.stats.activations += 1
                        self.activation_times.append(t)
                        decode_from = gop_start
                        self.stats.hd_frames_decoded += int(round((t - gop_start) * native)) + 1
                        sched = FrameScheduler(interval)
                        for tc, fc in cand:
                            if last_ts is not None and tc <= last_ts:
                                continue  # ya analizado en la activacion anterior
                            if sched.due(tc, interval):
                                step = deliver(tc, fc)
                                if step is not None:
                                    yield step
                        activated_now = True
                if self.sm.state == ACTIVE and not activated_now:
                    if (last_ts is None or t > last_ts) and sched.due(t, interval):
                        step = deliver(t, frame)
                        if step is not None:
                            yield step
                if self.sm.tick(t) == 'deactivate':
                    if decode_from is not None:
                        self.stats.active_seconds += t - decode_from
                        self.intervals.append((decode_from, t))
                        decode_from = None
                    yield RestStep('flush', t, t - skipped, None)
        finally:
            cap.release()
        self.stats.total_seconds += t
        if decode_from is not None:
            self.stats.active_seconds += t - decode_from
            self.intervals.append((decode_from, t))
