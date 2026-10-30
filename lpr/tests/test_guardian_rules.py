"""Reglas del Guardián (`processor/guardian_rules.py`): motor puro, reloj inyectado.

Cuadro de 1000x1000 y una zona cuadrada en x,y in [400, 600] px (0.4-0.6): las
posiciones de cabeza/centro/pies se pueden razonar a ojo. Sin cv2 de captura,
sin red y sin YOLO.
"""
import pytest

from lpr.processor.guardian_rules import (
    ANOMALY_INTRUSION,
    ANOMALY_LOITERING,
    DEFAULT_LOITER_SECONDS,
    GuardianConfig,
    GuardianRules,
    GuardianZone,
    LegacyRules,
    parse_guardian_zones,
)

WH = (1000, 1000)
SQUARE = [{'x': 0.4, 'y': 0.4}, {'x': 0.6, 'y': 0.4}, {'x': 0.6, 'y': 0.6}, {'x': 0.4, 'y': 0.6}]
FAR_SQUARE = [{'x': 0.0, 'y': 0.0}, {'x': 0.1, 'y': 0.0}, {'x': 0.1, 'y': 0.1}, {'x': 0.0, 'y': 0.1}]

# Cajas de 40 px de ancho centradas en x=500; solo UN punto (cabeza/centro/pies) cae en la zona.
HEAD_ONLY = (480.0, 550.0, 520.0, 900.0)    # cabeza y=550 dentro; centro 725 y pies 900 fuera
CENTER_ONLY = (480.0, 300.0, 520.0, 700.0)  # centro y=500 dentro; cabeza 300 y pies 700 fuera
FEET_ONLY = (480.0, 100.0, 520.0, 500.0)    # pies y=500 dentro; cabeza 100 y centro 300 fuera
OUTSIDE = (780.0, 700.0, 820.0, 900.0)      # nada en la zona
IN_ZONE = (480.0, 420.0, 520.0, 580.0)      # persona completa dentro


def intrusion_zone() -> GuardianZone:
    return parse_guardian_zones([SQUARE])[0]


def loiter_zone(seconds=10, points=SQUARE) -> GuardianZone:
    return parse_guardian_zones([{'points': points, 'type': 'loitering', 'loiterSeconds': seconds}])[0]


def make(zones=(), **cfg) -> GuardianRules:
    rules = GuardianRules(GuardianConfig(**cfg))
    rules.set_zones(zones)
    return rules


def run(rules, t0, seconds, boxes, tid=1, step=1.0):
    """Alimenta `seconds` s de un track (un frame cada `step`); devuelve [(t, decision)]."""
    out = []
    t = t0
    while t <= t0 + seconds + 1e-9:
        box = boxes(t) if callable(boxes) else boxes
        for d in rules.update(t, [(tid, box, 0.9)], WH):
            out.append((t, d))
        t += step
    return out


# ----------------------------------------------------------------------------
# Intrusión
# ----------------------------------------------------------------------------
@pytest.mark.parametrize('box', [HEAD_ONLY, CENTER_ONLY, FEET_ONLY], ids=['cabeza', 'centro', 'pies'])
def test_intrusion_when_any_probe_point_is_in_zone(box):
    rules = make([intrusion_zone()])
    found = run(rules, 0.0, 5.0, box)
    assert len(found) == 1
    t, d = found[0]
    assert t == 2.0  # a la 3.ª detección (>= 3 hits)
    assert d.type == ANOMALY_INTRUSION and d.zone_index == 0 and d.track_id == 1
    assert d.bbox == box and d.conf == 0.9


def test_no_intrusion_outside_the_zone():
    assert run(make([intrusion_zone()]), 0.0, 30.0, OUTSIDE) == []


def test_intrusion_needs_a_stable_track():
    rules = make([intrusion_zone()])
    assert rules.update(0.0, [(1, IN_ZONE, 0.9)], WH) == []
    assert rules.update(1.0, [(1, IN_ZONE, 0.9)], WH) == []
    assert len(rules.update(2.0, [(1, IN_ZONE, 0.9)], WH)) == 1


def test_legacy_format_zones_are_all_intrusion():
    zones = parse_guardian_zones([SQUARE, FAR_SQUARE])
    assert [z.type for z in zones] == [ANOMALY_INTRUSION, ANOMALY_INTRUSION]
    assert len(run(make(zones), 0.0, 5.0, IN_ZONE)) == 1


def test_intrusion_track_cooldown():
    # Sin cooldown por zona se aísla el cooldown por track (10 s).
    rules = make([intrusion_zone()], intrusion_zone_cooldown=0.0)
    times = [t for t, _ in run(rules, 0.0, 25.0, IN_ZONE)]
    assert times == [2.0, 13.0, 24.0]  # > 10 s después de cada aviso


