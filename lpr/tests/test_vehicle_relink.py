"""`VehicleTracker`: config propia de ByteTrack (yaml) e ids canonicos con reenlace.

Sin ultralytics: el modelo es un doble que entrega los cuadros guionados.
Ademas: tolerancia del 10 % de `assign_vehicle`.
"""
from pathlib import Path
from types import SimpleNamespace

import pytest

from lpr.processor.pipeline import assign_vehicle
from lpr.processor.vehicle_tracker import (
    VehicleTracker, render_tracker_yaml, track_buffer_for,
)


class _Scalar:
    def __init__(self, value):
        self._value = value

    def item(self):
        return self._value


class _Box:
    def __init__(self, track_id, xyxy, cls=None):
        self.id = _Scalar(track_id)
        self.xyxy = [SimpleNamespace(tolist=lambda: list(xyxy))]
        if cls is not None:
            self.cls = _Scalar(cls)


class ScriptedModel:
    """`track()` entrega, en orden, los cuadros `[(raw_id, xyxy[, cls])]` guionados."""

    def __init__(self, frames=()):
        self.frames = list(frames)
        self.calls = []
        self.predictor = None

    def track(self, image, **kwargs):
        self.calls.append((image, kwargs))
        frame = self.frames.pop(0) if self.frames else []
        return [SimpleNamespace(boxes=[_Box(item[0], item[1], item[2] if len(item) > 2 else None)
                                       for item in frame])]


def run(tracker, frames, step=0.125):
    """Alimenta los cuadros; devuelve los ids canonicos devueltos en cada uno."""
    tracker._model.frames = list(frames)
    return [[cid for cid, _box in tracker.update('img', now=i * step)] for i in range(len(frames))]


def make(**kw):
    return VehicleTracker(model=ScriptedModel(), **kw)


CAR = (100, 100, 200, 160)          # 100 x 60 (diagonal ~117)


def moved(dx, dy=0, box=CAR):
    return (box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy)


# --------------------------------------------------------------------------
# yaml propio de ByteTrack
# --------------------------------------------------------------------------
def yaml_values(tracker):
    text = Path(tracker.tracker_config()).read_text(encoding='utf-8')
    pairs = (line.split(':', 1) for line in text.splitlines() if ':' in line and not line.startswith('#'))
    return {k.strip(): v.strip() for k, v in pairs}


def test_track_buffer_sale_de_segundos_por_fps_redondeado_hacia_arriba():
    assert track_buffer_for(3.0, 8) == 24
    assert track_buffer_for(3.0, 2.5) == 8          # ceil(7.5)
    assert track_buffer_for(0.01, 1) == 1           # minimo 1


def test_el_yaml_escrito_lleva_umbrales_explicitos_y_el_track_buffer_resuelto():
    values = yaml_values(make(sample_fps=8, lost_seconds=3.0))
    assert values['tracker_type'] == 'bytetrack' and values['track_buffer'] == '24'
    for key in ('track_high_thresh', 'track_low_thresh', 'new_track_thresh', 'match_thresh', 'fuse_score'):
        assert key in values


def test_otro_fps_otro_buffer_y_el_modelo_recibe_esa_ruta():
    tracker = make(sample_fps=4, lost_seconds=3.0)
    tracker.update('img', now=0.0)
    assert yaml_values(tracker)['track_buffer'] == '12'
    assert tracker._model.calls[0][1]['tracker'] == tracker.tracker_config()


def test_el_tracker_corre_sin_linea_de_direccion():
    # El VehicleTracker no conoce la linea: `update()` siempre rastrea (V2).
    tracker = make(sample_fps=8)
    tracker._model.frames = [[(1, CAR)]]
    assert [cid for cid, _ in tracker.update('img', now=0.0)] == [1]


