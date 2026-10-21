"""Direccion por linea de cruce (`utils/direction.py`): logica pura, sin modelos.

Marco de las pruebas: cuadro de 1000x1000 px (diagonal ~1414, margen anti-ruido
2 % ~ 28 px). La linea horizontal va de (0.2, 0.5) a (0.8, 0.5): apunta a la
DERECHA de la pantalla, asi que para quien avanza de `from` a `to` su mano
derecha cae hacia ABAJO (y crece hacia abajo en una imagen):
`exitSide='right'` => bajar es SALIR; `exitSide='left'` => subir es SALIR.
"""
import pytest

from lpr.utils.direction import (
    DirectionLine, detect_line_crossing, motion_direction, resolve_direction,
)

W = H = 1000


def line(exit_side='right', frm=(0.2, 0.5), to=(0.8, 0.5)):
    return DirectionLine(frm[0], frm[1], to[0], to[1], exit_side)


def path(*xy):
    """Trayectoria con un punto por segundo."""
    return [(float(i), float(x), float(y)) for i, (x, y) in enumerate(xy)]


DOWN = path((500, 300), (500, 400), (500, 520), (500, 650))     # cruza y=500 hacia abajo
UP = path((500, 700), (500, 600), (500, 480), (500, 350))       # cruza y=500 hacia arriba


# --------------------------------------------------------------------------
# Convencion de lado
# --------------------------------------------------------------------------
@pytest.mark.parametrize('side,trajectory,expected', [
    ('right', DOWN, 'exit'), ('right', UP, 'entry'),
    ('left', DOWN, 'entry'), ('left', UP, 'exit'),
])
def test_cruce_en_ambos_sentidos_y_lados(side, trajectory, expected):
    assert detect_line_crossing(trajectory, line(side), W, H) == expected


def test_linea_vertical_apuntando_hacia_abajo_derecha_es_el_lado_izquierdo_de_la_pantalla():
    # from (0.5, 0.2) -> to (0.5, 0.8): apunta hacia abajo; quien avanza asi tiene su
    # mano derecha hacia la IZQUIERDA de la pantalla (x menor).
    vertical = DirectionLine(0.5, 0.2, 0.5, 0.8, 'right')
    to_screen_left = path((700, 500), (600, 500), (450, 500), (300, 500))
    to_screen_right = list(reversed(to_screen_left))
    assert detect_line_crossing(to_screen_left, vertical, W, H) == 'exit'
    assert detect_line_crossing(to_screen_right, vertical, W, H) == 'entry'


def test_la_convencion_se_invierte_al_invertir_la_flecha():
    # Misma recta, from y to intercambiados, mismo exitSide => sentido de salida opuesto.
    forward = line('right', (0.2, 0.5), (0.8, 0.5))
    backward = line('right', (0.8, 0.5), (0.2, 0.5))
    assert detect_line_crossing(DOWN, forward, W, H) == 'exit'
    assert detect_line_crossing(DOWN, backward, W, H) == 'entry'


def test_sin_cruce_devuelve_none():
    stays_above = path((500, 100), (520, 200), (540, 300), (560, 400))
    assert detect_line_crossing(stays_above, line(), W, H) is None
    assert detect_line_crossing(path((500, 100)), line(), W, H) is None
    assert detect_line_crossing([], line(), W, H) is None


# --------------------------------------------------------------------------
# Segmento, no recta infinita
# --------------------------------------------------------------------------
def test_pasar_por_fuera_del_segmento_no_cruza():
    # Cruza la recta infinita y=500 pero en x=950, fuera del segmento 200..800.
    outside = path((950, 300), (950, 400), (950, 520), (950, 650))
    assert detect_line_crossing(outside, line(), W, H) is None
    outside_left = path((50, 300), (50, 400), (50, 520), (50, 650))
    assert detect_line_crossing(outside_left, line(), W, H) is None


def test_el_extremo_del_segmento_tolera_un_poco_de_ruido_de_la_caja():
    # x=790 / 810: dentro del segmento + tolerancia del 5 % de su largo (30 px).
    assert detect_line_crossing(path((810, 300), (810, 400), (810, 520), (810, 650)), line(), W, H) == 'exit'
    assert detect_line_crossing(path((860, 300), (860, 400), (860, 520), (860, 650)), line(), W, H) is None


