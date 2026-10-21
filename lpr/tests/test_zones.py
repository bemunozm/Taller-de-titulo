"""Geometria de zonas compartida (`utils/zones.py`) entre el Guardian y el LPR."""
import cv2
import numpy as np
import pytest

from lpr.utils import zones

SQUARE = [{'x': 0.25, 'y': 0.25}, {'x': 0.75, 'y': 0.25}, {'x': 0.75, 'y': 0.75}, {'x': 0.25, 'y': 0.75}]
TRIANGLE = [{'x': 0.1, 'y': 0.1}, {'x': 0.9, 'y': 0.1}, {'x': 0.5, 'y': 0.9}]
W, H = 640, 480


def test_poligono_normalizado_a_pixeles():
    px = zones.polygon_to_pixels(SQUARE, W, H)
    assert px.dtype == np.int32
    assert px.tolist() == [[160, 120], [480, 120], [480, 360], [160, 360]]


def test_descarta_poligonos_con_menos_de_tres_puntos():
    assert zones.valid_polygons([SQUARE, SQUARE[:2], [], None]) == [SQUARE]
    assert zones.valid_polygons(None) == []


def test_punto_en_poligono_incluye_el_borde():
    px = zones.polygon_to_pixels(SQUARE, W, H)
    assert zones.point_in_polygon((320, 240), px)
    assert zones.point_in_polygon((160, 240), px)       # borde
    assert not zones.point_in_polygon((100, 240), px)
    assert zones.point_in_any((100, 240), [px]) is False
    assert zones.point_in_any((320, 240), [px, px]) is True


def test_mascara_y_punto_coinciden_con_la_geometria_original_del_guardian():
    """Refactor sin cambio de comportamiento: lo que hacia el Guardian inline."""
    for polygon in (SQUARE, TRIANGLE):
        old_pts = np.array([[p['x'] * W, p['y'] * H] for p in polygon], dtype=np.int32)
        old_mask = np.zeros((H, W), dtype=np.uint8)
        cv2.fillPoly(old_mask, [old_pts], 255)

        new_px = zones.polygon_to_pixels(polygon, W, H)
        assert np.array_equal(zones.polygon_mask((H, W), new_px), old_mask)
        for pt in [(320.0, 240.0), (10.0, 10.0), (320.0, 100.0), (160.0, 240.0), (600.5, 400.25)]:
            assert zones.point_in_polygon(pt, new_px) == (cv2.pointPolygonTest(old_pts, pt, True) >= 0)


def test_rectangulo_envolvente_con_margen_y_clamp():
    px = zones.polygons_to_pixels([SQUARE], W, H)
    x1, y1, x2, y2 = zones.bounding_rect(px, W, H, margin=0.1)
    assert (x1, y1) == (160 - 32, 120 - 24)
    assert (x2, y2) == (480 + 32 + 1, 360 + 24 + 1)
    # una zona pegada al borde se recorta al frame
    edge = zones.polygons_to_pixels([[{'x': 0.0, 'y': 0.0}, {'x': 1.0, 'y': 0.0}, {'x': 1.0, 'y': 1.0}]], W, H)
    assert zones.bounding_rect(edge, W, H, margin=0.2) == (0, 0, W, H)


def test_envolvente_de_varios_poligonos_y_vacio():
    two = zones.polygons_to_pixels([SQUARE, TRIANGLE], W, H)
    x1, y1, x2, y2 = zones.bounding_rect(two, W, H, margin=0.0)
    assert x1 == 64 and y1 == 48 and x2 == 576 + 1 and y2 == 432 + 1
    assert zones.bounding_rect([], W, H) is None


@pytest.mark.parametrize('bad', [[{'x': 0.1, 'y': 0.1}, {'x': 0.2, 'y': 0.2}]])
def test_poligono_invalido_no_genera_pixeles(bad):
    assert zones.polygons_to_pixels([bad], W, H) == []
