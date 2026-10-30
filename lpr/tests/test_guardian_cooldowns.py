"""Cooldown por (zona, tipo) separado por tipo: intrusión 20 s, merodeo 60 s.

Medido con 71 clips de Acceso a 1 fps: con 60 s para la intrusión se suprimía la
entrada real de visitas que antes esperaron pegadas a la reja (33/54 intrusiones
detectadas; 37/54 con 30 s; 44/54 con 20 s)."""
from lpr.processor.guardian_rules import (
    ANOMALY_INTRUSION,
    ANOMALY_LOITERING,
    GuardianConfig,
    GuardianRules,
    parse_guardian_zones,
)

WH = (1000, 1000)
SQUARE = [{'x': 0.4, 'y': 0.4}, {'x': 0.6, 'y': 0.4}, {'x': 0.6, 'y': 0.6}, {'x': 0.4, 'y': 0.6}]
IN_ZONE = (480.0, 420.0, 520.0, 580.0)


def make(zone, **cfg):
    rules = GuardianRules(GuardianConfig(**cfg))
    rules.set_zones(parse_guardian_zones([zone]))
    return rules


def run(rules, t0, seconds, tid, step=1.0):
    out = []
    t = t0
    while t <= t0 + seconds + 1e-9:
        out += [(t, d) for d in rules.update(t, [(tid, IN_ZONE, 0.9)], WH)]
        t += step
    return out


def test_defaults_are_20_for_intrusion_and_60_for_loitering():
    cfg = GuardianConfig()
    assert (cfg.intrusion_zone_cooldown, cfg.loitering_zone_cooldown) == (20.0, 60.0)
    assert cfg.zone_cooldown_for(ANOMALY_INTRUSION) == 20.0
    assert cfg.zone_cooldown_for(ANOMALY_LOITERING) == 60.0


def test_intrusion_from_the_same_place_realerts_after_20_s_and_not_before():
    # El id 1 alerta a los 2 s. Un id nuevo (sin re-enlace) alerta a los a+2 s.
    for start, expect in ((19.0, 0), (20.0, 1)):
        rules = make(SQUARE, relink_seconds=0.0)
        assert len(run(rules, 0.0, 2.0, tid=1)) == 1
        found = run(rules, start, 2.0, tid=2)
        # start=19 -> intenta a los 21 s: 21 - 2 = 19 < 20 -> suprimido.
        # start=20 -> intenta a los 22 s: 22 - 2 = 20, ya no suprime.
        assert len(found) == expect, start


def test_same_track_standing_still_realerts_every_20_s_for_intrusion():
    rules = make(SQUARE)
    times = [t for t, _ in run(rules, 0.0, 45.0, tid=1)]
    assert times == [2.0, 22.0, 42.0]


def test_loitering_zone_suppression_still_lasts_60_s():
    zone = {'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 5}
    for start, expect in ((59.0, 0), (60.0, 1)):
        rules = GuardianRules(GuardianConfig(relink_seconds=0.0))
        rules.set_zones(parse_guardian_zones([zone]))
        first = run(rules, 0.0, 7.0, tid=1)
        assert [t for t, _ in first] == [6.0]
        # El id nuevo acumula >5 s a los start+6 s: suprimido mientras (start+6) - 6 < 60.
        assert len(run(rules, start, 6.0, tid=2)) == expect, start


def test_zone_alerts_expire_per_type():
    intrusion = make(SQUARE)
    run(intrusion, 0.0, 2.0, tid=1)
    intrusion.update(15.0, [], WH)
    assert len(intrusion._zone_alerts) == 1   # 13 s < 20 s
    intrusion.update(23.0, [], WH)
    assert intrusion._zone_alerts == {}       # > 20 s

    loiter = GuardianRules()
    loiter.set_zones(parse_guardian_zones([{'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 5}]))
    run(loiter, 0.0, 6.0, tid=1)
    loiter.update(40.0, [], WH)
    assert len(loiter._zone_alerts) == 1      # sigue vigente (< 60 s)
    loiter.update(70.0, [], WH)
    assert loiter._zone_alerts == {}


def test_forget_emission_clears_the_zone_alert_of_each_type():
    both = GuardianRules()
    both.set_zones(parse_guardian_zones([SQUARE, {'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 5}]))
    found = run(both, 0.0, 7.0, tid=1)
    assert {d.type for _, d in found} == {ANOMALY_INTRUSION, ANOMALY_LOITERING}
    assert set(both._zone_alerts) == {(0, ANOMALY_INTRUSION), (1, ANOMALY_LOITERING)}
    for _, d in found:
        both.forget_emission(d)
    assert both._zone_alerts == {}
