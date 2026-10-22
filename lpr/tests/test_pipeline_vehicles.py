"""`process_frame` con seguimiento de vehiculos (camino unico del worker y del replay).

El VehicleTracker es un doble: lo que se prueba es el cableado (recorte de la
zona, asociacion patente->vehiculo, paso de trayectorias al PlateTracker),
no ByteTrack.
"""
from types import SimpleNamespace

import numpy as np
import pytest

from lpr.ocr.fast_ocr_adapter import OCRResult
from lpr.processor.pipeline import (
    assign_vehicle, direction_line_of, make_tracker, process_frame, wants_vehicle_tracking,
)
from lpr.settings import WorkerConfig, settings
from lpr.utils.direction import DirectionLine

PLATE = 'BBCD12'


def Detection(x1, y1, x2, y2, conf):  # noqa: N802 - doble de `yolo_detector.Detection` (CI no tiene ultralytics)
    return SimpleNamespace(x1=x1, y1=y1, x2=x2, y2=y2, confidence=conf)

LINE_SETTINGS = {'from': {'x': 0.2, 'y': 0.5}, 'to': {'x': 0.8, 'y': 0.5}, 'exitSide': 'right'}
FRAME = np.zeros((1000, 1000, 3), dtype=np.uint8)


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', None)
    monkeypatch.setattr(settings, 'LPR_DIRECTION_WAIT_SECONDS', 4.0)


def cfg(**over):
    base = dict(
        camera_id='cam-1', min_det_conf=0.1, min_crop_w=1, max_crop_w=None, min_crop_h=1,
        min_crop_area=1, min_crop_ratio=0.1, max_crop_ratio=20.0, zone=None, detector_imgsz=640,
        confirm_reads=3, track_max_gap_seconds=1.5, direction='both', min_winner_share=0.0,
        direction_line=LINE_SETTINGS,
    )
    base.update(over)
    return SimpleNamespace(**base)


class FakeVehicles:
    """Doble de `VehicleTracker`: devuelve cajas guionadas y registra lo que recibio."""

    def __init__(self, scripted, available=True):
        self.scripted = list(scripted)
        self.available = available
        self.calls = []
        self.lines = []
        self._paths = {}

    def sync_line(self, line):
        self.lines.append(line)

    def update(self, image, offset=(0, 0), now=None):
        self.calls.append((image.shape, offset, now))
        found = self.scripted.pop(0) if self.scripted else []
        for vid, (x1, y1, x2, y2) in found:
            self._paths.setdefault(vid, []).append((now, (x1 + x2) / 2.0, y2))
        return found

    def paths(self):
        return self._paths


def detector(_frame, _min_conf, imgsz=None):
    return [Detection(480, 380, 540, 410, 0.95)]


OCR = SimpleNamespace(recognize=lambda _arr: OCRResult(PLATE, 0.99, [0.99] * len(PLATE)))


# --------------------------------------------------------------------------
# Piezas
# --------------------------------------------------------------------------
def test_wants_vehicle_tracking_con_o_sin_linea_salvo_deteccion_bloqueada():
    # Premisa anterior: solo con linea. Ahora el voto es por vehiculo: corre siempre
    # (la linea solo decide la direccion y manda sobre la fija).
    assert wants_vehicle_tracking(cfg())
    assert wants_vehicle_tracking(cfg(direction='unknown'))
    assert wants_vehicle_tracking(cfg(direction='exit'))
    assert wants_vehicle_tracking(cfg(direction='entry'))
    assert wants_vehicle_tracking(cfg(direction_line=None))
    assert wants_vehicle_tracking(cfg(direction_line=None, direction='exit'))
    assert wants_vehicle_tracking(SimpleNamespace())              # config vieja sin el campo
    assert not wants_vehicle_tracking(cfg(detection_blocked=True))


def test_direction_line_of_ignora_lo_invalido():
    assert direction_line_of(cfg()) == DirectionLine(0.2, 0.5, 0.8, 0.5, 'right')
    assert direction_line_of(cfg(direction_line={'from': {}})) is None


def test_assign_vehicle_por_centro_de_la_patente():
    vehicles = [(1, (0, 0, 100, 100)), (2, (400, 300, 700, 600))]
    assert assign_vehicle((480, 380, 540, 410), vehicles) == 2
    assert assign_vehicle((900, 900, 960, 930), vehicles) is None
    assert assign_vehicle((480, 380, 540, 410), []) is None


def test_assign_vehicle_con_cajas_superpuestas_gana_la_mas_especifica():
    big = (1, (0, 0, 1000, 1000))
    small = (2, (400, 300, 700, 600))
    assert assign_vehicle((480, 380, 540, 410), [big, small]) == 2
    assert assign_vehicle((480, 380, 540, 410), [small, big]) == 2


