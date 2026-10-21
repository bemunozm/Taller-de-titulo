"""`PlateTracker` con vehiculos: asociacion patente->vehiculo y espera de direccion.

Marco: cuadro de 1000x1000, linea horizontal (0.2, 0.5)->(0.8, 0.5) con
`exitSide='right'` (para quien avanza de from a to, su derecha es ABAJO: bajar
cruzando la linea es SALIR). Todo con `now=` explicito (reloj inyectado).
"""
from lpr.processor.plate_tracker import PlateTracker, TrackObservation
from lpr.utils.direction import DirectionLine

FRAME = (1000, 1000)
LINE = DirectionLine(0.2, 0.5, 0.8, 0.5, 'right')
WAIT = 4.0


def box(cx, cy, w=60, h=30):
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def obs(cx, cy, vehicle_id=None, text='BBCD12', ocr=0.9, det=0.8, w=60):
    return TrackObservation(box=box(cx, cy, w=w), text=text, ocr_conf=ocr, det_conf=det,
                            vehicle_id=vehicle_id)


def path(*xy, t0=0.0):
    return [(t0 + i * 0.1, float(x), float(y)) for i, (x, y) in enumerate(xy)]


BEFORE = path((500, 300), (500, 350), (500, 400))                       # aun no cruza
CROSSED = path((500, 300), (500, 350), (500, 400), (500, 550), (500, 600))  # ya cruzo hacia abajo


def tracker(direction='both', wait=WAIT, line=LINE, **kw):
    return PlateTracker(confirm_reads=3, direction=direction, direction_wait_seconds=wait,
                        direction_line=line, **kw)


def confirm(tr, vehicle_id=5, paths=None, start=0.0, text='BBCD12'):
    """Tres lecturas seguidas del mismo vehiculo; devuelve las emisiones del tercer cuadro."""
    out = []
    for i in range(3):
        out = tr.update([obs(500 + i, 400, vehicle_id, text=text)], now=start + i * 0.1,
                        paths={vehicle_id: paths} if paths is not None else None, frame_size=FRAME)
    return out


# --------------------------------------------------------------------------
# Asociacion patente -> vehiculo
# --------------------------------------------------------------------------
def test_el_mismo_vehiculo_une_lecturas_aunque_la_distancia_sea_enorme():
    tr = PlateTracker(confirm_reads=3, direction='both')
    tr.update([obs(100, 400, vehicle_id=5)], now=0.0)
    tr.update([obs(600, 400, vehicle_id=5)], now=0.1)          # salto de 500 px: el gate lo rechazaria
    (em,) = tr.update([obs(900, 420, vehicle_id=5)], now=0.2)
    assert em.reads == 3 and em.vehicle_id == 5 and tr.active_tracks == 1


def test_sin_vehiculo_se_conserva_la_asociacion_por_distancia():
    tr = PlateTracker(confirm_reads=3, direction='both')
    tr.update([obs(500, 400)], now=0.0)
    tr.update([obs(505, 400)], now=0.1)
    (em,) = tr.update([obs(510, 400)], now=0.2)
    assert em.reads == 3 and em.vehicle_id is None
    assert 'vehicle_id' not in em.track_meta()


def test_dos_autos_pegados_no_se_funden_por_distancia():
    tr = PlateTracker(confirm_reads=3, direction='both')
    for i in range(3):
        tr.update([obs(500, 400, vehicle_id=1, text='AAAA11'), obs(540, 400, vehicle_id=2, text='BBBB22')],
                  now=0.1 * i)
    # cada auto tiene su propio track (con la distancia sola habrian sido uno)
    assert tr.active_tracks == 2


def test_una_lectura_sin_vehiculo_puede_unirse_a_un_track_ya_ligado():
    tr = PlateTracker(confirm_reads=3, direction='both')
    tr.update([obs(500, 400, vehicle_id=5)], now=0.0)
    tr.update([obs(505, 400)], now=0.1)                          # el vehiculo se perdio un cuadro
    (em,) = tr.update([obs(510, 400, vehicle_id=5)], now=0.2)
    assert em.reads == 3 and em.vehicle_id == 5 and tr.active_tracks == 1


def test_track_meta_incluye_el_vehicle_id():
    tr = tracker(wait=0.0)
    (em,) = confirm(tr, vehicle_id=7)
    assert em.track_meta()['vehicle_id'] == 7


# --------------------------------------------------------------------------
# Espera de direccion (E4)
# --------------------------------------------------------------------------
def test_confirmada_pero_sin_cruzar_espera_en_vez_de_emitir():
    tr = tracker()
    assert confirm(tr, paths=BEFORE) == []


def test_emite_en_cuanto_el_vehiculo_cruza_la_linea():
    tr = tracker()
    confirm(tr, paths=BEFORE)
    # un cuadro SIN lectura de patente donde el vehiculo ya cruzo
    (em,) = tr.update([], now=0.6, paths={5: CROSSED}, frame_size=FRAME)
    assert (em.direction, em.direction_source) == ('exit', 'line')
    assert em.text == 'BBCD12' and em.vehicle_id == 5


def test_cruzo_antes_de_confirmar_emite_de_inmediato():
    tr = tracker()
    (em,) = confirm(tr, paths=CROSSED)
    assert (em.direction, em.direction_source) == ('exit', 'line')


