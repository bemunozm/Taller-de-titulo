import {
  randomPassword,
  randomPhone,
  randomPlate,
  randomRut,
  rutCheckDigit,
  uniqueEmail,
  uniqueSuffix,
} from './test-data';

/**
 * Pieza unitaria del harness e2e (Fase 4 · P8): los datos generados cumplen
 * los formatos que valida el backend.
 */
describe('datos de prueba e2e (harness e2e)', () => {
  it.each([
    [12_345_678, '5'],
    [11_111_111, '1'],
    [7_654_321, '6'],
    [10_000_013, 'K'],
  ])('rutCheckDigit(%p) = %p', (body, digit) => {
    expect(rutCheckDigit(body)).toBe(digit);
  });

  it('randomRut: cuerpo de 8 dígitos y dígito verificador correcto', () => {
    for (let i = 0; i < 100; i++) {
      const rut = randomRut();
      const match = /^(\d{8})-([\dK])$/.exec(rut);
      expect(match).not.toBeNull();
      if (match) {
        expect(rutCheckDigit(Number(match[1]))).toBe(match[2]);
      }
    }
  });

  it('randomPhone: +569 y 8 dígitos (cabe en los 15 caracteres del DTO)', () => {
    for (let i = 0; i < 100; i++) {
      const phone = randomPhone();
      expect(phone).toMatch(/^\+569\d{8}$/);
      expect(phone.length).toBeLessThanOrEqual(15);
    }
  });

  it('randomPlate: formato actual chileno (4 letras + 2 dígitos)', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomPlate()).toMatch(/^[A-Z]{4}\d{2}$/);
    }
  });

  it('uniqueEmail y uniqueSuffix no se repiten', () => {
    const emails = new Set(
      Array.from({ length: 50 }, () => uniqueEmail('Admin Condominio A')),
    );
    expect(emails.size).toBe(50);
    for (const email of emails) {
      expect(email).toMatch(/^admin\.condominio\.a\.[0-9a-z]+@vigilia\.test$/);
    }
    expect(uniqueSuffix()).not.toBe(uniqueSuffix());
  });

  it('randomPassword: entre 8 y 128 caracteres', () => {
    const password = randomPassword();
    expect(password.length).toBeGreaterThanOrEqual(8);
    expect(password.length).toBeLessThanOrEqual(128);
  });
});
