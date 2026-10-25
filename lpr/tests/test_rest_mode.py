"""Modo reposo del LPR: logica pura, lector de streams con sesion falsa, ruteo del
worker y emulacion offline. Sin PyAV ni ultralytics (patentes y videos sinteticos)."""
import importlib
import sys
import threading
import time
import types
from types import SimpleNamespace

import numpy as np
import pytest

from lpr.settings import WorkerConfig, settings
from lpr.utils.rest_mode import (
    ACTIVE, IDLE, MotionGate, PacketRing, RestController, RestStateMachine, RingOverrun,
    derive_substream_url,
)
from lpr.utils.stream_reader import DecodedFrame, RawPacket, StreamReader, av_available

ZONE = [[{'x': 0.2, 'y': 0.2}, {'x': 0.8, 'y': 0.2}, {'x': 0.8, 'y': 1.0}, {'x': 0.2, 'y': 1.0}]]
W, H = 640.0, 360.0


# --------------------------------------------------------------------- URL --
@pytest.mark.parametrize('url,expected', [
    ('rtsp://u:p%40ss@relay:8554/porton-hd', 'rtsp://u:p%40ss@relay:8554/porton'),
    ('rtsp://relay:8554/live/estacionamiento-03-hd', 'rtsp://relay:8554/live/estacionamiento-03'),
    ('rtsp://relay:8554/porton-HD/', 'rtsp://relay:8554/porton/'),
    ('rtsp://relay:8554/porton-hd?x=1', 'rtsp://relay:8554/porton?x=1'),
])
def test_derive_substream_url(url, expected):
    assert derive_substream_url(url) == expected


@pytest.mark.parametrize('url', [None, '', 'rtsp://relay:8554/porton', 'rtsp://relay:8554/-hd', 'rtsp://relay:8554/',
                                 'no-es-una-url-hd', 'rtsp://relay:8554/hd-porton'])
def test_derive_substream_url_sin_sub_stream(url):
    assert derive_substream_url(url) is None


# ------------------------------------------------------------------- anillo --
def fill(ring, seconds, fps=10, gop=2.0, size=100, t0=0.0, start_key=True):
    seqs = []
    n = int(seconds * fps)
    for i in range(n):
        t = t0 + i / fps
        key = (i % int(gop * fps) == 0) if start_key else False
        seqs.append(ring.append(t, key, size, f'p{i}'))
    return seqs


def test_anillo_descarta_paquetes_previos_al_primer_keyframe():
    ring = PacketRing()
    assert ring.append(0.0, False, 10, 'x') is None
    assert len(ring) == 0
    assert ring.append(0.1, True, 10, 'k') == 0
    assert ring.append(0.2, False, 10, 'p') == 1


def test_anillo_acotado_por_tiempo_y_alineado_a_gops():
    ring = PacketRing(max_seconds=5.0)
    fill(ring, 60)
    assert ring.span_seconds() >= 5.0 - 0.1
    assert ring.span_seconds() <= 5.0 + 2.0 + 0.2       # nunca mas de 5 s + 1 GOP
    assert ring.gop_count() >= 2                          # >= 2 GOPs
    assert ring.get(ring.first_seq).key                   # siempre empieza en keyframe


def test_anillo_acotado_por_bytes_mantiene_al_menos_un_gop():
    ring = PacketRing(max_seconds=100.0, max_bytes=1500)
    fill(ring, 30, size=100)
    assert ring.total_bytes <= 1500 + 20 * 100            # a lo sumo un GOP de exceso
    assert ring.gop_count() >= 1
    assert ring.get(ring.first_seq).key


def test_anillo_busqueda_de_ultimo_keyframe_y_overrun():
    ring = PacketRing(max_seconds=3.0)
    seqs = fill(ring, 20)
    last_key = ring.last_key_seq()
    assert ring.get(last_key).key
    assert last_key % 20 == 0 and last_key > ring.first_seq
    assert ring.key_after(last_key) is None
    assert ring.key_after(last_key - 1) == last_key
    with pytest.raises(RingOverrun):
        ring.get(seqs[0])


def test_anillo_clear_conserva_la_numeracion_y_cambia_la_generacion():
    ring = PacketRing()
    fill(ring, 3)
    gen, head = ring.generation, ring.next_seq
    ring.clear()
    assert len(ring) == 0 and ring.generation == gen + 1 and ring.first_seq == head
    assert ring.append(0.0, True, 1, 'k') == head


def test_anillo_wait_get_despierta_con_un_paquete_nuevo():
    ring = PacketRing()
    ring.append(0.0, True, 1, 'k')
    out = []
    t = threading.Thread(target=lambda: out.append(ring.wait_get(1, 2.0)))
    t.start()
    time.sleep(0.05)
    ring.append(0.1, False, 1, 'p')
    t.join(2)
    assert out and out[0].payload == 'p'
    assert ring.wait_get(5, 0.01) is None


# ------------------------------------------------------------- compuerta --
def car(cx, bottom=300, w=120, h=90):
    return (cx - w / 2, bottom - h, cx + w / 2, bottom)


def run_gate(gate, frames, dt=0.5):
    out = []
    for i, boxes in enumerate(frames):
        out.append(gate.update(boxes, W, H, i * dt))
    return out