def test_intrusion_does_not_trigger_in_a_loitering_zone():
    rules = make([loiter_zone(seconds=1000)])
    assert [d.type for _, d in run(rules, 0.0, 30.0, IN_ZONE)] == []


# ----------------------------------------------------------------------------
# Cambio de id: supresión espacial y re-enlace
# ----------------------------------------------------------------------------
def test_new_track_id_at_same_place_is_suppressed_by_zone_cooldown():
    # Re-enlace apagado: la protección es solo la supresión por (zona, tipo).
    rules = make([intrusion_zone()], relink_seconds=0.0)
    assert len(run(rules, 0.0, 3.0, IN_ZONE, tid=1)) == 1
    # ByteTrack pierde el id 1 y lo reabre como 2 en el mismo lugar.
    assert run(rules, 5.0, 5.0, IN_ZONE, tid=2) == []


def test_spatial_suppression_only_applies_near_the_last_alert():
    big = parse_guardian_zones([[{'x': 0.4, 'y': 0.4}, {'x': 0.7, 'y': 0.4},
                                 {'x': 0.7, 'y': 0.7}, {'x': 0.4, 'y': 0.7}]])
    rules = make(big, relink_seconds=0.0)
    run(rules, 0.0, 3.0, IN_ZONE, tid=1)  # centro (500, 500), alto 160
    near = (510.0, 430.0, 550.0, 590.0)   # centro (530, 510): a ~32 px -> misma persona
    assert run(rules, 5.0, 3.0, near, tid=2) == []
    far = (640.0, 640.0, 660.0, 690.0)    # centro (650, 665): a ~220 px > 1 alto -> otra persona
    assert len(run(rules, 5.0, 3.0, far, tid=3)) == 1


def test_zone_cooldown_expires():
    rules = make([intrusion_zone()], relink_seconds=0.0)
    run(rules, 0.0, 3.0, IN_ZONE, tid=1)
    assert len(run(rules, 70.0, 3.0, IN_ZONE, tid=2)) == 1  # pasaron > 60 s


def test_relink_inherits_hits_and_cooldown_so_new_id_does_not_realert():
    rules = make([intrusion_zone()], intrusion_zone_cooldown=0.0)  # solo cuenta el re-enlace
    assert len(run(rules, 0.0, 3.0, IN_ZONE, tid=1)) == 1
    # id 2 aparece 2 s después del último avistamiento, en el mismo lugar: hereda todo.
    assert run(rules, 5.0, 4.0, IN_ZONE, tid=2) == []
    assert rules.active_tracks == 1  # el viejo se fusionó


def test_relink_new_id_inherits_hits_so_it_is_stable_immediately():
    before = (480.0, 150.0, 520.0, 310.0)  # fuera de la zona (pies y=310)
    after = (480.0, 250.0, 520.0, 410.0)   # pies y=410 dentro; a 100 px (< 1 alto) de donde se perdió el 1
    rules = make([intrusion_zone()])
    for t in (0.0, 1.0):
        rules.update(t, [(1, before, 0.9)], WH)  # 2 hits, aún inestable y fuera
    assert len(rules.update(3.0, [(2, after, 0.9)], WH)) == 1  # 2 hits heredados + 1
    # Control: sin re-enlace el id nuevo parte de cero y no alerta.
    control = make([intrusion_zone()], relink_seconds=0.0)
    for t in (0.0, 1.0):
        control.update(t, [(1, before, 0.9)], WH)
    assert control.update(3.0, [(2, after, 0.9)], WH) == []


def test_relink_keeps_loitering_clock_across_id_change():
    rules = make()  # sin zonas: merodeo = visible en el cuadro
    pos = (480.0, 420.0, 520.0, 580.0)
    assert run(rules, 0.0, 15.0, pos, tid=1) == []
    # El id cambia a los 17 s (hueco de 2 s) en el mismo lugar.
    found = run(rules, 17.0, 6.0, pos, tid=2)
    assert [(t, d.type) for t, d in found] == [(21.0, ANOMALY_LOITERING)]
    assert found[0][1].duration_seconds == pytest.approx(21.0)


def test_no_relink_after_the_window():
    rules = make()
    pos = (480.0, 420.0, 520.0, 580.0)
    run(rules, 0.0, 15.0, pos, tid=1)
    # 6 s de hueco (> 5 s): es otra persona, el reloj arranca de cero.
    assert run(rules, 21.0, 10.0, pos, tid=2) == []


def test_no_relink_when_far_away():
    rules = make()
    run(rules, 0.0, 15.0, (480.0, 420.0, 520.0, 580.0), tid=1)
    far = (80.0, 420.0, 120.0, 580.0)  # a 400 px, > 1 alto de caja (160 px)
    assert run(rules, 17.0, 6.0, far, tid=2) == []


