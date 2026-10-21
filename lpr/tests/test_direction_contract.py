"""Contrato cruzado de la convencion de la linea de direccion
(`contracts/direction-line.cases.json`): lo comparten este worker y el editor del
frontend, para que la flecha que se dibuja apunte hacia donde mide el worker."""
import json
from pathlib import Path

import pytest

from lpr.utils.direction import DirectionLine, detect_line_crossing, side_of_line

CONTRACT = Path(__file__).resolve().parents[2] / 'contracts' / 'direction-line.cases.json'
CASES = json.loads(CONTRACT.read_text(encoding='utf-8'))
W, H = CASES['frameSize']['width'], CASES['frameSize']['height']


def _line(raw, exit_side='left'):
    return DirectionLine(raw['from']['x'], raw['from']['y'], raw['to']['x'], raw['to']['y'],
                         raw.get('exitSide', exit_side))


def test_el_contrato_existe_y_tiene_casos():
    assert len(CASES['sideCases']) >= 5 and len(CASES['crossingCases']) >= 5


@pytest.mark.parametrize('case', CASES['sideCases'], ids=lambda c: c['name'])
def test_lado_de_un_punto(case):
    p = case['point']
    assert side_of_line(_line(case['line']), p['x'], p['y']) == case['side']


@pytest.mark.parametrize('case', CASES['crossingCases'], ids=lambda c: c['name'])
def test_cruce_del_segmento(case):
    # un punto por segundo, en pixeles del cuadro del contrato
    path = [(float(i), p['x'] * W, p['y'] * H) for i, p in enumerate(case['path'])]
    assert detect_line_crossing(path, _line(case['line']), W, H) == case['expected']