def test_auto_estacionado_dentro_de_la_zona_nunca_dispara_aunque_parpadee():
    gate = MotionGate(ZONE)
    frames = [[car(320)], [car(322)], [], [car(318)], [car(321)], [], [car(320)]] * 5
    assert not any(run_gate(gate, frames))


def test_auto_estacionado_fuera_de_la_zona_no_dispara_ni_moviendose():
    gate = MotionGate(ZONE)
    frames = [[car(60)]] * 3 + [[car(100)], [car(120)], [car(30)]]   # cx fuera de x 0.2..0.8
    assert not any(run_gate(gate, frames))


def test_auto_que_cruza_la_zona_dispara():
    gate = MotionGate(ZONE)
    frames = [[], [], [car(150)], [car(250)], [car(350)], [car(450)]]
    res = run_gate(gate, frames)
    assert res[2] is True and res[3] is True and not any(res[:2])


def test_auto_estacionado_que_arranca_dispara():
    gate = MotionGate(ZONE)
    frames = [[car(320)]] * 4 + [[car(360)]]
    res = run_gate(gate, frames)
    assert res[:4] == [False] * 4 and res[4] is True


def test_caja_chica_no_dispara():
    gate = MotionGate(ZONE)
    frames = [[], [], [car(150, h=30)], [car(300, h=30)]]
    assert not any(run_gate(gate, frames))


def test_calentamiento_no_cuenta_los_autos_ya_presentes():
    gate = MotionGate(ZONE, warmup_seconds=1.0)
    assert gate.update([car(320)], W, H, 0.0) is False
    assert gate.update([car(320)], W, H, 0.5) is False


def test_sin_zona_vale_todo_el_cuadro():
    gate = MotionGate(None)
    assert run_gate(gate, [[], [], [car(40)], [car(200)]])[-1] is True


def test_movimiento_lento_a_8_fps_se_mide_contra_historial_antiguo():
    gate = MotionGate(ZONE)
    # 1.5 % del ancho por cuadro a 8 fps: contra el cuadro previo no basta, contra 0.4 s atras si.
    res = [gate.update([car(150 + i * 9.6)], W, H, i * 0.125) for i in range(20)]
    assert any(res[4:])


# ------------------------------------------------------------ maquina -----
def test_maquina_dispara_extiende_y_vuelve_a_reposo():
    sm = RestStateMachine(idle_seconds=4.0)
    assert sm.state == IDLE
    assert sm.observe(0.0, False) is None and sm.tick(10.0) is None
    assert sm.observe(1.0, True) == 'activate' and sm.state == ACTIVE
    assert sm.observe(2.0, True) is None              # ya activo: solo refresca
    sm.touch(4.0)                                      # evidencia del HD
    assert sm.tick(7.9) is None
    assert sm.tick(8.0) == 'deactivate' and sm.state == IDLE
    assert sm.observe(20.0, True) == 'activate' and sm.activations == 2


def test_touch_en_reposo_no_activa():
    sm = RestStateMachine(4.0)
    sm.touch(5.0)
    assert sm.state == IDLE


def test_controlador_callbacks_y_porcentaje_activo():
    clock = [0.0]
    calls = []
    ctl = RestController(4.0, lambda: calls.append('on'), lambda: calls.append('off'), clock=lambda: clock[0])
    clock[0] = 10.0
    assert ctl.observe(True) is True
    clock[0] = 20.0
    ctl.touch()
    clock[0] = 24.0
    assert ctl.tick() is True
    assert calls == ['on', 'off']
    clock[0] = 60.0
    window = ctl.poll_window(60.0)
    assert window['state'] == IDLE
    assert window['active_pct'] == pytest.approx(100.0 * 14 / 60, abs=0.01)   # activo de 10 a 24
    assert window['activations'] == 1


# ------------------------------------------------------------- lector -----
class FakeSession:
    """Sesion falsa: entrega paquetes encolados (GOP de 10 paquetes, 10 pkt/s)."""

    def __init__(self, count=0, fail=False):
        self.queue = []
        self.closed = False
        self.flushes = 0
        self.decoded = []
        self.fail = fail
        self.release = threading.Event()
        self.count = count
        self.decode_error_at = None

    def packets(self):
        i = 0
        while not self.closed:
            if i < self.count:
                yield RawPacket(i / 10.0, i % 10 == 0, 50, i)
                i += 1
            elif self.fail:
                raise RuntimeError('boom')
            else:
                if self.release.wait(0.01):
                    return
        return

    def decode(self, payload):
        if payload == self.decode_error_at:
            raise RuntimeError('corrupt')
        self.decoded.append(payload)
        return [DecodedFrame(payload / 10.0, lambda p=payload: np.full((2, 2, 3), p % 250, np.uint8))]

    def flush(self):
        self.flushes += 1

    def close(self):
        self.closed = True


def make_reader(sessions, **kw):
    it = iter(sessions)

    def factory():
        s = next(it, None)
        if s is None:
            raise ConnectionError('no more')
        return s

    return StreamReader('t', 'rtsp://x/y', session_factory=factory, sleep=lambda _s: None,
                        ring_seconds=kw.pop('ring_seconds', 3.0), **kw)