def test_los_overrides_de_umbrales_se_aplican_y_una_clave_ajena_falla():
    assert 'new_track_thresh: 0.4' in render_tracker_yaml(10, {'new_track_thresh': 0.4})
    with pytest.raises(ValueError):
        render_tracker_yaml(10, {'no_existe': 1})


def test_si_no_se_puede_escribir_el_yaml_se_usa_el_de_ultralytics(monkeypatch):
    from lpr.processor import vehicle_tracker as vt

    def boom(_text):
        raise OSError('disco lleno')

    monkeypatch.setattr(vt, 'write_tracker_yaml', boom)
    tracker = make(sample_fps=8)
    tracker.update('img', now=0.0)
    assert tracker._model.calls[0][1]['tracker'] == 'bytetrack.yaml'


# --------------------------------------------------------------------------
# Ids canonicos: reenlace de un id nuevo a uno perdido hace poco
# (el canonico sale de un contador interno: el primer vehiculo es 1, el siguiente 2...)
# --------------------------------------------------------------------------
def test_id_nuevo_cerca_de_uno_perdido_hereda_el_canonico_y_la_trayectoria_sigue():
    tracker = make(relink_seconds=2.0)
    ids = run(tracker, [[(5, CAR)], [(5, moved(10))], [], [(9, moved(30))]])
    assert ids == [[1], [1], [], [1]]
    assert len(tracker.path(1)) == 3 and tracker.path(2) == ()
    assert tracker.raw_ids() == {1: (5, 9)}


def test_id_nuevo_lejos_del_perdido_es_otro_vehiculo():
    ids = run(make(relink_seconds=2.0), [[(5, CAR)], [], [(9, moved(400))]])
    assert ids == [[1], [], [2]]


def test_pasada_la_ventana_de_reenlace_es_otro_vehiculo():
    ids = run(make(relink_seconds=2.0), [[(5, CAR)], [], [(9, moved(10))]], step=1.5)   # perdido hace 3 s
    assert ids == [[1], [], [2]]


def test_reenlace_apagado_con_cero_segundos():
    assert run(make(relink_seconds=0), [[(5, CAR)], [(9, moved(10))]]) == [[1], [2]]


def test_area_muy_distinta_no_reenlaza():
    big = (100, 100, 300, 260)      # area 5.3x
    assert run(make(relink_seconds=2.0), [[(5, CAR)], [(9, big)]]) == [[1], [2]]


def test_clase_distinta_no_reenlaza_y_misma_clase_si():
    assert run(make(relink_seconds=2.0), [[(5, CAR, 2)], [(9, moved(10), 7)]]) == [[1], [2]]
    assert run(make(relink_seconds=2.0), [[(5, CAR, 2)], [(9, moved(10), 2)]]) == [[1], [1]]


def test_no_roba_el_canonico_de_un_vecino_que_sigue_vivo():
    # 5 y 6 son dos autos pegados; 6 sigue vivo cuando nace el 9 junto a ambos: 9 solo puede
    # heredar al perdido (5), nunca al vivo (6).
    neighbour = moved(60)
    ids = run(make(relink_seconds=2.0), [
        [(5, CAR), (6, neighbour)],
        [(6, neighbour)],                                   # 5 se pierde
        [(6, neighbour), (9, moved(15))],                   # nace 9 cerca de 5 (y de 6)
    ])
    assert ids == [[1, 2], [2], [2, 1]]


def test_un_vehiculo_vivo_no_es_candidato_aunque_el_nuevo_caiga_sobre_el():
    # Nada perdido: el id nuevo encima de un auto vivo es un auto nuevo.
    ids = run(make(relink_seconds=2.0), [[(5, CAR)], [(5, CAR), (9, moved(5))]])
    assert ids == [[1], [1, 2]]


def test_un_canonico_perdido_se_hereda_una_sola_vez_y_gana_el_mas_cercano():
    tracker = make(relink_seconds=2.0)
    ids = run(tracker, [[(5, CAR)], [], [(9, moved(60)), (10, moved(12))]])
    assert ids[2] == [2, 1]                                 # 10 (el mas cercano) hereda; 9 queda nuevo
    assert tracker.raw_ids()[1] == (5, 10)


