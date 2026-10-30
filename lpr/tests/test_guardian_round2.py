"""Ronda de correcciones del Guardián (QA y seguridad): aviso perdido si el POST
falla (`forget_emission`), hueco máximo de acumulación por intervalo de muestreo,
backoff de zonas al arrancar sin backend, clamp del refetch, zonas solapadas,
cambio de tamaño de cuadro y saneo del `--label` del replay."""
import importlib
import sys
import threading
import types
from types import SimpleNamespace

import numpy as np
import pytest

from lpr.processor.guardian_rules import (
    ANOMALY_INTRUSION,
    ANOMALY_LOITERING,
    GuardianConfig,
    GuardianRules,
    LegacyRules,
    max_gap_for_poll_interval,
    parse_guardian_zones,
)
from lpr.tools import guardian_replay as gr

WH = (1000, 1000)
FRAME = np.zeros((1000, 1000, 3), dtype=np.uint8)
SQUARE = [{'x': 0.4, 'y': 0.4}, {'x': 0.6, 'y': 0.4}, {'x': 0.6, 'y': 0.6}, {'x': 0.4, 'y': 0.6}]
IN_ZONE = (480.0, 420.0, 520.0, 580.0)


def intrusion_zone():
    return parse_guardian_zones([SQUARE])[0]


def loiter_zone(seconds=10):
    return parse_guardian_zones([{'points': SQUARE, 'type': 'loitering', 'loiterSeconds': seconds}])[0]


def make(zones=(), **cfg):
    rules = GuardianRules(GuardianConfig(**cfg))
    rules.set_zones(zones)
    return rules


def run(rules, t0, seconds, box, tid=1, step=1.0):
    out = []
    t = t0
    while t <= t0 + seconds + 1e-9:
        for d in rules.update(t, [(tid, box, 0.9)], WH):
            out.append((t, d))
        t += step
    return out


# ----------------------------------------------------------------------------
# forget_emission (reglas)
# ----------------------------------------------------------------------------
def test_forget_emission_lets_the_same_track_realert_next_frame():
    rules = make([intrusion_zone()])
    found = run(rules, 0.0, 2.0, IN_ZONE)
    assert len(found) == 1
    assert rules.update(3.0, [(1, IN_ZONE, 0.9)], WH) == []  # cooldown vigente
    rules.forget_emission(found[0][1])
    assert len(rules.update(4.0, [(1, IN_ZONE, 0.9)], WH)) == 1


def test_forget_emission_also_clears_zone_suppression_for_a_new_id():
    rules = make([intrusion_zone()], relink_seconds=0.0)
    first = run(rules, 0.0, 2.0, IN_ZONE, tid=1)
    rules.forget_emission(first[0][1])
    assert len(run(rules, 5.0, 3.0, IN_ZONE, tid=2)) == 1  # sin forget estaría suprimido


def test_forget_emission_keeps_a_newer_zone_alert_of_someone_else():
    rules = make([intrusion_zone()], relink_seconds=0.0, intrusion_zone_cooldown=5.0)
    first = run(rules, 0.0, 2.0, IN_ZONE, tid=1)
    second = run(rules, 10.0, 2.0, IN_ZONE, tid=2)
    assert len(second) == 1
    rules.forget_emission(first[0][1])  # tardío: la supresión vigente es la del track 2
    assert rules._zone_alerts[(0, ANOMALY_INTRUSION)].ts == second[0][1].emitted_at


def test_forget_emission_on_legacy_rules():
    legacy = LegacyRules()
    legacy.set_zones([intrusion_zone()])
    found = run(legacy, 0.0, 2.0, IN_ZONE)
    legacy.forget_emission(found[0][1])
    assert len(legacy.update(3.0, [(1, IN_ZONE, 0.9)], WH)) == 1


# ----------------------------------------------------------------------------
# max_gap_seconds
# ----------------------------------------------------------------------------
def test_max_gap_for_poll_interval():
    assert max_gap_for_poll_interval(10.0) == 30.0
    assert max_gap_for_poll_interval(1.0) == 5.0
    assert max_gap_for_poll_interval(None) == 5.0
    assert max_gap_for_poll_interval('x') == 5.0
    assert max_gap_for_poll_interval(float('inf')) == 5.0


def test_slow_polling_still_accumulates_loitering_with_max_gap():
    # Un cuadro cada 10 s: cada hueco normal (10 s) supera los 5 s por defecto.
    slow = make([loiter_zone(seconds=25)], max_gap_seconds=max_gap_for_poll_interval(10.0))
    found = run(slow, 0.0, 40.0, IN_ZONE, step=10.0)
    assert [(t, d.type) for t, d in found] == [(30.0, ANOMALY_LOITERING)]
    # Con el hueco por defecto (5 s) la presencia siempre parece interrumpida.
    assert run(make([loiter_zone(seconds=25)]), 0.0, 40.0, IN_ZONE, step=10.0) == []


