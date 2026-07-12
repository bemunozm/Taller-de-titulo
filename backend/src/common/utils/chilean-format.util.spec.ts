import {
  formatRut,
  isValidChileanPhone,
  isValidChileanPlate,
  isValidIdentityDocument,
  isValidPassport,
  isValidRut,
  looksLikeRut,
  normalizeChileanPhone,
  normalizeChileanPlate,
} from './chilean-format.util';

/**
 * Cierre de brecha Fase 1 → Fase 2 (docs/modulos/agente-cerebro.md §7/§10.2):
 * estos util replican en el backend la validación/formateo que el frontend
 * hacía antes de adelgazarse (ver `frontend/src/helpers/index.ts`). Los
 * casos de RUT son los MISMOS ejemplos que se usaban ahí (RUTs reales de
 * prueba con dígito verificador correcto/incorrecto).
 */
describe('chilean-format.util', () => {
  describe('formatRut / isValidRut', () => {
    it('formatea un RUT sin puntos ni guión a XX.XXX.XXX-X', () => {
      expect(formatRut('12345678-5')).toBe('12.345.678-5');
      expect(formatRut('123456785')).toBe('12.345.678-5');
    });

    it('formatea un RUT con dígito verificador K en mayúscula', () => {
      expect(formatRut('76543210k')).toBe('76.543.210-K');
    });

    it('valida un RUT con dígito verificador correcto', () => {
      // 12.345.678-5 es un RUT cuyo DV real (módulo 11) es 5
      expect(isValidRut('12345678-5')).toBe(true);
      expect(isValidRut('12.345.678-5')).toBe(true);
    });

    it('rechaza un RUT con dígito verificador incorrecto', () => {
      expect(isValidRut('12345678-9')).toBe(false);
    });

    it('valida un RUT cuyo dígito verificador calculado es K', () => {
      // 1.000.005-K: cuerpo cuyo módulo 11 da dvCalculado === 10 -> 'k'
      expect(isValidRut('1000005-k')).toBe(true);
      expect(isValidRut('1.000.005-K')).toBe(true);
      expect(isValidRut('1000005-9')).toBe(false);
    });

    it('rechaza un cuerpo no numérico', () => {
      expect(isValidRut('ABCDEFGH-5')).toBe(false);
    });
  });

  describe('looksLikeRut', () => {
    it('reconoce un RUT de 8-9 caracteres terminado en dígito o K', () => {
      expect(looksLikeRut('12345678-5')).toBe(true);
      expect(looksLikeRut('123456785')).toBe(true);
      expect(looksLikeRut('7654321-0K')).toBe(true);
    });

    it('no reconoce un pasaporte alfanumérico como RUT', () => {
      expect(looksLikeRut('AB123456')).toBe(false);
    });

    it('no reconoce strings demasiado cortos o largos', () => {
      expect(looksLikeRut('123')).toBe(false);
      expect(looksLikeRut('1234567890123')).toBe(false);
    });
  });

  describe('isValidPassport', () => {
    it('valida un pasaporte alfanumérico de 6-12 caracteres', () => {
      expect(isValidPassport('AB123456')).toBe(true);
    });

    it('rechaza un pasaporte demasiado corto', () => {
      expect(isValidPassport('AB12')).toBe(false);
    });
  });

  describe('isValidIdentityDocument (RUT o pasaporte)', () => {
    it('valida como RUT si contiene guión', () => {
      expect(isValidIdentityDocument('12.345.678-5')).toBe(true);
      expect(isValidIdentityDocument('12.345.678-9')).toBe(false);
    });

    it('valida como pasaporte si no parece RUT', () => {
      expect(isValidIdentityDocument('AB123456')).toBe(true);
    });

    it('rechaza un valor vacío', () => {
      expect(isValidIdentityDocument('   ')).toBe(false);
    });
  });

  describe('normalizeChileanPhone / isValidChileanPhone', () => {
    it('normaliza un número nacional de 9 dígitos anteponiendo +56', () => {
      expect(normalizeChileanPhone('912345678')).toBe('+56912345678');
    });

    it('respeta un número que ya trae el código de país', () => {
      expect(normalizeChileanPhone('+56 9 1234 5678')).toBe('+56912345678');
      expect(normalizeChileanPhone('56912345678')).toBe('+56912345678');
    });

    it('antepone +569 a un celular dictado sin el 9 inicial (8 dígitos)', () => {
      expect(normalizeChileanPhone('1234 5678')).toBe('+56912345678');
    });

    it('valida un teléfono normalizado con formato E.164 chileno', () => {
      expect(isValidChileanPhone('+56912345678')).toBe(true);
    });

    it('rechaza un teléfono con largo incorrecto', () => {
      expect(isValidChileanPhone(normalizeChileanPhone('123'))).toBe(false);
      expect(isValidChileanPhone('+5691234')).toBe(false);
    });
  });

  describe('normalizeChileanPlate / isValidChileanPlate', () => {
    it('normaliza a mayúsculas y elimina símbolos', () => {
      expect(normalizeChileanPlate('bb.cd-12')).toBe('BBCD12');
    });

    it('valida el formato actual (4 letras + 2 dígitos)', () => {
      expect(isValidChileanPlate('BBCD12')).toBe(true);
    });

    it('valida el formato anterior (2 letras + 4 dígitos)', () => {
      expect(isValidChileanPlate('AB1234')).toBe(true);
    });

    it('rechaza un formato inválido', () => {
      expect(isValidChileanPlate('ABC123')).toBe(false);
      expect(isValidChileanPlate('12345')).toBe(false);
    });
  });
});