def test_assign_vehicle_prefiere_la_que_mas_contiene_la_patente():
    # La patente (480..540) queda entera dentro de A pero cortada por el borde de B,
    # aunque su centro este dentro de las dos.
    a = (1, (450, 300, 700, 600))
    b = (2, (500, 300, 520, 450))
    assert assign_vehicle((480, 380, 540, 410), [b, a]) == 1


def test_make_tracker_lleva_la_linea_y_la_espera_del_entorno(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_DIRECTION_WAIT_SECONDS', 2.5)
    tr = make_tracker(cfg())
    assert tr.direction_wait_seconds == 2.5
    assert tr.direction_line == DirectionLine(0.2, 0.5, 0.8, 0.5, 'right')
    assert make_tracker(cfg(direction_line=None)).direction_line is None


# --------------------------------------------------------------------------
# process_frame
# --------------------------------------------------------------------------
def test_corre_los_vehiculos_sobre_el_recorte_de_la_zona_y_los_asocia():
    zone = [[{'x': 0.1, 'y': 0.2}, {'x': 0.9, 'y': 0.2}, {'x': 0.9, 'y': 0.9}, {'x': 0.1, 'y': 0.9}]]
    c = cfg(zone=zone)
    vehicles = FakeVehicles([[(5, (420, 300, 600, 600))]] * 3)
    tracker = make_tracker(c)
    for i in range(3):
        _reads, emissions = process_frame(FRAME, detector, OCR, c, tracker, 0.1 * i, vehicle_tracker=vehicles)
    shape, offset, _now = vehicles.calls[0]
    # misma envolvente que el detector de patentes: zona + 5 % de margen, en pixeles
    assert offset == (60, 165) and shape[:2] == (771, 881)      # (alto, ancho) del recorte
    assert emissions == []                                    # espera la direccion
    assert vehicles.lines[0] == DirectionLine(0.2, 0.5, 0.8, 0.5, 'right')


def test_la_emision_lleva_el_vehiculo_y_se_resuelve_al_cruzar():
    c = cfg()
    tracker = make_tracker(c)
    # El auto baja de y=400 a y=700: cruza la linea (y=500) hacia abajo => salida.
    script = [[(5, (420, 200, 600, y))] for y in (400, 420, 440)]
    vehicles = FakeVehicles(script + [[(5, (420, 200, 600, 700))]])
    out = []
    for i in range(3):
        _r, out = process_frame(FRAME, detector, OCR, c, tracker, 0.1 * i, vehicle_tracker=vehicles)
    assert out == []
    _r, (em,) = process_frame(FRAME, detector, OCR, c, tracker, 0.3, vehicle_tracker=vehicles)
    assert (em.direction, em.direction_source) == ('exit', 'line')
    assert em.vehicle_id == 5 and em.track_meta()['vehicle_id'] == 5


def test_sin_vehicle_tracker_o_no_disponible_no_hay_espera_y_cae_al_ancho():
    for vt in (None, FakeVehicles([], available=False)):
        c = cfg()
        tracker = make_tracker(c)
        out = []
        for i in range(3):
            _r, out = process_frame(FRAME, detector, OCR, c, tracker, 0.1 * i, vehicle_tracker=vt)
        (em,) = out
        assert em.vehicle_id is None and (em.direction, em.direction_source) == ('unknown', 'none')
        if vt is not None:
            assert vt.calls == []                             # no disponible => ni se invoca


def test_con_direccion_fija_y_linea_corre_el_modelo_y_el_cruce_manda():
    c = cfg(direction='entry')                               # la camara dice entry...
    tracker = make_tracker(c)
    # ...pero el auto baja de y=400 a 700 cruzando la linea (y=500, exitSide right): SALE.
    script = [[(5, (420, 200, 600, y))] for y in (400, 420, 440, 700)]
    vehicles = FakeVehicles(script)
    outs = []
    for i in range(4):
        _r, out = process_frame(FRAME, detector, OCR, c, tracker, 0.1 * i, vehicle_tracker=vehicles)
        outs.append(out)
    assert len(vehicles.calls) == 4
    assert outs[:3] == [[], [], []]                          # espera el cruce pese a la direccion fija
    (em,) = outs[3]
    assert (em.direction, em.direction_source) == ('exit', 'line')


def test_con_direccion_fija_sin_cruce_emite_al_vencer_con_la_camara_como_respaldo():
    c = cfg(direction='exit')
    tracker = make_tracker(c)
    vehicles = FakeVehicles([[(5, (420, 200, 600, 400))]] * 60)   # no se mueve ni cruza
    outs = []
    for t in (0.0, 0.1, 0.2, 1.0, 2.0, 3.0, 4.0, 4.3):
        _r, out = process_frame(FRAME, detector, OCR, c, tracker, t, vehicle_tracker=vehicles)
        outs.append(out)
    assert all(o == [] for o in outs[:-1])
    (em,) = outs[-1]
    assert (em.direction, em.direction_source) == ('exit', 'camera')


def test_con_direccion_fija_sin_linea_corre_el_modelo_pero_la_direccion_es_la_de_la_camara():
    # Premisa anterior: sin linea el modelo no corria. Ahora corre (voto por vehiculo)
    # y la direccion sigue siendo la fija de la camara.
    c = cfg(direction='exit', direction_line=None)
    vehicles = FakeVehicles([])
    tracker = make_tracker(c)
    out = []
    for i in range(3):
        _r, out = process_frame(FRAME, detector, OCR, c, tracker, 0.1 * i, vehicle_tracker=vehicles)
    (em,) = out
    assert (em.direction, em.direction_source) == ('exit', 'camera')
    assert len(vehicles.calls) == 3


def test_cambiar_la_linea_entre_cuadros_se_propaga_al_tracker_y_a_los_vehiculos():
    c1 = cfg()
    c2 = cfg(direction_line={'from': {'x': 0.2, 'y': 0.6}, 'to': {'x': 0.8, 'y': 0.6}, 'exitSide': 'left'})
    tracker = make_tracker(c1)
    vehicles = FakeVehicles([])
    process_frame(FRAME, detector, OCR, c1, tracker, 0.0, vehicle_tracker=vehicles)
    process_frame(FRAME, detector, OCR, c2, tracker, 0.1, vehicle_tracker=vehicles)
    assert tracker.direction_line == direction_line_of(c2)
    assert vehicles.lines[-1] == direction_line_of(c2)


def test_workerconfig_real_acepta_la_linea():
    base = WorkerConfig(camera_id='cam-1', backend_url='http://backend.test')
    c = base.model_copy(update={'direction_line': LINE_SETTINGS, 'direction': 'both'})
    assert wants_vehicle_tracking(c)


# --------------------------------------------------------------------------
# Ganchos de medicion (replay_eval): apagados por defecto
# --------------------------------------------------------------------------
def test_vehicle_ids_out_lista_el_vehiculo_de_cada_lectura():
    veh = FakeVehicles([[(7, (400, 300, 600, 500))]])
    ids = []
    reads, _ = process_frame(FRAME, detector, OCR, cfg(), make_tracker(cfg()), now=0.0,
                             vehicle_tracker=veh, vehicle_ids_out=ids)
    assert len(reads) == 1 and ids == [7]


def test_vehicle_ids_out_none_para_lectura_sin_vehiculo():
    veh = FakeVehicles([[(7, (0, 0, 50, 50))]])
    ids = []
    process_frame(FRAME, detector, OCR, cfg(), make_tracker(cfg()), now=0.0,
                  vehicle_tracker=veh, vehicle_ids_out=ids)
    assert ids == [None]


def test_force_vehicle_tracking_corre_el_tracker_aun_con_la_deteccion_bloqueada():
    # Premisa anterior: sin linea no corria y `force` lo forzaba; ahora corre siempre
    # salvo deteccion bloqueada y `force` (solo medicion) lo fuerza igual.
    blocked = cfg(direction_line=None, detection_blocked=True)
    off = FakeVehicles([[(7, (400, 300, 600, 500))]])
    process_frame(FRAME, detector, OCR, blocked, make_tracker(blocked), now=0.0, vehicle_tracker=off)
    assert off.calls == []
    no_line = blocked
    on = FakeVehicles([[(7, (400, 300, 600, 500))]])
    ids = []
    process_frame(FRAME, detector, OCR, no_line, make_tracker(no_line), now=0.0, vehicle_tracker=on,
                  force_vehicle_tracking=True, vehicle_ids_out=ids)
    assert len(on.calls) == 1 and ids == []   # bloqueada: sin lecturas que asociar


def test_una_emision_marca_su_vehiculo_como_consumido_en_el_tracker_de_vehiculos():
    class Spy(FakeVehicles):
        consumed = []

        def mark_consumed(self, canonical):
            self.consumed.append(canonical)

    c = cfg(direction_line=None)
    vehicles = Spy([[(7, (400, 300, 600, 500))]] * 3)
    tracker = make_tracker(c)
    for i in range(3):
        process_frame(FRAME, detector, OCR, c, tracker, 0.1 * i, vehicle_tracker=vehicles)
    assert vehicles.consumed == [7]