def test_si_el_id_viejo_reaparece_el_heredero_y_el_viejo_no_comparten_vehiculo():
    ids = run(make(relink_seconds=2.0),
              [[(5, CAR)], [], [(9, moved(10))], [(5, CAR), (9, moved(12))]])
    assert ids[2] == [1]
    assert ids[3] == [2, 1]                                 # el heredero (9) conserva el 1; el viejo (5), uno nuevo


def test_la_expiracion_por_ttl_limpia_el_mapa_de_ids():
    tracker = make(ttl_seconds=5.0, relink_seconds=2.0)
    run(tracker, [[(5, CAR)], [], []], step=4.0)
    assert tracker.paths() == {} and tracker._canon == {}


# --------------------------------------------------------------------------
# Tolerancia del 10 % en la asociacion patente -> vehiculo
# --------------------------------------------------------------------------
def test_assign_vehicle_tolera_una_patente_justo_fuera_de_la_caja():
    car = (100.0, 100.0, 300.0, 200.0)                       # 200 x 100: 10 % = 20 x 10
    assert assign_vehicle((190.0, 140.0, 210.0, 160.0), [(1, car)]) == 1     # dentro
    assert assign_vehicle((310.0, 140.0, 330.0, 160.0), [(1, car)]) == 1     # centro a 20 px del borde
    assert assign_vehicle((340.0, 140.0, 360.0, 160.0), [(1, car)]) is None  # fuera incluso con 10 %


def test_assign_vehicle_prefiere_la_caja_que_si_contiene_sobre_la_expandida():
    a = (100.0, 100.0, 300.0, 200.0)
    b = (305.0, 100.0, 500.0, 200.0)                         # contiene el centro (320); `a` solo lo alcanza expandida
    assert assign_vehicle((310.0, 140.0, 330.0, 160.0), [(1, a), (2, b)]) == 2


# --------------------------------------------------------------------------
# Unicidad de canonicos por cuadro (bug: dos cajas con el mismo canonico)
# --------------------------------------------------------------------------
@pytest.mark.parametrize('old_first', [True, False])
def test_el_id_viejo_que_reaparece_recibe_un_canonico_nuevo_y_el_heredero_conserva_el_suyo(old_first):
    tracker = make(relink_seconds=2.0)
    old, heir = (1, CAR), (7, moved(10))
    reappear = [old, heir] if old_first else [heir, old]
    ids = run(tracker, [[old], [], [heir], reappear])
    assert ids[2] == [1]                                    # el 7 heredo el canonico 1
    by_raw = dict(zip([r for r, *_ in reappear], ids[3]))
    assert by_raw[7] == 1                                   # el heredero lo conserva
    assert by_raw[1] == 2                                   # el viejo: canonico nuevo del contador
    assert len(set(ids[3])) == 2


def test_los_canonicos_nunca_se_repiten_aunque_los_ids_crudos_se_reinicien():
    tracker = make(relink_seconds=2.0)
    first = run(tracker, [[(1, CAR)]])[0]
    tracker.reset()                                         # ByteTrack vuelve a numerar desde 1
    second = run(tracker, [[(1, CAR)]])[0]
    assert first == [1] and second == [2]


def test_propiedad_en_cualquier_cuadro_los_canonicos_devueltos_son_unicos():
    import random

    for seed in range(40):
        rng = random.Random(seed)
        tracker = make(relink_seconds=2.0)
        frames = []
        for _ in range(30):
            raws = rng.sample(range(1, 7), rng.randint(0, 4))
            frames.append([(r, moved(rng.choice([0, 5, 12, 40, 90]), rng.choice([0, 8]),
                                     box=(100 + 30 * (r % 3), 100, 200 + 30 * (r % 3), 160))) for r in raws])
        for cids in run(tracker, frames, step=0.2):
            assert len(set(cids)) == len(cids)