# ----------------------------------------------------------------------------
# Merodeo
# ----------------------------------------------------------------------------
def test_loitering_without_zones_is_visible_time_in_frame():
    rules = make()
    pos = (100.0, 100.0, 140.0, 260.0)
    found = run(rules, 0.0, 30.0, pos)
    assert [(t, d.type, d.zone_index) for t, d in found] == [(21.0, ANOMALY_LOITERING, -1)]
    assert DEFAULT_LOITER_SECONDS == 20.0


def test_loitering_only_counts_inside_a_loitering_zone():
    rules = make([loiter_zone(seconds=10)])
    assert run(rules, 0.0, 40.0, OUTSIDE) == []  # 40 s visible pero fuera de la zona
    inside = run(make([loiter_zone(seconds=10)]), 0.0, 14.0, IN_ZONE)
    assert [(t, d.type, d.zone_index) for t, d in inside] == [(11.0, ANOMALY_LOITERING, 0)]


def test_loitering_threshold_is_per_zone():
    z_short = loiter_zone(seconds=5)
    z_long = loiter_zone(seconds=500, points=FAR_SQUARE)
    found = run(make([z_long, z_short]), 0.0, 8.0, IN_ZONE)
    assert [(t, d.zone_index) for t, d in found] == [(6.0, 1)]


def test_only_intrusion_zones_means_no_loitering():
    rules = make([intrusion_zone()])
    types = {d.type for _, d in run(rules, 0.0, 120.0, OUTSIDE)}
    assert types == set()
    # Dentro de la zona de intrusión sí hay intrusión, pero nunca merodeo.
    types = {d.type for _, d in run(make([intrusion_zone()], intrusion_zone_cooldown=0.0), 0.0, 120.0, IN_ZONE)}
    assert types == {ANOMALY_INTRUSION}


def test_loitering_zone_does_not_raise_intrusion():
    rules = make([loiter_zone(seconds=5)])
    assert {d.type for _, d in run(rules, 0.0, 30.0, IN_ZONE)} == {ANOMALY_LOITERING}


def test_loitering_time_accumulates_across_exits_from_the_zone():
    rules = make([loiter_zone(seconds=10)])

    def box(t):
        return IN_ZONE if (t < 6 or t >= 9) else OUTSIDE  # 6 s dentro, 3 s fuera, vuelve

    found = run(rules, 0.0, 14.0, box)
    # Acumulado dentro: t=0..5 (5 s) + t=9.. => supera 10 s cerca de t=14.
    assert len(found) == 1 and found[0][1].type == ANOMALY_LOITERING
    assert found[0][0] > 9.0


def test_loitering_track_cooldown_is_60_seconds():
    rules = make([loiter_zone(seconds=5)], loitering_zone_cooldown=0.0)
    times = [t for t, _ in run(rules, 0.0, 130.0, IN_ZONE)]
    assert times == [6.0, 67.0, 128.0]


def test_a_gap_larger_than_the_relink_window_is_not_counted_as_presence():
    rules = make([loiter_zone(seconds=10)])
    rules.update(0.0, [(1, IN_ZONE, 0.9)], WH)
    rules.update(1.0, [(1, IN_ZONE, 0.9)], WH)
    # 20 s sin verlo (YOLO saltado o fuera de cuadro): ese hueco no suma.
    for t in (21.0, 22.0, 23.0):
        assert rules.update(t, [(1, IN_ZONE, 0.9)], WH) == []


# ----------------------------------------------------------------------------
# Zonas: set_zones y parseo
# ----------------------------------------------------------------------------
def test_set_zones_with_identical_zones_keeps_accumulated_state():
    rules = make([loiter_zone(seconds=10)])
    run(rules, 0.0, 8.0, IN_ZONE)
    assert rules.set_zones([loiter_zone(seconds=10)]) is False  # el refetch periódico
    found = run(rules, 9.0, 3.0, IN_ZONE)
    assert [d.type for _, d in found] == [ANOMALY_LOITERING]


def test_set_zones_with_changes_resets_zone_state():
    rules = make([loiter_zone(seconds=10)])
    run(rules, 0.0, 8.0, IN_ZONE)
    assert rules.set_zones([loiter_zone(seconds=11)]) is True
    assert run(rules, 9.0, 3.0, IN_ZONE) == []  # el acumulado se reinició