def wait_for(cond, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


def test_lector_demuxa_sin_decodificar_y_activar_arranca_del_ultimo_keyframe():
    sess = FakeSession(count=75)
    reader = make_reader([sess], ring_seconds=3.0)
    reader.start()
    try:
        assert wait_for(lambda: reader.ring.next_seq >= 75)
        assert sess.decoded == []                       # reposo: nada se decodifica
        assert reader.ring.span_seconds() < 3.0 + 1.0 + 0.2
        last_key = reader.ring.last_key_seq()
        assert last_key == 70
        reader.activate()
        frames = []
        while len(frames) < 5:
            got = reader.next_frames(0.5)
            if not got:
                break
            frames += got
        assert [int(round(f.ts - frames[0].ts, 1) * 10) for f in frames] == [0, 1, 2, 3, 4]
        assert sess.decoded[0] == 70                    # desde el ultimo keyframe, no antes
        assert sess.flushes >= 1
        assert all(f.catchup for f in frames)
        assert frames[0].activation == 1
    finally:
        reader.stop()


def test_lector_desactivar_detiene_el_decode_pero_sigue_el_demux():
    sess = FakeSession(count=30)
    reader = make_reader([sess])
    reader.start()
    try:
        assert wait_for(lambda: reader.ring.next_seq >= 30)
        reader.activate()
        assert reader.next_frames(0.5)
        reader.deactivate()
        before = len(sess.decoded)
        assert reader.next_frames(0.05) == []
        assert len(sess.decoded) == before
        assert reader.ring.next_seq == 30
    finally:
        reader.stop()


def test_lector_cuadros_en_vivo_no_son_catchup():
    sess = FakeSession(count=0)
    reader = make_reader([sess])
    reader.start()
    try:
        reader.activate()
        sess.count = 10
        got = []
        assert wait_for(lambda: (got.extend(reader.next_frames(0.2)) or len(got) >= 3))
        assert not any(f.catchup for f in got)
    finally:
        reader.stop()


def test_lector_error_de_decode_espera_el_proximo_keyframe():
    sess = FakeSession(count=45)
    sess.decode_error_at = 42
    reader = make_reader([sess], ring_seconds=10.0)
    reader.start()
    try:
        assert wait_for(lambda: reader.ring.next_seq >= 45)
        reader.activate()
        reader.next_frames(0.5)                        # arranca en el keyframe 40
        reader.next_frames(0.5)
        assert reader.next_frames(0.5) == []            # 42 falla
        assert reader.decode_errors == 1
        assert reader.next_frames(0.1) == []            # sin keyframe nuevo, espera
        assert sess.decoded == [40, 41]
    finally:
        reader.stop()


def test_lector_reconecta_y_marca_failed_al_agotar_intentos():
    s1 = FakeSession(count=3, fail=True)
    reader = make_reader([s1], max_attempts=2)
    reader.start()
    try:
        assert wait_for(lambda: reader.failed)
        assert reader.reconnects >= 1
    finally:
        reader.stop()


def test_lector_reconexion_exitosa_limpia_el_anillo():
    s1 = FakeSession(count=30, fail=True)
    s2 = FakeSession(count=5)
    reader = make_reader([s1, s2], max_attempts=3)
    reader.start()
    try:
        assert wait_for(lambda: reader.reconnects >= 1 and reader.ring.generation >= 2)
        assert not reader.failed
    finally:
        reader.stop()


def test_stream_reader_importa_sin_av(monkeypatch):
    monkeypatch.setitem(sys.modules, 'av', None)
    assert av_available() is False
    importlib.reload(sys.modules['lpr.utils.stream_reader'])


# ------------------------------------------------------------- worker -----
def _stub(monkeypatch, name, **attrs):
    try:
        importlib.import_module(name)
    except ImportError:
        module = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(module, k, v)
        monkeypatch.setitem(sys.modules, name, module)


@pytest.fixture
def worker_module(monkeypatch):
    _stub(monkeypatch, 'ultralytics', YOLO=object)
    _stub(monkeypatch, 'huggingface_hub', hf_hub_download=lambda **_: None)
    return importlib.import_module('lpr.processor.worker')


def make_worker(worker_module, tmp_path, url):
    cfg = WorkerConfig(camera_id='6f1c2a40-0000-4000-8000-000000000001', backend_url='http://b.test/api/v1/d',
                       detections_dir=str(tmp_path), sample_fps=8.0, poll_interval=0.125, rtsp_url=url)
    return worker_module.LprWorker(cfg, lambda _f, _c: [], SimpleNamespace())


@pytest.fixture
def rest_env(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_REST_MODE', True)
    monkeypatch.setattr('lpr.utils.stream_reader.av_available', lambda: True)


def test_worker_reposo_apagado_usa_el_bucle_normal(worker_module, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'LPR_REST_MODE', False)
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    assert w._rest_substream_url() is None
    w.executor.shutdown(wait=False)


def test_worker_reposo_deriva_el_sub_stream(worker_module, tmp_path, rest_env):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    assert w._rest_substream_url() == 'rtsp://relay:8554/porton'
    w.executor.shutdown(wait=False)


def test_worker_reposo_sin_sufijo_hd_cae_al_bucle_normal(worker_module, tmp_path, rest_env):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton')
    assert w._rest_substream_url() is None
    w.executor.shutdown(wait=False)


def test_worker_reposo_sin_pyav_cae_al_bucle_normal(worker_module, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'LPR_REST_MODE', True)
    monkeypatch.setattr('lpr.utils.stream_reader.av_available', lambda: False)
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    assert w._rest_substream_url() is None
    w.executor.shutdown(wait=False)


def test_start_capture_loop_con_reposo_apagado_corre_el_bucle_viejo(worker_module, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'LPR_REST_MODE', False)
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    monkeypatch.setattr(w, 'start_settings_sync', lambda: None)
    monkeypatch.setattr(w, '_start_rest_loop', lambda *a: pytest.fail('no debe entrar al modo reposo'))
    seen = []

    class Cap:
        def read(self):
            seen.append(1)
            raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        w.start_capture_loop(Cap())
    assert seen == [1]


def test_start_capture_loop_reposo_sin_modelo_cae_al_bucle_viejo(worker_module, tmp_path, rest_env, monkeypatch):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    monkeypatch.setattr(w, 'start_settings_sync', lambda: None)
    import lpr.processor.vehicle_presence as vp
    monkeypatch.setattr(vp.VehicleBoxDetector, '__init__', lambda self, **kw: setattr(self, 'available', False))

    class Cap:
        released = False

        def read(self):
            raise KeyboardInterrupt

        def release(self):
            Cap.released = True

    with pytest.raises(KeyboardInterrupt):
        w.start_capture_loop(Cap())
    assert Cap.released is False                      # no toco la captura


def test_submit_frame_bloqueante_espera_al_cuadro_en_curso(worker_module, tmp_path):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    gate = threading.Event()
    done = []

    def slow(frame, now_ts=None, track_now=None):
        gate.wait(2)
        done.append((now_ts, track_now))

    w._process_frame = slow
    frame = np.zeros((4, 4, 3), np.uint8)
    w.submit_frame(frame, now_ts=1.0, track_now=1.0)
    w.submit_frame(frame, now_ts=2.0, track_now=2.0)             # sin block: se descarta
    assert w._throughput._dropped == 1
    threading.Timer(0.1, gate.set).start()
    w.submit_frame(frame, now_ts=3.0, track_now=3.0, block=True)  # espera y se procesa
    w.processing_future.result(2)
    assert [d[0] for d in done] == [1.0, 3.0]
    w.executor.shutdown(wait=False)


def test_process_frame_usa_el_reloj_del_pipeline_y_la_hora_real(worker_module, tmp_path, monkeypatch):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    seen = {}

    def fake_process(frame, detector, ocr, cfg, tracker, now, **kw):
        seen['clock'] = now
        return [], [SimpleNamespace(text='ZZ')]

    monkeypatch.setattr(worker_module, 'process_frame', fake_process)
    monkeypatch.setattr(w, '_ensure_vehicle_tracker', lambda cfg: None)
    monkeypatch.setattr(w, '_handle_emission', lambda frame, em, ts: seen.setdefault('wall', ts))
    w._process_frame(np.zeros((4, 4, 3), np.uint8), 1000.0, 40.0)
    assert seen == {'clock': 40.0, 'wall': 1000.0}
    w.executor.shutdown(wait=False)


def test_desactivar_libera_los_pendientes_y_para_el_hd(worker_module, tmp_path):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    calls = []
    w._rest = SimpleNamespace(hd=SimpleNamespace(deactivate=lambda: calls.append('hd-off'),
                                                 activate=lambda: calls.append('hd-on')))
    w.flush_pending = lambda: calls.append('flush') or 2
    w._rest_activate()
    w._rest_deactivate()
    assert calls == ['hd-on', 'hd-off', 'flush']
    w.executor.shutdown(wait=False)


def test_vehicle_tracker_current_devuelve_los_vistos_en_el_cuadro():
    from lpr.processor.vehicle_tracker import VehicleTracker

    class Box:
        def __init__(self, i, xyxy):
            self.id = SimpleNamespace(item=lambda: i)
            self.cls = SimpleNamespace(item=lambda: 2)
            self.xyxy = [SimpleNamespace(tolist=lambda: list(xyxy))]

    class Model:
        def __init__(self):
            self.n = 0

        def track(self, image, **kw):
            self.n += 1
            boxes = [Box(1, (0, 0, 10, 10))] + ([Box(2, (50, 50, 60, 60))] if self.n == 1 else [])
            return [SimpleNamespace(boxes=boxes)]

    vt = VehicleTracker(model=Model(), sample_fps=8.0)
    vt.update(np.zeros((100, 100, 3), np.uint8), (0, 0), 1.0)
    assert len(vt.current(1.0)) == 2
    vt.update(np.zeros((100, 100, 3), np.uint8), (0, 0), 2.0)
    assert len(vt.current(2.0)) == 1 and [i for i, _ in vt.current(1.0)] != [i for i, _ in vt.current(2.0)]


# ------------------------------------------------------------- emulacion --
def write_video(path, seconds=24, fps=10, car_from=9.0, car_to=13.0):
    import cv2

    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'mp4v'), fps, (1280, 720))
    if not writer.isOpened():
        pytest.skip('sin codec mp4v')
    for i in range(int(seconds * fps)):
        frame = np.zeros((720, 1280, 3), np.uint8)
        t = i / fps
        if car_from <= t <= car_to:
            x = int(300 + (t - car_from) / (car_to - car_from) * 600)
            frame[400:560, x:x + 220] = 255
        writer.write(frame)
    writer.release()


