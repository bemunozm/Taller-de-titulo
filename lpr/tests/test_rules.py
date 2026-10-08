"""Tests de `lpr.processor.rules` — la lógica pura que decide si una detección
se confirma y se emite (y por lo tanto si se abre un portón).

Antes de Fase 3 el único test del subproyecto era `assert 1 + 1 == 2`. Estos
tests fijan el comportamiento de las reglas tras las correcciones de 3.A.
"""
import time

import pytest

from lpr.processor import rules
from lpr.settings import settings


# --- normalize_plate --------------------------------------------------------

def test_normalize_quita_espacios_guionbajo_y_pasa_a_mayuscula():
    assert rules.normalize_plate('bb cd_12') == 'BBCD12'


def test_normalize_tolera_none():
    assert rules.normalize_plate(None) == ''


# --- plausible_plate con el charset chileno --------------------------------

CHILE_REGEX = r'^([BCDFGHJKLPRSTVWXYZ]{4}[0-9]{2}|[BCDFGHJKLPRSTVWXYZ]{2}[0-9]{4})$'


@pytest.fixture
def chile_regex(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', CHILE_REGEX)


@pytest.mark.parametrize('plate,esperado', [
    ('BBCD12', True),    # formato nuevo LLLL##
    ('LP1234', True),    # formato antiguo LL####
    ('TURBO', False),    # texto de carrocería
    ('4X4', False),
    ('123456', False),
    ('BACD12', False),   # contiene vocal A → no es patente chilena
    ('AB123CD', False),  # patente argentina
    ('', False),
])
def test_plausible_plate_charset_chileno(chile_regex, plate, esperado):
    assert rules.plausible_plate(plate) is esperado


def test_plausible_plate_default_permisivo(monkeypatch):
    # Sin regex configurado corre el fallback laxo `^[A-Z0-9]{3,8}$`.
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', None)
    assert rules.plausible_plate('TURBO') is True
    assert rules.plausible_plate('AB') is False  # < 3 chars


# --- should_confirm --------------------------------------------------------

def test_no_confirma_con_una_sola_aparicion(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_CONFIRM_FRAMES', 3)
    monkeypatch.setattr(settings, 'LPR_CONFIRM_SECONDS', 5.0)
    now = time.time()
    sightings = {'BBCD12': {'first_seen': now, 'count': 1, 'last_seen': now}}
    confirmado, _ = rules.should_confirm(sightings, 'BBCD12')
    assert confirmado is False


def test_confirma_al_alcanzar_confirm_frames(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_CONFIRM_FRAMES', 3)
    monkeypatch.setattr(settings, 'LPR_CONFIRM_SECONDS', 5.0)
    now = time.time()
    sightings = {'BBCD12': {'first_seen': now, 'count': 3, 'last_seen': now}}
    confirmado, info = rules.should_confirm(sightings, 'BBCD12')
    assert confirmado is True
    assert info.get('confirmed_by') == 'frames'


def test_no_confirma_patente_desconocida():
    confirmado, info = rules.should_confirm({}, 'NOEXISTE')
    assert confirmado is False
    assert info.get('reason') == 'no_sightings'


# --- should_save_or_emit ---------------------------------------------------

def test_emite_con_ocr_altisimo(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_COMBINED_ALPHA', 0.75)
    monkeypatch.setattr(settings, 'LPR_COMBINED_THRESHOLD', 0.3)
    # ocr_conf >= ocr_thresh → True por la primera regla
    assert rules.should_save_or_emit(0.4, 0.99, 0.3, 0.55, 0.98) is True


def test_no_emite_con_ambas_confianzas_bajas(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_COMBINED_ALPHA', 0.75)
    monkeypatch.setattr(settings, 'LPR_COMBINED_THRESHOLD', 0.3)
    # det y ocr bajos → combined < threshold → no emite
    assert rules.should_save_or_emit(0.1, 0.05, 0.3, 0.55, 0.98) is False


# --- analyze_char_confidences ----------------------------------------------

def test_analyze_char_confidences_lista_vacia():
    stats = rules.analyze_char_confidences([])
    assert stats['num_chars'] == 0
    assert stats['ratio_above'] == 0.0


def test_analyze_char_confidences_calcula_min_y_ratio(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_MIN_CHAR_CONF', 0.5)
    stats = rules.analyze_char_confidences([0.9, 0.9, 0.3, 0.8])
    assert stats['num_chars'] == 4
    assert stats['min'] == pytest.approx(0.3)
    assert stats['ratio_above'] == pytest.approx(0.75)  # 3 de 4 >= 0.5