# --------------------------------------------------------------------------
# Reenganche: vehiculo consumido y posicion predicha
# --------------------------------------------------------------------------
def test_un_vehiculo_consumido_no_puede_ser_heredado():
    tracker = make(relink_seconds=2.0)
    assert run(tracker, [[(5, CAR)]]) == [[1]]
    tracker.mark_consumed(1)
    tracker._model.frames = [[], [(9, moved(10))]]
    tracker.update('img', now=0.125)
    assert [c for c, _ in tracker.update('img', now=0.25)] == [2]


def test_marcar_consumido_un_id_desconocido_no_hace_nada():
    tracker = make()
    tracker.mark_consumed(99)
    assert tracker._consumed == set()


# Auto que avanza a 320 px/s hacia la derecha y se pierde un cuadro.
APPROACH = [[(5, CAR)], [(5, moved(40))], [(5, moved(80))], []]


def test_hereda_si_la_posicion_es_coherente_con_la_velocidad_y_no_si_no_lo_es():
    ahead = run(make(relink_seconds=2.0), APPROACH + [[(9, moved(150))]])
    assert ahead[-1] == [1]                                  # aparece donde se esperaba: mismo auto
    behind = run(make(relink_seconds=2.0), APPROACH + [[(9, moved(20))]])
    assert behind[-1] == [2]                                 # aparece donde estaba antes: otro auto


def test_solo_cuenta_la_posicion_predicha_aunque_el_nuevo_caiga_sobre_la_ultima_posicion():
    # Trade-off aceptado: a 640 px/s la prediccion cae a 160 px (> 1 diagonal) de la ultima caja;
    # un auto que frena justo antes de perderse no se reengancha (prefiere un duplicado, que el
    # dedupe por texto filtra, a mezclar los votos de dos autos).
    fast = [[(5, CAR)], [(5, moved(80))], [(5, moved(160))], []]
    assert run(make(relink_seconds=2.0), fast + [[(9, moved(160))]])[-1] == [2]


# --------------------------------------------------------------------------
# Reconfiguracion por sample_fps (en sitio, sin recargar el modelo ni tocar callbacks)
# --------------------------------------------------------------------------
class UltralyticsLikeModel:
    """Modela lo relevante de ultralytics 8.3: `track()` registra un par de callbacks si el
    predictor aun no tiene `trackers`, `on_predict_start` crea el tracker y cada callback
    `postprocess_end` registrado lo avanza un cuadro (por eso registrar de mas = avanzar de mas)."""

    class Byte:
        def __init__(self, track_buffer):
            self.args = SimpleNamespace(track_buffer=track_buffer)
            self.max_time_lost = track_buffer
            self.frame_id = 0

        def reset(self):
            self.frame_id = 0

    def __init__(self):
        self.predictor = None
        self.callbacks = {'on_predict_start': [], 'on_predict_postprocess_end': []}

    def track(self, image, **kwargs):
        if not hasattr(self.predictor, 'trackers'):
            self.callbacks['on_predict_start'].append('start')
            self.callbacks['on_predict_postprocess_end'].append('post')
        if self.predictor is None:
            self.predictor = SimpleNamespace()
        if not hasattr(self.predictor, 'trackers'):
            text = Path(kwargs['tracker']).read_text(encoding='utf-8')
            buffer = int(next(l for l in text.splitlines() if l.startswith('track_buffer:')).split(':')[1])
            self.predictor.trackers = [self.Byte(buffer)]
        for _ in self.callbacks['on_predict_postprocess_end']:
            self.predictor.trackers[0].frame_id += 1
        return [SimpleNamespace(boxes=[_Box(5, CAR)])]