def bright_box_detector(small):
    ys, xs = np.where(small[:, :, 0] > 128)
    if len(xs) < 50:
        return []
    return [(float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()))]


def test_emulacion_procesa_solo_mientras_hay_movimiento_e_incluye_el_pre_trigger(tmp_path):
    from lpr.tools.rest_replay import RestReplay

    clip = tmp_path / 'c.mp4'
    write_video(clip)
    cfg = SimpleNamespace(sample_fps=4.0, zone=None, detection_blocked=False)
    rest = RestReplay(cfg, bright_box_detector, idle_seconds=2.0, gop_seconds=2.0)
    steps = list(rest.steps(clip))
    frames = [s for s in steps if s.kind == 'frame']
    flushes = [s for s in steps if s.kind == 'flush']
    assert frames and len(flushes) == 1
    # el coche empieza en t=9: el primer cuadro entregado es el del keyframe previo (t=8, GOP de 2 s)
    assert frames[0].t == pytest.approx(8.0, abs=0.11)
    assert frames[-1].t < 19.0
    # muestreado por timestamp: 4 fps
    gaps = np.diff([f.t for f in frames])
    assert gaps.max() < 0.31 and gaps.min() > 0.19
    assert 0 < rest.stats.active_pct < 60
    assert rest.stats.activations == 1
    assert flushes[0].t >= frames[-1].t


