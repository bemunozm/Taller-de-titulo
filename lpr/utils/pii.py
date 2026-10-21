"""Masking of personal data for logs and console output (Ley 21.719).

Same rule as `maskPlate` in `backend/src/common/privacy/pii-mask.ts`: keep the
first 2 and the last 2 characters of the normalized plate (upper case, no
separators); with fewer than 5 characters nothing can be shown without revealing
it almost entirely, so it becomes `***`. Only LOGS are masked: the payload sent
to the backend carries the real plate.
"""
import re
from typing import Optional

MASK = '***'
# A plate is at most a handful of characters: never process more than this.
_MAX_VALUE_LENGTH = 256
_NON_ALNUM = re.compile(r'[^A-Z0-9]')


def mask_plate(plate: Optional[str]) -> str:
    """`ABCD12` -> `AB**12`; `bb-cd-12` -> `BB**12`; short or empty -> `***`."""
    normalized = _NON_ALNUM.sub('', (plate or '')[:_MAX_VALUE_LENGTH].upper())
    if len(normalized) < 5:
        return MASK
    return f"{normalized[:2]}{'*' * (len(normalized) - 4)}{normalized[-2:]}"