def test_parse_new_format_with_types_and_loiter_seconds():
    zones = parse_guardian_zones([
        {'points': SQUARE, 'type': 'intrusion'},
        {'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 45},
        {'points': SQUARE, 'type': 'loitering'},
        {'points': SQUARE},
    ])
    assert [(z.type, z.loiter_seconds) for z in zones] == [
        (ANOMALY_INTRUSION, 20.0), (ANOMALY_LOITERING, 45.0),
        (ANOMALY_LOITERING, 20.0), (ANOMALY_INTRUSION, 20.0)]
    assert zones[0].polygon() == SQUARE


def test_parse_legacy_and_mixed_formats():
    zones = parse_guardian_zones([SQUARE, {'points': SQUARE, 'type': 'loitering'}])
    assert [z.type for z in zones] == [ANOMALY_INTRUSION, ANOMALY_LOITERING]


@pytest.mark.parametrize('raw', [
    None, 'x', 42, {}, [], [None], [[]], [[{'x': 0, 'y': 0}, {'x': 1, 'y': 1}]],  # < 3 puntos
    [[{'x': 0, 'y': 0}, {'x': 1, 'y': 1}, {'x': 'a', 'y': 0}]],
    [[{'x': 0, 'y': 0}, {'x': 1, 'y': 1}, {'x': float('nan'), 'y': 0}]],
    [{'points': 'nope'}], [{'type': 'loitering'}],
])
def test_parse_drops_malformed_zones(raw):
    assert parse_guardian_zones(raw) == []


def test_parse_sanitizes_loiter_seconds_and_unknown_type():
    zones = parse_guardian_zones([
        {'points': SQUARE, 'type': 'loitering', 'loiterSeconds': -5},
        {'points': SQUARE, 'type': 'loitering', 'loiterSeconds': True},
        {'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 1e9},
        {'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 0.2},
        {'points': SQUARE, 'type': 'otra-cosa'},
    ])
    assert [z.loiter_seconds for z in zones[:4]] == [20.0, 20.0, 3600.0, 1.0]
    assert zones[4].type == ANOMALY_INTRUSION  # ante la duda, vigilar de más


# ----------------------------------------------------------------------------
# Memoria acotada
# ----------------------------------------------------------------------------
def apart(i):
    """Cajas separadas más de 1 alto entre sí: el re-enlace no las fusiona."""
    return (i * 500.0, 0.0, i * 500.0 + 40.0, 160.0)


def test_memory_is_purged_together_and_bounded():
    rules = make([intrusion_zone()], max_tracks=50)
    for i in range(1000):  # 1000 ids distintos en 10 s (el TTL solo no los acota): manda el tope duro
        rules.update(i * 0.01, [(i, apart(i), 0.9)], WH)
    assert rules.active_tracks == 50
    for i in range(2000, 2100):  # y el goteo por TTL: ids espaciados por segundos
        rules.update(100.0 + i, [(i, apart(i), 0.9)], WH)
    assert rules.active_tracks <= 31
    assert len(rules._zone_alerts) <= 1
    # Todo se olvida pasado el TTL, sin que entren detecciones.
    rules.purge(5000.0)
    assert rules.active_tracks == 0 and rules._zone_alerts == {}


def test_zone_alerts_expire_with_the_cooldown():
    rules = make([intrusion_zone()])
    run(rules, 0.0, 3.0, IN_ZONE)
    assert len(rules._zone_alerts) == 1
    rules.update(100.0, [], WH)
    assert rules._zone_alerts == {}


def test_duplicate_track_ids_in_one_frame_are_collapsed():
    rules = make([intrusion_zone()])
    rules.update(0.0, [(1, IN_ZONE, 0.4), (1, IN_ZONE, 0.9)], WH)
    assert rules._tracks[1].hits == 1


# ----------------------------------------------------------------------------
# Reglas anteriores (línea base del replay)
# ----------------------------------------------------------------------------
def test_legacy_rules_realert_when_the_track_id_changes():
    """Documenta el defecto que corrige GuardianRules: cooldown solo por track_id."""
    legacy = LegacyRules()
    legacy.set_zones([intrusion_zone()])
    first = run(legacy, 0.0, 3.0, IN_ZONE, tid=1)
    second = run(legacy, 5.0, 3.0, IN_ZONE, tid=2)
    assert len(first) == 1 and len(second) == 1


def test_legacy_rules_loitering_ignores_zones():
    legacy = LegacyRules()
    legacy.set_zones([intrusion_zone()])
    found = run(legacy, 0.0, 25.0, OUTSIDE)
    assert [(t, d.type) for t, d in found] == [(21.0, ANOMALY_LOITERING)]


def test_legacy_rules_intrusion_cooldown_and_stability():
    legacy = LegacyRules()
    legacy.set_zones([intrusion_zone()])
    times = [t for t, _ in run(legacy, 0.0, 25.0, FEET_ONLY)]
    assert times == [2.0, 13.0, 24.0]
