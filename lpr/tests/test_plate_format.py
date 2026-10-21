"""Chilean plate format and positional correction (`processor/plate_format.py`)."""
import pytest

from lpr.processor.plate_format import correct_plate, is_valid_chilean_plate


@pytest.mark.parametrize('plate', ['BBCD12', 'KRZT45', 'GRBD26', 'LP1234', 'AB1234', 'ZZ0000'])
def test_patente_valida_se_acepta_y_no_se_modifica(plate):
    assert is_valid_chilean_plate(plate) is True
    assert correct_plate(plate) == plate


@pytest.mark.parametrize('text', [
    '', 'TURBO', '4X4', 'AB', 'AB123CD', '3456789',
    'BACD12',   # vocal en el formato nuevo
    'BBMD12',   # M no existe en el formato nuevo
    'QQ1234',   # Q no existe en ningun formato
    'BBCD123',  # largo incorrecto
])
def test_texto_que_no_es_patente_se_descarta(text):
    assert is_valid_chilean_plate(text) is False
    assert correct_plate(text) is None


@pytest.mark.parametrize('leida,esperada', [
    ('BBCDI2', 'BBCD12'),   # I en posicion de digito -> 1
    ('BBC012', 'BBCD12'),   # 0 en posicion de letra (formato nuevo) -> D
    ('BBCD1Z', 'BBCD12'),   # Z en digito -> 2
    ('KRZT4A', 'KRZT44'),   # A en digito -> 4
    ('TCZPS4', 'TCZP54'),   # S en digito -> 5
    ('8BCD12', 'BBCD12'),   # 8 en letra -> B
    ('6BCD12', 'GBCD12'),   # 6 en letra -> G
    ('ABI2O4', 'AB1204'),   # formato antiguo: I->1, O->0
    ('A81234', 'AB1234'),   # formato antiguo: 8 en letra -> B
    ('AB123Z', 'AB1232'),   # Z en digito del formato antiguo
])
def test_correccion_posicional(leida, esperada):
    assert correct_plate(leida) == esperada
    # una lectura corregida no cuenta como "valida tal cual"
    assert is_valid_chilean_plate(leida) is False


def test_prefiere_el_formato_que_necesita_menos_correcciones():
    # LP1234 calza como antiguo sin cambios y como nuevo solo con dos (LPLZ34).
    assert correct_plate('LP1234') == 'LP1234'


def test_empate_entre_formatos_se_resuelve_a_favor_del_nuevo():
    # BBZ211 -> BBZZ11 (nuevo, 1 cambio) o BB2211 (antiguo, 1 cambio); GR8D26 -> GRBD26 o GR8026.
    assert correct_plate('BBZ211') == 'BBZZ11'
    assert correct_plate('GR8D26') == 'GRBD26'


def test_letra_fuera_del_set_solo_se_sustituye_si_el_ocr_dudaba():
    confs_dudosa = [0.3, 0.9, 0.9, 0.9, 0.9, 0.9]
    confs_segura = [0.95, 0.9, 0.9, 0.9, 0.9, 0.9]
    assert correct_plate('OBCD12', confs_dudosa) == 'DBCD12'
    assert correct_plate('OBCD12', confs_segura) is None
    assert correct_plate('OBCD12') is None


def test_confianzas_desalineadas_se_ignoran():
    assert correct_plate('OBCD12', [0.1, 0.1]) is None


def test_no_acepta_digitos_no_ascii():
    assert correct_plate('BBCD１２') is None  # digitos de ancho completo


@pytest.mark.parametrize('leida,esperada', [
    # Patentes SINTETICAS (nunca reales) con las confusiones observadas en la camara del porton.
    ('KR2T45', 'KRZT45'),   # Z leida como 2
    ('PGH230', 'PGHZ30'),   # Z leida como 2 antes de los digitos
    ('GR8D26', 'GRBD26'),   # B leida como 8
    ('SHL253', 'SHLZ53'),   # Z leida como 2 en la tercera letra
])
def test_confusiones_observadas_en_el_porton_se_siguen_corrigiendo(leida, esperada):
    assert correct_plate(leida) == esperada


@pytest.mark.parametrize('texto', [
    '123456',   # solo digitos: antes daba IZ3456
    '000000',
    '111111',
    'ABCDEF',
    '12ABCD',   # antiguo con las dos letras ancla en digitos
    '12AB34',
    '0000AB',   # nuevo con 4 digitos donde van letras
])
def test_texto_que_no_parece_patente_no_se_fuerza(texto):
    assert correct_plate(texto) is None


def test_maximo_dos_correcciones_por_lectura():
    assert correct_plate('BBCDI2') == 'BBCD12'   # 1 correccion
    assert correct_plate('BBC0I2') == 'BBCD12'   # 2 correcciones
    assert correct_plate('B8C0IZ') is None       # 4 correcciones: demasiado dudosa
    assert correct_plate('ABI2OZ') is None       # antiguo con 3 correcciones


def test_una_sola_letra_ancla_en_digito_se_tolera():
    assert correct_plate('A81234') == 'AB1234'   # antiguo: una letra ancla era digito
    assert correct_plate('81234') is None        # largo incorrecto