def test_max_gap_is_independent_from_relink_seconds():
    rules = make([loiter_zone(seconds=25)], max_gap_seconds=30.0, relink_seconds=5.0)
    assert len(run(rules, 0.0, 40.0, IN_ZONE, step=10.0)) == 1


# ----------------------------------------------------------------------------
# Zonas solapadas y cambio de tamaño de cuadro
# ----------------------------------------------------------------------------
def test_overlapping_intrusion_and_loitering_zones_raise_both():
    rules = make([intrusion_zone(), loiter_zone(seconds=10)])  # misma área
    found = run(rules, 0.0, 14.0, IN_ZONE)
    assert [(t, d.type, d.zone_index) for t, d in found] == [
        (2.0, ANOMALY_INTRUSION, 0), (11.0, ANOMALY_LOITERING, 1)]


def test_frame_size_change_midstream_does_not_crash_and_zones_follow_the_new_size():
    """Comportamiento documentado: los píxeles de las zonas se recalculan con el
    tamaño de cada cuadro (cache por tamaño); las cajas se interpretan siempre en
    los píxeles del cuadro que las produjo; el estado de los tracks se conserva."""
    rules = make([intrusion_zone()])
    rules.update(0.0, [(1, IN_ZONE, 0.9)], WH)
    rules.update(1.0, [(1, IN_ZONE, 0.9)], WH)
    # La cámara pasa a 500x500: la zona ahora son 200-300 px y la MISMA caja en píxeles
    # queda fuera, así que no hay aviso aunque el track ya era estable.
    assert rules.update(2.0, [(1, IN_ZONE, 0.9)], (500, 500)) == []
    # La caja equivalente en el tamaño nuevo sí cae dentro y conserva los hits.
    assert len(rules.update(3.0, [(1, (240.0, 210.0, 260.0, 290.0), 0.9)], (500, 500))) == 1
    assert len(rules.zone_pixel_polygons((500, 500))) == 1 and len(rules.zone_pixel_polygons(WH)) == 1


# ----------------------------------------------------------------------------
# Worker
# ----------------------------------------------------------------------------
class FakeSubtractor:
    def apply(self, frame):
        mask = np.zeros(frame.shape[:2], dtype=np.uint8)
        mask[450:480, 450:480] = 255
        return mask


class FakeBoxes:
    def __init__(self, items):
        self.items = items

    def __len__(self):
        return len(self.items)

    def __iter__(self):
        return iter(self.items)


class FakeModel:
    def __init__(self):
        self.people = [(9, IN_ZONE)]

    def track(self, frame, **kwargs):
        boxes = [SimpleNamespace(id=SimpleNamespace(item=lambda t=t: t), xyxy=np.array([list(b)]),
                                 conf=SimpleNamespace(item=lambda: 0.9)) for t, b in self.people]
        return [SimpleNamespace(boxes=FakeBoxes(boxes))]


@pytest.fixture
def gw(monkeypatch):
    try:
        importlib.import_module('ultralytics')
    except ImportError:
        module = types.ModuleType('ultralytics')
        module.YOLO = object
        monkeypatch.setitem(sys.modules, 'ultralytics', module)
    return importlib.import_module('lpr.processor.guardian_worker')


def make_cfg(**over):
    base = dict(backend_url='http://backend.test/api/v1/detections', camera_id='cam-1_guardia',
                rtsp_url='rtsp://x', poll_interval=1.0, dry_run=True, include_snapshot=False, device=None)
    base.update(over)
    return SimpleNamespace(**base)


def intrusion_worker(gw, monkeypatch, statuses):
    sent = []

    def fake_post(url, payload, dry_run=True):
        sent.append(payload)
        return statuses.pop(0) if len(statuses) > 1 else statuses[0]

    monkeypatch.setattr(gw, 'post_anomaly', fake_post)
    monkeypatch.setattr(gw, 'fetch_camera_json',
                        lambda *a, **k: {'enableGuardian': True, 'guardianZones': [SQUARE]})
    worker = gw.GuardianWorker(make_cfg(), model=FakeModel(), start_zones_thread=False)
    worker.pipeline.gate._sub = FakeSubtractor()
    return worker, sent


def test_failed_post_forgets_the_emission_so_the_next_frame_realerts(gw, monkeypatch):
    worker, sent = intrusion_worker(gw, monkeypatch, [503, 201])
    for _ in range(3):
        worker._process_frame(FRAME)
    assert len(sent) == 1
    worker._process_frame(FRAME)
    assert len(sent) == 2  # sin forget_emission el cooldown lo bloquearía
    worker._process_frame(FRAME)
    assert len(sent) == 2  # entregado: el cooldown ahora sí manda