def test_rodear_el_extremo_y_volver_no_cuenta_como_cruce_del_segmento():
    # Cambia de lado de la recta por fuera del segmento (x=950) y despues vuelve por
    # el medio sin cambiar de lado: nunca cruzo el segmento.
    around = path((950, 300), (950, 650), (500, 700), (500, 800))
    assert detect_line_crossing(around, line(), W, H) is None


# --------------------------------------------------------------------------
# Anti-ruido
# --------------------------------------------------------------------------
def test_jitter_dentro_del_margen_no_genera_cruces():
    # Auto detenido sobre la linea: la caja oscila +-15 px (< 28 px de margen).
    jitter = path(*[(500, 500 + (15 if i % 2 else -15)) for i in range(20)])
    assert detect_line_crossing(jitter, line(), W, H) is None


def test_exige_estar_a_ambos_lados_con_margen():
    # Llega a 20 px de la linea (dentro del margen) y retrocede: no cruzo.
    touches = path((500, 300), (500, 400), (500, 520), (500, 400))
    assert detect_line_crossing(touches, line(), W, H) is None
    # Con 50 px al otro lado (fuera del margen) si cruza.
    crosses = path((500, 300), (500, 400), (500, 550), (500, 560))
    assert detect_line_crossing(crosses, line(), W, H) == 'exit'


def test_cruce_con_puntos_intermedios_dentro_de_la_banda():
    # Los puntos dentro de la banda se ignoran, el tramo confiable -> confiable cruza.
    crossing = path((500, 300), (500, 490), (500, 510), (500, 700))
    assert detect_line_crossing(crossing, line(), W, H) == 'exit'


def test_ida_y_vuelta_manda_el_ultimo_cruce():
    there_and_back = path((500, 300), (500, 650), (500, 300))
    assert detect_line_crossing(there_and_back, line('right'), W, H) == 'entry'


# --------------------------------------------------------------------------
# Respaldo por movimiento neto
# --------------------------------------------------------------------------
def test_movimiento_neto_sobre_la_normal_sin_cruce():
    # Baja 300 px (>= 15 % de 1000 = 150) sin llegar a la linea.
    approaching = path((500, 100), (500, 200), (500, 300), (500, 400))
    assert detect_line_crossing(approaching, line(), W, H) is None
    assert motion_direction(approaching, line('right'), W, H) == 'exit'
    assert motion_direction(approaching, line('left'), W, H) == 'entry'


def test_movimiento_bajo_el_umbral_no_decide():
    small = path((500, 100), (500, 150), (500, 200))
    assert motion_direction(small, line(), W, H) is None


def test_movimiento_paralelo_a_la_linea_no_decide():
    sideways = path((100, 300), (400, 300), (700, 300), (900, 300))
    assert motion_direction(sideways, line(), W, H) is None


# --------------------------------------------------------------------------
# Prioridad de fuentes
# --------------------------------------------------------------------------
def test_la_linea_manda_aunque_la_camara_tenga_direccion_fija():
    # DOWN cruza hacia el lado de salida (exitSide='right'): exit, aunque la camara diga entry.
    assert resolve_direction('entry', line('right'), DOWN, 'entry', (W, H)) == ('exit', 'line')
    assert resolve_direction('exit', line('right'), UP, 'exit', (W, H)) == ('entry', 'line')


def test_camara_fija_entry_con_cruce_hacia_exitside_es_exit_por_linea():
    assert resolve_direction('entry', line('left'), UP, 'unknown', (W, H)) == ('exit', 'line')


def test_camara_fija_entry_con_auto_saliendo_despacio_sin_cruce_es_exit_por_motion():
    approaching = path((500, 100), (500, 200), (500, 300), (500, 400))   # baja 300 px sin llegar a la linea
    assert resolve_direction('entry', line('right'), approaching, 'entry', (W, H)) == ('exit', 'motion')
    assert resolve_direction('exit', line('right'), list(reversed(approaching)), 'exit', (W, H)) == ('entry', 'motion')


def test_camara_fija_sin_cruce_ni_motion_decide_la_camara_y_gana_a_width():
    still = path((500, 100), (500, 110))
    assert resolve_direction('exit', line('right'), still, 'entry', (W, H)) == ('exit', 'camera')
    assert resolve_direction('entry', line('right'), [], 'exit', (W, H)) == ('entry', 'camera')


def test_sin_linea_la_camara_fija_es_la_fuente():
    assert resolve_direction('exit', None, [], 'entry', None) == ('exit', 'camera')
    assert resolve_direction('entry', None, DOWN, 'exit', (W, H)) == ('entry', 'camera')
    assert resolve_direction('entry', line(), DOWN, 'exit', None) == ('entry', 'camera')


