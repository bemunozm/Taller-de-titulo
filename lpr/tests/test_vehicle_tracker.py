"""`VehicleTracker`: wrapper de ByteTrack sobre un modelo de ultralytics DOBLE.

Nada de esto importa ultralytics: el modelo se inyecta (`model=`) o se simula
su carga (`model_loader=`), igual que en el resto de los tests del worker.
"""
from types import SimpleNamespace

import pytest

from lpr.processor.vehicle_tracker import VEHICLE_CLASSES, VehicleTracker
from lpr.utils.direction import DirectionLine


class _Scalar:
    def __init__(self, value):
        self._value = value

    def item(self):
        return self._value


class _Box:
    def __init__(self, track_id, xyxy):
        self.id = None if track_id is None else _Scalar(track_id)
        self.xyxy = [SimpleNamespace(tolist=lambda: list(xyxy))]


class FakeModel:
    """`track(image, **kwargs)` devuelve los cuadros encolados, como ultralytics."""

    def __init__(self):
        self.frames = []
        self.calls = []
        self.predictor = None

    def track(self, image, **kwargs):
        self.calls.append((image, kwargs))
        boxes = self.frames.pop(0) if self.frames else []
        return [SimpleNamespace(boxes=[_Box(i, b) for i, b in boxes])]


def test_usa_bytetrack_persistente_con_las_clases_de_vehiculos():
    model = FakeModel()
    tracker = VehicleTracker(model=model, imgsz=640, device='cuda:0')
    tracker.update('img', now=0.0)
    _image, kwargs = model.calls[0]
    assert kwargs['persist'] is True and kwargs['tracker'] == 'bytetrack.yaml'
    assert kwargs['classes'] == list(VEHICLE_CLASSES) == [2, 3, 5, 7]
    assert kwargs['imgsz'] == 640 and kwargs['device'] == 'cuda:0' and kwargs['verbose'] is False


def test_sin_device_no_lo_pasa_a_ultralytics():
    model = FakeModel()
    VehicleTracker(model=model).update('img', now=0.0)
    assert 'device' not in model.calls[0][1]


def test_reproyecta_las_cajas_del_recorte_al_cuadro_completo():
    model = FakeModel()
    model.frames = [[(7, (10, 20, 110, 220))]]
    tracker = VehicleTracker(model=model)
    found = tracker.update('crop', offset=(360, 100), now=1.0)
    assert found == [(7, (370.0, 120.0, 470.0, 320.0))]


def test_la_trayectoria_sigue_el_borde_inferior_central():
    model = FakeModel()
    model.frames = [[(1, (100, 100, 200, 300))], [(1, (120, 140, 220, 340))]]
    tracker = VehicleTracker(model=model)
    tracker.update('f', now=0.0)
    tracker.update('f', now=0.5)
    assert tracker.path(1) == [(0.0, 150.0, 300.0), (0.5, 170.0, 340.0)]
    assert tracker.paths() == {1: tracker.path(1)}
    assert tracker.path(99) == ()


def test_cajas_sin_id_se_ignoran():
    model = FakeModel()
    model.frames = [[(None, (0, 0, 10, 10)), (3, (50, 50, 90, 90))]]
    tracker = VehicleTracker(model=model)
    assert [tid for tid, _ in tracker.update('f', now=0.0)] == [3]


def test_ids_distintos_llevan_trayectorias_separadas():
    model = FakeModel()
    model.frames = [[(1, (0, 0, 10, 10)), (2, (100, 100, 150, 150))]]
    tracker = VehicleTracker(model=model)
    tracker.update('f', now=0.0)
    assert set(tracker.paths()) == {1, 2}


def test_ttl_olvida_los_tracks_que_ya_no_se_ven():
    model = FakeModel()
    model.frames = [[(1, (0, 0, 10, 10))], [], []]
    tracker = VehicleTracker(model=model, ttl_seconds=5.0)
    tracker.update('f', now=0.0)
    tracker.update('f', now=4.0)
    assert 1 in tracker.paths()          # 4 s sin verlo: todavia vive
    tracker.update('f', now=6.0)
    assert tracker.paths() == {}         # 6 s > TTL


def test_la_trayectoria_esta_acotada():
    model = FakeModel()
    model.frames = [[(1, (0, i, 10, i + 10))] for i in range(450)]
    tracker = VehicleTracker(model=model)
    for i in range(450):
        tracker.update('f', now=i * 0.1)
    assert len(tracker.path(1)) == 400