def test_sentido_contrario_es_entrada():
    tr = tracker()
    going_up = path((500, 700), (500, 600), (500, 450), (500, 350))
    (em,) = confirm(tr, paths=going_up)
    assert (em.direction, em.direction_source) == ('entry', 'line')


def test_por_timeout_emite_con_el_mejor_respaldo():
    tr = tracker()
    confirm(tr, paths=BEFORE)                                    # confirmada en t=0.2
    for t in (1.0, 2.0, 3.0, 4.0):                              # sigue visible, sin cruzar (< espera de 4 s)
        assert tr.update([obs(505, 400, 5)], now=t, paths={5: BEFORE}, frame_size=FRAME) == []
    (em,) = tr.update([obs(505, 400, 5)], now=4.3, paths={5: BEFORE}, frame_size=FRAME)
    assert em.text == 'BBCD12'
    assert (em.direction, em.direction_source) == ('unknown', 'none')   # sin cruce, sin movimiento, ancho plano


def test_por_timeout_usa_motion_si_el_vehiculo_avanzo_sin_llegar_a_la_linea():
    tr = tracker()
    moving = path((500, 100), (500, 200), (500, 300), (500, 400))   # 300 px hacia la linea
    confirm(tr, paths=moving)
    (em,) = tr.update([obs(505, 400, 5)], now=4.3, paths={5: moving}, frame_size=FRAME)
    assert (em.direction, em.direction_source) == ('exit', 'motion')


def test_un_track_que_se_cierra_con_la_patente_confirmada_igual_emite():
    tr = tracker(wait=30.0)                                      # el timeout no llega a vencer
    confirm(tr, paths=BEFORE)
    # el auto sale del cuadro: pasan > max_gap (1.5 s) sin ver la patente
    (em,) = tr.update([], now=2.5, paths=None, frame_size=FRAME)
    assert em.text == 'BBCD12' and em.vehicle_id == 5
    assert tr.active_tracks == 0


def test_tras_emitir_por_cruce_el_cierre_del_track_no_vuelve_a_emitir():
    tr = tracker(wait=30.0)
    confirm(tr, paths=BEFORE)
    (em,) = tr.update([obs(505, 400, 5)], now=0.5, paths={5: CROSSED}, frame_size=FRAME)
    assert em.direction_source == 'line'
    assert tr.update([], now=3.0, paths=None, frame_size=FRAME) == []


def test_una_sola_emision_por_track_aunque_siga_visible():
    tr = tracker()
    first = confirm(tr, paths=CROSSED)
    assert len(first) == 1
    for i in range(10):
        assert tr.update([obs(510, 400, 5)], now=0.5 + i * 0.1, paths={5: CROSSED}, frame_size=FRAME) == []
    assert tr.flush() == []


def test_la_direccion_fija_de_la_camara_no_espera():
    tr = tracker(direction='exit')
    (em,) = confirm(tr, paths=BEFORE)
    assert (em.direction, em.direction_source) == ('exit', 'camera')


def test_sin_linea_no_espera_y_usa_el_ancho():
    tr = tracker(line=None)
    out = []
    for i, w in enumerate((40, 50, 60)):
        out = tr.update([obs(500, 400, 5, w=w)], now=0.1 * i, paths={5: BEFORE}, frame_size=FRAME)
    (em,) = out
    assert (em.direction, em.direction_source) == ('entry', 'width')


def test_sin_vehiculo_asociado_no_espera():
    tr = tracker()
    out = []
    for i in range(3):
        out = tr.update([obs(500 + i, 400)], now=0.1 * i, frame_size=FRAME)
    (em,) = out
    assert em.vehicle_id is None and (em.direction, em.direction_source) == ('unknown', 'none')


def test_espera_cero_nunca_retiene_la_emision():
    tr = tracker(wait=0.0)
    (em,) = confirm(tr, paths=BEFORE)
    assert em.text == 'BBCD12'


def test_flush_emite_lo_que_sigue_esperando():
    tr = tracker()
    confirm(tr, paths=BEFORE)
    (em,) = tr.flush()
    assert em.text == 'BBCD12'
    assert tr.flush() == []


def test_cambiar_la_linea_descarta_la_trayectoria_en_cache():
    tr = tracker(wait=30.0)
    confirm(tr, paths=BEFORE)
    other = DirectionLine(0.2, 0.9, 0.8, 0.9, 'right')
    tr.set_direction_line(other)
    assert tr.direction_line == other
    # la ruta cacheada ya no cuenta: sin rutas nuevas la direccion sigue sin resolverse por linea
    assert tr.update([], now=0.5, paths=None, frame_size=FRAME) == []
    tr.set_direction_line(other)                                  # idempotente
    assert tr.direction_line == other


def test_no_se_pierde_la_lectura_si_la_espera_vence_y_el_vehiculo_ya_no_esta():
    tr = tracker(wait=1.0)
    confirm(tr, paths=BEFORE)
    (em,) = tr.update([], now=1.4, paths=None, frame_size=FRAME)   # espera vencida (1.0 s desde t=0.2)
    assert em.text == 'BBCD12'
