"""Tests de `lpr.processor.rules` — normalización y plausibilidad de patentes.

La confirmación y el gate de confianza que vivían acá se reemplazaron por el
seguimiento + voto (ver `test_plate_tracker.py`).
"""
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


def test_plausible_plate_default_es_el_formato_chileno(monkeypatch):
    # Sin regex configurado rige el formato chileno (LLLL## / LL####), no el laxo anterior.
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', None)
    assert rules.plausible_plate('BBCD12') is True
    assert rules.plausible_plate('LP1234') is True
    assert rules.plausible_plate('TURBO') is False
    assert rules.plausible_plate('ABC123') is False
    assert rules.plausible_plate('AB') is False
    assert rules.plausible_plate('') is False


def test_plausible_plate_regex_vacio_es_como_no_configurado(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', '')
    assert rules.plausible_plate('BBCD12') is True and rules.plausible_plate('TURBO') is False


def test_regex_configurado_sigue_siendo_override(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', r'^[A-Z]{2}[0-9]{3}[A-Z]{2}$')  # formato argentino
    assert rules.plausible_plate('AB123CD') is True
    assert rules.plausible_plate('BBCD12') is False


def test_regex_invalido_no_acepta_nada(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', '[')
    assert rules.plausible_plate('BBCD12') is False


# --- resolve_plate ---------------------------------------------------------

def test_resolve_plate_corrige_por_posicion(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', None)
    assert rules.resolve_plate('BBCDI2') == 'BBCD12'
    assert rules.resolve_plate('TURBO') is None
    assert rules.resolve_plate('') is None


def test_resolve_plate_con_override_usa_el_texto_tal_cual(monkeypatch):
    monkeypatch.setattr(settings, 'LPR_PLATE_REGEX', r'^[A-Z0-9]{3,8}$')
    assert rules.resolve_plate('BBCDI2') == 'BBCDI2'  # el override manda: sin correccion
    assert rules.resolve_plate('AB') is None


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
