import { buildHouseContext, EMPTY_HOUSE_CONTEXT } from './house-context';

/**
 * Corrección P7 (cyber B8, decisión de Nova): el contexto de la casa que
 * recibe el dispositivo es solo la cantidad de visitas esperadas, sin
 * nombres (antes: "Nombre I." saneados, Fase 4 · P6.M).
 */
describe('buildHouseContext', () => {
  it('solo la cantidad: { expectedVisitorsCount }', () => {
    expect(buildHouseContext(3)).toStrictEqual({ expectedVisitorsCount: 3 });
    expect(Object.keys(buildHouseContext(1))).toEqual([
      'expectedVisitorsCount',
    ]);
  });

  it.each([
    [0, 0],
    [-2, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [2.5, 0],
  ])('valor %p -> %p (entero ≥ 0, fail-closed)', (raw, expected) => {
    expect(buildHouseContext(raw).expectedVisitorsCount).toBe(expected);
  });

  it('EMPTY_HOUSE_CONTEXT es 0 e inmutable', () => {
    expect(EMPTY_HOUSE_CONTEXT).toStrictEqual({ expectedVisitorsCount: 0 });
    expect(Object.isFrozen(EMPTY_HOUSE_CONTEXT)).toBe(true);
  });
});
