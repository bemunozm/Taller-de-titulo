"""Telemetria de fps efectivos del worker (`utils/throughput.py`): logica pura con reloj falso."""
from lpr.utils.throughput import ThroughputMeter, format_report


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def meter(clock, **kw):
    return ThroughputMeter(interval=60.0, clock=clock, **kw)


def test_no_reporta_antes_de_la_ventana():
    c = Clock()
    m = meter(c)
    m.offered()
    c.t += 59.9
    assert m.poll(8.0) is None


def test_cuenta_ofrecidos_procesados_y_descartados_y_reinicia_la_ventana():
    c = Clock()
    m = meter(c)
    for _ in range(10):
        m.offered()
    for _ in range(8):
        m.processed()
    for _ in range(2):
        m.dropped()
    c.t += 60.0
    r = m.poll(0.2)
    assert (r.offered, r.processed, r.dropped) == (10, 8, 2)
    assert abs(r.effective_fps - 8 / 60.0) < 1e-9
    assert r.configured_fps == 0.2 and r.low  # 0.133 fps < 80 % de 0.2
    assert m.poll(0.2) is None                      # ventana nueva
    c.t += 60.0
    r2 = m.poll(0.2)
    assert (r2.offered, r2.processed, r2.dropped) == (0, 0, 0)


def test_efectivo_bajo_80_por_ciento_marca_low():
    c = Clock()
    m = meter(c)
    for _ in range(300):  # 5 fps efectivos de 8 configurados = 62.5 %
        m.processed()
    c.t += 60.0
    r = m.poll(8.0)
    assert r.low and abs(r.effective_fps - 5.0) < 1e-9


def test_efectivo_en_el_umbral_o_sobre_el_no_es_low():
    c = Clock()
    m = meter(c)
    for _ in range(384):  # 6.4 fps = exactamente 80 % de 8
        m.processed()
    c.t += 60.0
    assert not m.poll(8.0).low


def test_sin_fps_configurado_nunca_es_low():
    c = Clock()
    m = meter(c)
    c.t += 60.0
    assert not m.poll(0.0).low


def test_format_report_lleva_los_contadores():
    c = Clock()
    m = meter(c)
    m.offered(); m.processed(); m.dropped()
    c.t += 60.0
    line = format_report(m.poll(8.0))
    assert 'offered=1' in line and 'processed=1' in line and 'dropped(busy)=1' in line