def test_emulacion_sin_vehiculo_no_entrega_cuadros(tmp_path):
    from lpr.tools.rest_replay import RestReplay

    clip = tmp_path / 'c.mp4'
    write_video(clip, car_from=100, car_to=101)
    rest = RestReplay(SimpleNamespace(sample_fps=4.0, zone=None, detection_blocked=False), bright_box_detector)
    assert list(rest.steps(clip)) == []
    assert rest.stats.active_pct == 0.0


def test_emulacion_reloj_del_pipeline_comprime_los_huecos(tmp_path):
    from lpr.tools.rest_replay import RestReplay

    clip = tmp_path / 'c.mp4'
    import cv2

    writer = cv2.VideoWriter(str(clip), cv2.VideoWriter_fourcc(*'mp4v'), 10, (1280, 720))
    for i in range(400):
        t = i / 10
        frame = np.zeros((720, 1280, 3), np.uint8)
        for a, b in ((4.0, 7.0), (30.0, 33.0)):
            if a <= t <= b:
                x = int(300 + (t - a) / (b - a) * 600)
                frame[400:560, x:x + 220] = 255
        writer.write(frame)
    writer.release()
    rest = RestReplay(SimpleNamespace(sample_fps=4.0, zone=None, detection_blocked=False), bright_box_detector,
                      idle_seconds=2.0)
    frames = [s for s in rest.steps(clip) if s.kind == 'frame']
    second = [f for f in frames if f.t > 20]
    first = [f for f in frames if f.t < 20]
    assert rest.stats.activations == 2
    # entre el fin de la 1.a activacion y el inicio de la 2.a el reloj del pipeline solo avanza ~1 s
    assert second[0].track_t - first[-1].track_t == pytest.approx(1.0, abs=0.3)
    assert all(b.track_t > a.track_t for a, b in zip(frames, frames[1:]))


def test_sesion_pyav_real_demuxa_y_decodifica_un_archivo(tmp_path):
    pytest.importorskip('av')
    from lpr.utils.stream_reader import AvSession

    clip = tmp_path / 'c.mp4'
    write_video(clip, seconds=3, fps=10, car_from=1.0, car_to=2.0)
    session = AvSession(str(clip), 5.0, 5.0)
    packets = list(session.packets())
    assert packets and packets[0].key and all(p.size > 0 for p in packets)
    frames = []
    for pkt in packets:
        frames += session.decode(pkt.payload)
    assert frames and frames[0].image().shape == (720, 1280, 3)
    session.close()


# ------------------------------------------------------- pre-filtro de cambio --
def test_change_detector_escena_quieta_no_pide_detectar_salvo_el_refresco():
    from lpr.utils.rest_mode import ChangeDetector

    rng = np.random.default_rng(0)
    base = rng.integers(60, 90, (360, 640, 3), dtype=np.uint8)
    cd = ChangeDetector(refresh_seconds=5.0)
    assert cd.should_detect(base, 0.0) is True                      # primer cuadro
    noisy = [np.clip(base.astype(int) + rng.integers(-4, 5, base.shape), 0, 255).astype(np.uint8) for _ in range(6)]
    assert [cd.should_detect(f, 0.5 * (i + 1)) for i, f in enumerate(noisy)][:5] == [False] * 5
    assert cd.should_detect(noisy[5], 5.1) is True                  # refresco


def test_change_detector_dispara_con_un_vehiculo_que_entra_a_la_zona():
    from lpr.utils.rest_mode import ChangeDetector

    cd = ChangeDetector(ZONE, refresh_seconds=100.0)
    empty = np.full((360, 640, 3), 70, np.uint8)
    cd.should_detect(empty, 0.0)
    assert cd.should_detect(empty, 0.5) is False
    car_frame = empty.copy()
    car_frame[200:300, 250:380] = 220
    assert cd.should_detect(car_frame, 1.0) is True


