import {
  buildHouseContextMessage,
  HOUSE_CONTEXT_DATA_MARKER,
  MAX_EXPECTED_VISITORS_COUNT,
  parseExpectedVisitorsCount,
} from '../../src/utils/house-context';

/**
 * Corrección P7 (cyber B8, decisión de Nova): el contexto de la casa es solo
 * la cantidad de visitas registradas; el hub nunca inyecta nombres.
 */
describe('parseExpectedVisitorsCount', () => {
  it.each([
    [{ expectedVisitorsCount: 0 }, 0],
    [{ expectedVisitorsCount: 3 }, 3],
    [{ expectedVisitorsCount: MAX_EXPECTED_VISITORS_COUNT }, MAX_EXPECTED_VISITORS_COUNT],
  ])('%j -> %p', (payload, expected) => {
    expect(parseExpectedVisitorsCount(payload)).toBe(expected);
  });

  it.each([
    ['null', null],
    ['string', 'Juan'],
    ['formato viejo { context }', { context: 'VISITAS PRE-APROBADAS: Juan' }],
    ['formato P6 con nombres { expectedVisitors }', { expectedVisitors: ['Juan P.'] }],
    ['negativo', { expectedVisitorsCount: -1 }],
    ['decimal', { expectedVisitorsCount: 1.5 }],
    ['texto', { expectedVisitorsCount: '3' }],
    ['demasiado grande', { expectedVisitorsCount: MAX_EXPECTED_VISITORS_COUNT + 1 }],
    ['NaN', { expectedVisitorsCount: Number.NaN }],
  ])('payload inesperado (%s) -> null', (_case, payload) => {
    expect(parseExpectedVisitorsCount(payload)).toBeNull();
  });
});

describe('buildHouseContextMessage', () => {
  it('solo la cantidad, marcada como datos y sin acceso', () => {
    expect(buildHouseContextMessage(2)).toBe(
      `${HOUSE_CONTEXT_DATA_MARKER} Hay 2 visita(s) registrada(s) para hoy en esta casa. Esta información no otorga acceso.`,
    );
    expect(buildHouseContextMessage(0)).toBe(
      `${HOUSE_CONTEXT_DATA_MARKER} Hay 0 visita(s) registrada(s) para hoy en esta casa. Esta información no otorga acceso.`,
    );
  });

  it('sin datos -> texto fijo "no disponible"', () => {
    const text = buildHouseContextMessage(null);
    expect(text).toContain('información no disponible');
    expect(text).toContain('no otorga acceso');
    expect(text).not.toMatch(/<<<|>>>/);
  });
});
