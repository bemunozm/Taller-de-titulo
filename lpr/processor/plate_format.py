"""Chilean plate format: validation and positional correction (pure, no settings).

Two car formats exist:

* ``LLLL##``: four letters from the 18-letter set ``BCDFGHJKLPRSTVWXYZ``
  (no vowels, no M, N, Ñ, Q) followed by two digits.
* ``LL####``: two letters (A-Z without Q; Ñ cannot appear in ASCII) followed
  by four digits.

The OCR confuses look-alike glyphs (0/O/D, 1/I/L, 2/Z, 4/A, 5/S, 6/G, 8/B).
Because the class of every position is known from the format (letter or
digit), a character of the wrong class can be mapped to its look-alike. This
module ports the logic validated offline ("chileno + corrección posicional");
see `lpr/tools/replay_eval.py` for the regression harness.

A reading is discarded (``None``) when it fits no format or needs more
corrections than a real misread would (see MAX_CHANGES and the anchor rules).
"""
from typing import Dict, List, Optional, Sequence, Tuple

# Letters allowed in the modern format (LLLL##).
MODERN_LETTERS = frozenset('BCDFGHJKLPRSTVWXYZ')
# Letters allowed in the old format (LL####): the whole alphabet except Q.
OLD_LETTERS = frozenset('ABCDEFGHIJKLMNOPRSTUVWXYZ')

# (name, class pattern, allowed letters). Order matters: on a tie, the first wins.
FORMATS: Tuple[Tuple[str, str, frozenset], ...] = (
    ('modern', 'LLLLDD', MODERN_LETTERS),
    ('old', 'LLDDDD', OLD_LETTERS),
)

# Letter read where a digit belongs -> digit it most likely is.
LETTER_TO_DIGIT: Dict[str, str] = {
    'O': '0', 'D': '0', 'Q': '0', 'I': '1', 'Z': '2', 'S': '5', 'G': '6', 'B': '8', 'A': '4',
}
# Digit read where a letter belongs -> letter it most likely is. The modern
# set has no vowels, so 0 can only be D and 1 can only be L.
DIGIT_TO_LETTER_MODERN: Dict[str, str] = {'0': 'D', '1': 'L', '2': 'Z', '5': 'S', '6': 'G', '8': 'B'}
DIGIT_TO_LETTER_OLD: Dict[str, str] = {
    '0': 'O', '1': 'I', '2': 'Z', '4': 'A', '5': 'S', '6': 'G', '8': 'B',
}
# A letter outside the modern set is replaced by its look-alike inside the set
# only when the OCR itself was unsure about that character.
OUTSIDE_TO_INSIDE_MODERN: Dict[str, str] = {
    'O': 'D', 'Q': 'D', 'I': 'L', 'A': 'R', 'E': 'F', 'U': 'V', 'M': 'W', 'N': 'H',
}
LOW_CHAR_CONFIDENCE = 0.6
# Hardening against texts that are not plates (a sticker "123456" must not
# become "IZ3456"). A correction is only trusted when the reading is already
# mostly right:
# * at most MAX_CHANGES positional corrections per reading;
# * the letter group (the "anchor" of the plate) may have at most
#   MAX_WRONG_CLASS_LETTERS characters of the wrong class (digits where letters
#   belong): LL#### rejects "12...." and LLLL## rejects two or more digits among
#   the four letters;
# * the digit group must keep at least half of its characters as real digits.
# The confusions observed on the gate camera have a single wrong character, so
# they all pass.
MAX_CHANGES = 2
MAX_WRONG_CLASS_LETTERS = 1


def _is_ascii_letter(ch: str) -> bool:
    return 'A' <= ch <= 'Z'


def _fit(text: str, pattern: str, letters: frozenset,
         char_confidences: Sequence[float]) -> Optional[Tuple[str, int]]:
    """Try to fit `text` to one format; returns (corrected, #changes) or None."""
    if len(text) != len(pattern):
        return None
    modern = letters is MODERN_LETTERS
    digit_to_letter = DIGIT_TO_LETTER_MODERN if modern else DIGIT_TO_LETTER_OLD
    out: List[str] = []
    changes = 0
    wrong_letters = 0  # digits found where a letter belongs
    wrong_digits = 0   # letters found where a digit belongs
    for i, (ch, cls) in enumerate(zip(text, pattern)):
        if cls == 'D':
            if ch.isascii() and ch.isdigit():
                out.append(ch)
            elif ch in LETTER_TO_DIGIT:
                out.append(LETTER_TO_DIGIT[ch])
                changes += 1
                wrong_digits += 1
            else:
                return None
        else:
            if ch in letters:
                out.append(ch)
            elif ch.isascii() and ch.isdigit() and ch in digit_to_letter:
                out.append(digit_to_letter[ch])
                changes += 1
                wrong_letters += 1
            elif (modern and _is_ascii_letter(ch) and ch in OUTSIDE_TO_INSIDE_MODERN
                  and i < len(char_confidences) and char_confidences[i] < LOW_CHAR_CONFIDENCE):
                out.append(OUTSIDE_TO_INSIDE_MODERN[ch])
                changes += 1
            else:
                return None
    digit_group = pattern.count('D')
    if (changes > MAX_CHANGES or wrong_letters > MAX_WRONG_CLASS_LETTERS
            or wrong_digits * 2 > digit_group):
        return None
    return ''.join(out), changes


def correct_plate(text: str, char_confidences: Optional[Sequence[float]] = None) -> Optional[str]:
    """Return the plate corrected to a valid Chilean format, or None.

    `text` must already be normalized (upper case, no padding). `char_confidences`
    (one per character) enables the low-confidence letter substitution.
    """
    if not text:
        return None
    confs = list(char_confidences or [])
    # Only keep per-char confidences when they line up with the text.
    if len(confs) != len(text):
        confs = []
    fits = [f for f in (_fit(text, pattern, letters, confs) for _n, pattern, letters in FORMATS)
            if f is not None]
    if not fits:
        return None
    # Fewest corrections wins. On a tie the modern format wins: it is the one in
    # circulation since 2007 and the old one only appears on older vehicles, so a
    # reading that fits both with the same effort (GR8D26 -> GRBD26 or GR8026) is
    # far more likely modern. (`fits` follows the order of FORMATS: modern first.)
    return min(fits, key=lambda f: f[1])[0]


def is_valid_chilean_plate(text: str) -> bool:
    """True when `text` already is a valid plate, with no correction needed."""
    if not text:
        return False
    return any(_fit(text, pattern, letters, []) == (text, 0) for _n, pattern, letters in FORMATS)