@pytest.mark.parametrize('status', [-1, 500, 401])
def test_not_delivered_statuses_forget_the_emission(gw, monkeypatch, status):
    worker, sent = intrusion_worker(gw, monkeypatch, [status])
    for _ in range(5):
        worker._process_frame(FRAME)
    assert len(sent) == 3  # alerta en los frames 3, 4 y 5


@pytest.mark.parametrize('status', [-2, 200, 201])
def test_delivered_or_maybe_sent_keep_the_cooldown(gw, monkeypatch, status):
    worker, sent = intrusion_worker(gw, monkeypatch, [status])
    for _ in range(6):
        worker._process_frame(FRAME)
    assert len(sent) == 1  # MAYBE_SENT: reintentar duplicaría el aviso


def test_zones_loop_retries_with_short_backoff_when_the_first_load_failed(gw, monkeypatch):
    calls = []
    loaded = threading.Event()

    def fake_fetch(*args, **kwargs):
        calls.append(1)
        if len(calls) < 4:  # la carga inicial y 2 reintentos fallan (backend aún no levanta)
            return None
        loaded.set()
        return {'enableGuardian': True, 'guardianZones': [SQUARE]}

    monkeypatch.setattr(gw, 'fetch_camera_json', fake_fetch)
    monkeypatch.setattr(gw, 'ZONES_BACKOFF_BASE_SECONDS', 0.02)
    monkeypatch.setattr(gw.settings, 'LPR_ZONES_REFETCH_SECONDS', 600.0)  # el intervalo normal NO se espera
    worker = gw.GuardianWorker(make_cfg(), model=FakeModel())
    assert worker.guardian_zones == () and worker._zones_ok is False
    worker._ensure_zones_thread()
    try:
        assert loaded.wait(3.0), 'debió reintentar con backoff y no esperar el intervalo normal'
        for _ in range(100):
            if worker.guardian_zones and worker._zones_ok:
                break
            threading.Event().wait(0.02)
        assert len(worker.guardian_zones) == 1 and worker._zones_ok is True
    finally:
        worker._stop_zones.set()
        worker._zones_thread.join(2.0)


def test_zones_delay_backoff_is_capped_by_the_normal_interval(gw):
    delay = gw.GuardianWorker._zones_delay
    assert [delay(60.0, n) for n in range(8)] == [60.0, 2.0, 4.0, 8.0, 16.0, 32.0, 60.0, 60.0]


@pytest.mark.parametrize('configured, expected', [(1.0, 5.0), (0.1, 5.0), (5.0, 5.0), (60.0, 60.0)])
def test_refetch_interval_is_clamped_to_five_seconds(gw, monkeypatch, configured, expected):
    monkeypatch.setattr(gw.settings, 'LPR_ZONES_REFETCH_SECONDS', configured)
    assert gw.GuardianWorker._refetch_interval() == expected


def test_ensure_zones_thread_uses_the_clamped_interval(gw, monkeypatch):
    seen = []
    monkeypatch.setattr(gw.settings, 'LPR_ZONES_REFETCH_SECONDS', 1.0)
    monkeypatch.setattr(gw, 'fetch_camera_json', lambda *a, **k: None)
    worker = gw.GuardianWorker(make_cfg(), model=FakeModel())
    monkeypatch.setattr(worker, '_zones_loop', lambda refetch: seen.append(refetch))
    worker._ensure_zones_thread()
    worker._zones_thread.join(2.0)
    assert seen == [5.0]


def test_worker_passes_poll_interval_to_the_rules(gw, monkeypatch):
    monkeypatch.setattr(gw, 'fetch_camera_json', lambda *a, **k: None)
    slow = gw.GuardianWorker(make_cfg(poll_interval=10.0), model=FakeModel(), start_zones_thread=False)
    fast = gw.GuardianWorker(make_cfg(poll_interval=1.0), model=FakeModel(), start_zones_thread=False)
    assert slow.rules.config.max_gap_seconds == 30.0 and fast.rules.config.max_gap_seconds == 5.0


# ----------------------------------------------------------------------------
# Replay
# ----------------------------------------------------------------------------
@pytest.mark.parametrize('label, expected', [
    ('despues', 'despues'), ('v1.2-b_3', 'v1.2-b_3'), ('../../etc/x', '____etc_x'), ('a/b\\c', 'a_b_c'),
    ('..', '_'), ('', 'config'), ('con espacio:*?', 'con_espacio___'), ('a..b', 'a_b'),
])
def test_sanitize_label(label, expected):
    out = gr.sanitize_label(label)
    assert out == expected
    assert not set(out) & set('/\\:') and '..' not in out


def test_build_rules_uses_the_poll_interval_for_the_max_gap():
    assert gr.build_rules('current', [], 10.0).config.max_gap_seconds == 30.0
    assert gr.build_rules('current', [], 1.0).config.max_gap_seconds == 5.0