def test_change_detector_ignora_cambios_lejos_de_la_zona():
    from lpr.utils.rest_mode import ChangeDetector

    small_zone = [[{'x': 0.5, 'y': 0.5}, {'x': 0.6, 'y': 0.5}, {'x': 0.6, 'y': 0.6}, {'x': 0.5, 'y': 0.6}]]
    cd = ChangeDetector(small_zone, refresh_seconds=100.0)
    empty = np.full((360, 640, 3), 70, np.uint8)
    cd.should_detect(empty, 0.0)
    moved = empty.copy()
    moved[0:60, 0:100] = 250                                        # esquina: fuera de zona + margen
    assert cd.should_detect(moved, 0.5) is False


# ======================================================================
# Correcciones de QA (H1-H9)
# ======================================================================
class BlockingSession(FakeSession):
    """decode() se bloquea hasta `gate`; detecta cualquier uso despues de close()."""

    def __init__(self, count=30):
        super().__init__(count=count)
        self.gate = threading.Event()
        self.started = threading.Event()
        self.used_after_close = False
        self.close_during_decode = False
        self._in_decode = False

    def packets(self):
        i = 0
        while not self.closed:
            yield RawPacket(i / 10.0, i % 10 == 0, 50, i)
            i += 1
            if i > 30:
                time.sleep(0.01)             # stream vivo: sigue entregando paquetes

    def decode(self, payload):
        self.started.set()
        if self.closed:
            self.used_after_close = True
        self._in_decode = True
        self.gate.wait(3)
        if self.closed:
            self.used_after_close = True
        self._in_decode = False
        return super().decode(payload)

    def close(self):
        if self._in_decode:
            self.close_during_decode = True
        super().close()

    def flush(self):
        if self.closed:
            self.used_after_close = True
        super().flush()


def test_h1_reconexion_con_decode_en_curso_no_usa_la_sesion_cerrada():
    s1 = BlockingSession(count=30)
    s2 = FakeSession(count=5)
    reader = make_reader([s1, s2], max_attempts=3)
    reader.start()
    try:
        assert wait_for(lambda: reader.ring.next_seq >= 30)
        reader.activate()
        out = []
        t = threading.Thread(target=lambda: out.append(reader.next_frames(1.0)))
        t.start()
        assert s1.started.wait(2)
        reader.request_reconnect()                         # el demux quiere cerrar la sesion 1
        time.sleep(0.2)
        assert not s1.closed                               # esperando al decode en curso
        s1.gate.set()
        t.join(3)
        assert wait_for(lambda: s1.closed and reader.reconnects >= 1)
        assert s1.close_during_decode is False and s1.used_after_close is False
    finally:
        s1.gate.set()
        reader.stop()


def test_h9_cursor_no_se_escribe_si_cambio_la_activacion():
    s1 = BlockingSession(count=30)
    reader = make_reader([s1])
    reader.start()
    try:
        assert wait_for(lambda: reader.ring.next_seq >= 30)
        reader.activate()
        out = []
        t = threading.Thread(target=lambda: out.append(reader.next_frames(1.0)))
        t.start()
        assert s1.started.wait(2)
        reader.deactivate()
        s1.gate.set()
        t.join(3)
        assert out == [[]] and reader._cursor is None
    finally:
        s1.gate.set()
        reader.stop()


def test_h2_un_solo_gop_gigante_no_crece_sin_tope():
    ring = PacketRing(max_seconds=5.0, max_bytes=1000, max_items=10_000)
    ring.append(0.0, True, 100, 'k')
    for i in range(1, 100):
        ring.append(i * 0.1, False, 100, i)                 # nunca llega un 2.o keyframe
    assert ring.total_bytes <= 2 * 1000 + 100
    assert ring.append(20.0, False, 10, 'x') is None or ring.get(ring.first_seq).key
    first = ring.first_seq
    if len(ring):
        assert ring.get(first).key                          # siempre alineado a keyframe
    gen = ring.generation
    assert gen >= 1                                         # se vacio al pasar el tope
    assert ring.append(21.0, True, 10, 'k2') is not None    # y retoma en el proximo keyframe


def test_h2_tope_de_items_con_un_solo_gop():
    ring = PacketRing(max_seconds=5.0, max_bytes=10**9, max_items=50)
    ring.append(0.0, True, 1, 'k')
    for i in range(1, 500):
        ring.append(i * 0.01, False, 1, i)
    assert len(ring) <= 2 * 50 + 1


def test_h2_gop_de_100_mb_acotado():
    ring = PacketRing(max_seconds=5.0, max_bytes=48 * 1024 * 1024)
    ring.append(0.0, True, 1024 * 1024, 'k')
    for i in range(1, 101):
        ring.append(i * 0.04, False, 1024 * 1024, i)
    assert ring.total_bytes <= 2 * 48 * 1024 * 1024 + 1024 * 1024


