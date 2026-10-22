import {
  differsByOneSubstitution,
  directionsCompatibleForVariant,
} from './plate-variant';

describe('differsByOneSubstitution', () => {
  it.each([
    ['ABCD12', 'ABCD1Z'],
    ['ABCD12', 'ZBCD12'],
    ['ABCD12', 'ABZD12'],
  ])('%s vs %s: una sustitución', (a, b) => {
    expect(differsByOneSubstitution(a, b)).toBe(true);
    expect(differsByOneSubstitution(b, a)).toBe(true);
  });

  it.each([
    ['ABCD12', 'ABCD12', 'idénticas'],
    ['ABCD12', 'ABCDZZ', 'dos sustituciones'],
    ['ABCD12', 'ABCD1', 'largo menor'],
    ['ABCD12', 'ABCD123', 'largo mayor'],
    ['ABCD12', 'BCD12A', 'rotación'],
    ['', '', 'vacías'],
  ])('%s vs %s: no (%s)', (a, b) => {
    expect(differsByOneSubstitution(a, b)).toBe(false);
  });
});

describe('directionsCompatibleForVariant', () => {
  it.each([
    ['entry', 'entry', true],
    ['exit', 'exit', true],
    ['unknown', 'unknown', true],
    ['unknown', 'exit', true],
    ['entry', 'unknown', true],
    ['entry', 'exit', false],
    ['exit', 'entry', false],
  ] as const)('%s / %s -> %s', (a, b, expected) => {
    expect(directionsCompatibleForVariant(a, b)).toBe(expected);
  });
});