def test_linea_gana_al_ancho():
    assert resolve_direction('both', line(), DOWN, 'entry', (W, H)) == ('exit', 'line')


def test_sin_cruce_cae_a_motion_y_luego_a_width():
    approaching = path((500, 100), (500, 200), (500, 300), (500, 400))
    assert resolve_direction('both', line(), approaching, 'entry', (W, H)) == ('exit', 'motion')
    still = path((500, 100), (500, 110))
    assert resolve_direction('both', line(), still, 'entry', (W, H)) == ('entry', 'width')
    assert resolve_direction('both', line(), still, 'unknown', (W, H)) == ('unknown', 'none')


def test_sin_linea_o_sin_tamano_de_cuadro_solo_queda_el_ancho():
    assert resolve_direction('both', None, DOWN, 'exit', (W, H)) == ('exit', 'width')
    assert resolve_direction('both', line(), DOWN, 'exit', None) == ('exit', 'width')


def test_sin_configuracion_de_direccion_no_se_adivina_por_ancho():
    # 'unknown' = la camara no declaro nada: el ancho NO se usa (comportamiento previo)...
    assert resolve_direction('unknown', None, [], 'entry', (W, H)) == ('unknown', 'none')
    # ...pero una linea configurada es una decision explicita del operador.
    assert resolve_direction('unknown', line(), DOWN, 'entry', (W, H)) == ('exit', 'line')


# --------------------------------------------------------------------------
# Validacion de la linea (mismo contrato que backend/frontend)
# --------------------------------------------------------------------------
GOOD = {'from': {'x': 0.2, 'y': 0.7}, 'to': {'x': 0.85, 'y': 0.75}, 'exitSide': 'left'}


def test_from_settings_valida_y_round_trip():
    parsed = DirectionLine.from_settings(GOOD)
    assert parsed == DirectionLine(0.2, 0.7, 0.85, 0.75, 'left')
    assert parsed.to_settings() == GOOD


@pytest.mark.parametrize('bad', [
    None, 'x', [], {},
    {**GOOD, 'exitSide': 'up'},
    {**GOOD, 'foo': 1},
    {'from': GOOD['from'], 'exitSide': 'left'},
    {**GOOD, 'from': {'x': -0.1, 'y': 0.5}},
    {**GOOD, 'to': {'x': 0.5, 'y': 1.01}},
    {**GOOD, 'from': {'x': True, 'y': 0.5}},
    {**GOOD, 'from': {'x': float('nan'), 'y': 0.5}},
    {**GOOD, 'from': {'x': 0.5, 'y': 0.5, 'z': 1}},
    {**GOOD, 'to': {'x': 0.52, 'y': 0.71}, 'from': {'x': 0.5, 'y': 0.7}},   # largo < 0.05
])
def test_from_settings_rechaza_lo_invalido(bad):
    assert DirectionLine.from_settings(bad) is None


# --------------------------------------------------------------------------
# Convencion acordada con el editor del frontend (ZoneEditor): cross = d.x*v.y - d.y*v.x,
# cross < 0 => lado 'left', cross > 0 => lado 'right' (coordenadas normalizadas, y hacia abajo).
# --------------------------------------------------------------------------
def test_convencion_del_editor_linea_horizontal():
    # from=(0.2,0.5) to=(0.8,0.5): 'left' = ARRIBA (y < 0.5), 'right' = ABAJO.
    # Un punto que pasa de y=0.7 a y=0.3 cruza HACIA 'left'.
    up = path((500, 700), (500, 600), (500, 400), (500, 300))
    assert detect_line_crossing(up, line('left'), W, H) == 'exit'
    assert detect_line_crossing(up, line('right'), W, H) == 'entry'


def test_convencion_del_editor_linea_vertical_bajando():
    # from=(0.5,0.2) to=(0.5,0.8): d=(0,0.6), v=(0.3,0) -> cross=-0.18 < 0 -> 'left' = DERECHA en pantalla.
    vertical = lambda side: DirectionLine(0.5, 0.2, 0.5, 0.8, side)  # noqa: E731
    to_screen_right = path((300, 500), (400, 500), (550, 500), (700, 500))
    assert detect_line_crossing(to_screen_right, vertical('left'), W, H) == 'exit'
    assert detect_line_crossing(to_screen_right, vertical('right'), W, H) == 'entry'