def test_h5_el_segundo_auto_por_la_misma_trayectoria_dispara():
    gate = MotionGate(ZONE)
    xs = [150, 250, 350, 450]
    times = []
    t = 0.0
    results = []
    for pass_start in (0.0, 5.0):
        for k, x in enumerate(xs):
            results.append((pass_start, gate.update([car(x)], W, H, pass_start + 0.5 * k)))
        gate.update([], W, H, pass_start + 3.0)
    first = [r for ps, r in results if ps == 0.0]
    second = [r for ps, r in results if ps == 5.0]
    assert any(first[1:]) and any(second)
    assert second[0] is True                                 # el 2.o auto dispara desde su primera caja


def test_h5_un_auto_que_se_detiene_pasa_a_estatico_con_vistas_seguidas():
    gate = MotionGate(ZONE)
    gate.update([], W, H, 0.0)
    res = [gate.update([car(x)], W, H, 2.0 + 0.5 * i) for i, x in enumerate([150, 250, 350, 350, 350, 350, 350])]
    assert res[1] is True and res[-1] is False and res[-2] is False


def test_h4_cambio_grande_y_sostenido_activa_la_red_de_seguridad():
    from lpr.utils.rest_mode import ChangeDetector

    cd = ChangeDetector(refresh_seconds=100.0)
    empty = np.full((360, 640, 3), 70, np.uint8)
    cd.should_detect(empty, 0.0)
    big = empty.copy()
    big[100:300, 100:500] = 230
    cd.should_detect(big, 0.5)
    assert cd.sustained_change is False                      # un solo chequeo no alcanza
    cd.should_detect(empty, 1.0)                              # otro cambio grande (vuelve a vacio)
    assert cd.sustained_change is True
    cd.should_detect(empty, 1.5)                              # sin cambio: se corta
    assert cd.sustained_change is False


def test_h4_mantiene_la_deteccion_un_rato_tras_el_ultimo_cambio_y_hace_rafaga_de_refresco():
    from lpr.utils.rest_mode import ChangeDetector

    cd = ChangeDetector(refresh_seconds=5.0, hold_seconds=2.0)
    empty = np.full((360, 640, 3), 70, np.uint8)
    car_f = empty.copy()
    car_f[100:300, 100:500] = 230
    cd.should_detect(empty, 0.0)
    assert cd.should_detect(car_f, 0.5) is True               # cambio
    assert cd.should_detect(car_f, 1.0) is True               # hold (quieto pero reciente)
    assert cd.should_detect(car_f, 2.4) is True
    assert cd.should_detect(car_f, 3.0) is False              # paso el hold
    assert cd.should_detect(car_f, 7.5) is True               # refresco...
    assert cd.should_detect(car_f, 8.0) is True               # ...en rafaga de 2
    assert cd.should_detect(car_f, 8.5) is False


# ---- worker: fallback de primera apertura (H3), lock (H6), errores (H7), puente (H8)
class FakeReader:
    instances = []

    def __init__(self, name, url, **kw):
        self.name = name
        self.ok = FakeReader.ok.get(name, True)
        self.failed = False
        self.stopped = False
        FakeReader.instances.append(self)

    def start(self):
        pass

    def stop(self):
        self.stopped = True

    def wait_first_packet(self, timeout):
        return self.ok

    def activate(self):
        pass


def _fake_presence(monkeypatch):
    import lpr.processor.vehicle_presence as vp
    monkeypatch.setattr(vp.VehicleBoxDetector, '__init__', lambda self, **kw: setattr(self, 'available', True))


def _setup_fallback(monkeypatch, worker_module, tmp_path, ok):
    _fake_presence(monkeypatch)
    FakeReader.instances = []
    FakeReader.ok = ok
    monkeypatch.setattr('lpr.utils.stream_reader.StreamReader', FakeReader)
    return make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')


def test_h3_si_el_sub_stream_no_abre_se_conserva_la_captura_original(worker_module, tmp_path, monkeypatch, caplog):
    w = _setup_fallback(monkeypatch, worker_module, tmp_path, {'sub': False})

    class Cap:
        released = False

        def release(self):
            Cap.released = True

    cap = Cap()
    with caplog.at_level('WARNING'):
        started, out = w._start_rest_loop(cap, 'rtsp://relay:8554/porton')
    assert started is False and out is cap and Cap.released is False
    assert any('sub-stream' in r.getMessage() for r in caplog.records)
    assert FakeReader.instances[0].stopped
    w.executor.shutdown(wait=False)


def test_h3_si_el_hd_no_abre_se_reabre_cv2_y_se_usa_el_bucle_normal(worker_module, tmp_path, monkeypatch, caplog):
    w = _setup_fallback(monkeypatch, worker_module, tmp_path, {'hd': False})
    new_cap = object()
    calls = []
    monkeypatch.setattr('lpr.utils.capture.reconnect_capture', lambda url, old=None: calls.append(old) or new_cap)

    class Cap:
        released = False

        def release(self):
            Cap.released = True

    with caplog.at_level('WARNING'):
        started, out = w._start_rest_loop(Cap(), 'rtsp://relay:8554/porton')
    assert started is False and out is new_cap and calls == [None]
    assert all(r.stopped for r in FakeReader.instances)
    assert any('HD' in r.getMessage() for r in caplog.records)
    w.executor.shutdown(wait=False)


