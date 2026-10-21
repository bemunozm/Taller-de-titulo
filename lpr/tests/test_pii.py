"""`mask_plate` debe coincidir con `maskPlate` del backend (pii-mask.ts)."""
import pytest

from lpr.utils.pii import mask_plate


@pytest.mark.parametrize('plate,esperada', [
    ('BBCD12', 'BB**12'),
    ('bb-cd-12', 'BB**12'),
    ('LP1234', 'LP**34'),
    ('AB123', 'AB*23'),
    ('ABCD', '***'),
    ('', '***'),
    (None, '***'),
    ('----', '***'),
])
def test_mask_plate(plate, esperada):
    assert mask_plate(plate) == esperada


def test_texto_largo_se_acota_sin_revelar_el_medio():
    masked = mask_plate('A' * 5000)
    assert masked.startswith('AA') and masked.endswith('AA') and len(masked) == 256