def test_reconfigure_con_el_mismo_track_buffer_no_hace_nada():
    model = UltralyticsLikeModel()
    tracker = VehicleTracker(model=model, sample_fps=8, lost_seconds=3.0)
    tracker.update('img', now=0.0)
    byte = model.predictor.trackers[0]
    assert tracker.reconfigure(8.0) is False
    assert model.predictor.trackers[0] is byte and byte.frame_id == 1 and tracker.paths()


def test_reconfigure_cambia_el_buffer_en_sitio_sin_duplicar_callbacks_ni_avanzar_dos_cuadros():
    model = UltralyticsLikeModel()
    tracker = VehicleTracker(model=model, sample_fps=8, lost_seconds=3.0)
    first = tracker.update('img', now=0.0)[0][0]
    tracker.update('img', now=0.1)
    byte = model.predictor.trackers[0]
    assert (byte.args.track_buffer, byte.max_time_lost, byte.frame_id) == (24, 24, 2)
    callbacks = {k: list(v) for k, v in model.callbacks.items()}

    assert tracker.reconfigure(4.0) is True
    assert model.predictor.trackers[0] is byte                      # mismo tracker, reconfigurado en sitio
    assert (byte.args.track_buffer, byte.max_time_lost, byte.frame_id) == (12, 12, 0)
    assert tracker.paths() == {} and tracker._model is model       # mismo modelo; pistas de antes cerradas
    second = tracker.update('img', now=1.0)[0][0]
    assert model.callbacks == callbacks                             # ni un callback nuevo
    assert byte.frame_id == 1                                       # avanza 1 por llamada, no 2
    tracker.update('img', now=1.1)
    assert byte.frame_id == 2
    assert second != first                                          # el contador canonico no repite
    assert yaml_values(tracker)['track_buffer'] == '12'


def test_reconfigure_antes_del_primer_track_solo_cambia_el_yaml_de_la_primera_creacion():
    model = UltralyticsLikeModel()
    tracker = VehicleTracker(model=model, sample_fps=8, lost_seconds=3.0)
    assert tracker.reconfigure(4.0) is True
    tracker.update('img', now=0.0)
    assert model.predictor.trackers[0].args.track_buffer == 12 and len(model.callbacks['on_predict_start']) == 1


# --------------------------------------------------------------------------
# yaml temporal seguro
# --------------------------------------------------------------------------
def test_el_yaml_vive_en_un_directorio_propio_sin_temporales_y_se_reescribe_si_esta_corrupto(tmp_path, monkeypatch):
    import os
    import tempfile
    from lpr.processor.vehicle_tracker import write_tracker_yaml

    monkeypatch.setattr(tempfile, 'gettempdir', lambda: str(tmp_path))
    path = Path(write_tracker_yaml('track_buffer: 24\n'))
    assert path.parent == tmp_path / 'vigilia-lpr' and path.read_text(encoding='utf-8') == 'track_buffer: 24\n'
    path.write_bytes(b'\xff\xfe corrupto')                    # contenido distinto / ilegible
    assert Path(write_tracker_yaml('track_buffer: 24\n')) == path
    assert path.read_text(encoding='utf-8') == 'track_buffer: 24\n'
    assert [p.name for p in path.parent.iterdir()] == [path.name]       # sin .tmp huerfanos
    if os.name == 'posix':
        assert (path.stat().st_mode & 0o777) == 0o600 and (path.parent.stat().st_mode & 0o777) == 0o700


def test_si_falla_el_reemplazo_no_deja_temporales(tmp_path, monkeypatch):
    import os
    import tempfile
    from lpr.processor.vehicle_tracker import write_tracker_yaml

    monkeypatch.setattr(tempfile, 'gettempdir', lambda: str(tmp_path))

    def boom(*_a):
        raise OSError('sin permiso')

    monkeypatch.setattr(os, 'replace', boom)
    with pytest.raises(OSError):
        write_tracker_yaml('x: 1\n')
    assert list((tmp_path / 'vigilia-lpr').iterdir()) == []