def test_h3_si_cv2_tampoco_reabre_termina_el_proceso(worker_module, tmp_path, monkeypatch):
    w = _setup_fallback(monkeypatch, worker_module, tmp_path, {'hd': False})
    monkeypatch.setattr('lpr.utils.capture.reconnect_capture', lambda url, old=None: None)

    class Cap:
        def release(self):
            pass

    with pytest.raises(SystemExit):
        w._start_rest_loop(Cap(), 'rtsp://relay:8554/porton')
    w.executor.shutdown(wait=False)


def test_start_capture_loop_usa_la_captura_devuelta_por_el_fallback(worker_module, tmp_path, rest_env, monkeypatch):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    monkeypatch.setattr(w, 'start_settings_sync', lambda: None)
    reopened = []

    class NewCap:
        def read(self):
            reopened.append(1)
            raise KeyboardInterrupt

    monkeypatch.setattr(w, '_start_rest_loop', lambda cap, url: (False, NewCap()))
    with pytest.raises(KeyboardInterrupt):
        w.start_capture_loop(object())
    assert reopened == [1]


class HdFake:
    def __init__(self, frames):
        self._frames = list(frames)
        self.active = True
        self.failed = False

    def next_frames(self, timeout):
        if self._frames:
            out, self._frames = self._frames, []
            return out
        time.sleep(0.01)
        return []


def _hd_rt(frames):
    from lpr.utils.stream_reader import Frame

    rt = SimpleNamespace(hd=HdFake([Frame(ts, 1, c, lambda: np.zeros((2, 2, 3), np.uint8)) for ts, c in frames]),
                         stop=threading.Event(), controller=SimpleNamespace(hd_decoded=0))
    return rt


def test_h6_el_catchup_bloqueante_no_retiene_el_lock_de_reposo(worker_module, tmp_path):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    entered, release = threading.Event(), threading.Event()

    def slow_submit(frame, now_ts=None, track_now=None, block=False):
        entered.set()
        release.wait(3)

    w.submit_frame = slow_submit
    rt = _hd_rt([(10.0, True)])
    t = threading.Thread(target=w._rest_hd_loop, args=(rt,), daemon=True)
    t.start()
    try:
        assert entered.wait(2)
        got = w._rest_lock.acquire(timeout=0.5)               # otro hilo lo puede tomar
        assert got
        w._rest_lock.release()
    finally:
        release.set()
        rt.stop.set()
        t.join(3)
    w.executor.shutdown(wait=False)


@pytest.mark.parametrize('poll,expected_track', [(0.5, 1.0), (1.0, 1.5)])
def test_h8_el_puente_del_reloj_es_al_menos_dos_intervalos(worker_module, tmp_path, poll, expected_track):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    w.cfg = w.cfg.model_copy(update={'poll_interval': poll})
    seen = []
    w.submit_frame = lambda frame, now_ts=None, track_now=None, block=False: seen.append((now_ts, track_now))
    rt = _hd_rt([(0.0, False), (1.5, False)])
    t = threading.Thread(target=w._rest_hd_loop, args=(rt,), daemon=True)
    t.start()
    assert wait_for(lambda: len(seen) == 2)
    rt.stop.set()
    t.join(3)
    assert seen[1][1] == pytest.approx(expected_track)
    w.executor.shutdown(wait=False)


def test_h7_un_error_en_un_cuadro_no_tumba_el_bucle_del_sub_stream(worker_module, tmp_path, monkeypatch):
    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    from lpr.utils.stream_reader import Frame

    def boom():
        raise RuntimeError('frame corrupto')

    calls = {'n': 0}
    sub = SimpleNamespace(failed=False, request_reconnect=lambda: None)

    def next_frames(timeout):
        calls['n'] += 1
        if calls['n'] == 1:
            return [Frame(1.0, 1, False, boom)]
        sub.failed = True                                      # corta el bucle en la vuelta siguiente
        return []

    sub.next_frames = next_frames
    ctl = SimpleNamespace(tick=lambda: None, sub_decoded=0, poll_window=lambda: None, observe=lambda m: None)
    rt = SimpleNamespace(hd=SimpleNamespace(failed=False), sub=sub, controller=ctl, change=None, sub_gate=None,
                         presence=None)
    with pytest.raises(SystemExit):
        w._rest_sub_loop(rt)
    assert calls['n'] == 2
    w.executor.shutdown(wait=False)


def test_hd_no_envia_un_cuadro_si_se_desactivo_justo_antes_del_submit(worker_module, tmp_path):
    from lpr.utils.stream_reader import Frame

    w = make_worker(worker_module, tmp_path, 'rtsp://relay:8554/porton-hd')
    seen = []
    w.submit_frame = lambda *a, **k: seen.append(1)
    rt = SimpleNamespace(hd=HdFake([]), stop=threading.Event(), controller=SimpleNamespace(hd_decoded=0))

    def image():
        rt.hd.active = False                      # `_rest_deactivate` ocurre durante la conversion
        return np.zeros((2, 2, 3), np.uint8)

    rt.hd._frames = [Frame(5.0, 1, False, image)]
    t = threading.Thread(target=w._rest_hd_loop, args=(rt,), daemon=True)
    t.start()
    time.sleep(0.4)
    rt.stop.set()
    t.join(3)
    assert seen == []
    w.executor.shutdown(wait=False)