def test_si_el_modelo_no_carga_degrada_sin_tumbar_nada(tmp_path):
    weights = tmp_path / 'pesos.pt'
    weights.write_bytes(b'x')

    def boom(_ref):
        raise OSError('pesos corruptos')

    tracker = VehicleTracker(model_ref=str(weights), model_loader=boom)
    assert tracker.available is False
    assert tracker.update('f', now=0.0) == []
    assert tracker.paths() == {}


def test_sin_archivo_local_no_se_descarga_nada_y_se_degrada(tmp_path, caplog):
    calls = []
    with caplog.at_level('ERROR'):
        tracker = VehicleTracker(model_ref=str(tmp_path / 'no-existe.pt'),
                                 model_loader=lambda ref: calls.append(ref))
    assert calls == []                      # ni siquiera se le pide a ultralytics (descargaria por nombre)
    assert tracker.available is False and tracker.update('f', now=0.0) == []
    assert 'no encontrado' in caplog.text and 'no se descarga' in caplog.text


def test_un_nombre_suelto_tampoco_se_le_pasa_a_ultralytics(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)             # sin yolo11n.pt en el cwd
    calls = []
    tracker = VehicleTracker(model_ref='yolo11n.pt', model_loader=lambda ref: calls.append(ref))
    assert calls == [] and tracker.available is False


def test_el_modelo_por_defecto_es_el_archivo_local_de_lpr():
    from lpr.processor.vehicle_tracker import default_model_ref
    assert default_model_ref().endswith('yolo11n.pt') and default_model_ref() != 'yolo11n.pt'


def test_el_loader_recibe_la_ruta_pedida_y_queda_disponible(tmp_path):
    weights = tmp_path / 'mi-modelo.pt'
    weights.write_bytes(b'x')
    seen = []
    model = FakeModel()
    tracker = VehicleTracker(model_ref=str(weights), model_loader=lambda ref: seen.append(ref) or model)
    assert tracker.available and seen == [str(weights)]


def test_la_carga_real_desactiva_la_autoinstalacion_de_ultralytics(monkeypatch):
    import os
    import sys
    import types
    from lpr.processor.vehicle_tracker import _load_ultralytics_model

    monkeypatch.delenv('YOLO_AUTOINSTALL', raising=False)
    fake = types.ModuleType('ultralytics')
    fake.YOLO = lambda ref: ('modelo', ref)
    monkeypatch.setitem(sys.modules, 'ultralytics', fake)
    assert _load_ultralytics_model('x.pt') == ('modelo', 'x.pt')
    assert os.environ['YOLO_AUTOINSTALL'] == 'False'
    monkeypatch.setenv('YOLO_AUTOINSTALL', 'True')          # lo que el operador defina se respeta
    _load_ultralytics_model('x.pt')
    assert os.environ['YOLO_AUTOINSTALL'] == 'True'


def test_un_fallo_puntual_de_inferencia_no_propaga():
    class Exploding(FakeModel):
        def track(self, image, **kwargs):
            raise RuntimeError('CUDA out of memory')

    tracker = VehicleTracker(model=Exploding())
    assert tracker.update('f', now=0.0) == []
    assert tracker.available is True     # el siguiente cuadro vuelve a intentar


def test_cambiar_la_linea_descarta_trayectorias_pero_no_los_ids():
    model = FakeModel()
    model.frames = [[(1, (0, 0, 10, 10))], [(1, (0, 20, 10, 30))]]
    tracker = VehicleTracker(model=model)
    line_a = DirectionLine(0.2, 0.5, 0.8, 0.5, 'right')
    tracker.sync_line(line_a)
    tracker.update('f', now=0.0)
    tracker.sync_line(line_a)            # misma linea: no toca nada
    assert len(tracker.path(1)) == 1
    tracker.sync_line(DirectionLine(0.2, 0.6, 0.8, 0.6, 'right'))
    assert tracker.path(1) == []         # historial medido contra otra linea
    tracker.update('f', now=0.5)
    assert len(tracker.path(1)) == 1     # el mismo id sigue vivo


def test_reset_olvida_todo_y_reinicia_los_trackers_de_ultralytics():
    resets = []
    model = FakeModel()
    model.predictor = SimpleNamespace(trackers=[SimpleNamespace(reset=lambda: resets.append(1))])
    model.frames = [[(1, (0, 0, 10, 10))]]
    tracker = VehicleTracker(model=model)
    tracker.update('f', now=0.0)
    tracker.reset()
    assert tracker.paths() == {} and resets == [1]
