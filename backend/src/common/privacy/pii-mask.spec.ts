import {
  MAX_SCRUB_TEXT_LENGTH,
  REDACTED_VALUE,
  TRUNCATED_SUFFIX,
  maskEmail,
  maskPhone,
  maskPlate,
  maskRut,
  redactQuotedText,
  scrubPiiInText,
} from './pii-mask';

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): enmascarado de
 * datos personales para logs y registros técnicos.
 */
describe('pii-mask', () => {
  it('REDACTED_VALUE es la misma marca que usa la auditoría', () => {
    expect(REDACTED_VALUE).toBe('[REDACTED]');
  });

  describe('maskPhone: solo los últimos 4 dígitos', () => {
    it.each([
      ['+56912345678', '***5678'],
      ['+56 9 1234 5678', '***5678'],
      ['912345678', '***5678'],
      ['(2) 2345-6789', '***6789'],
    ])('%s -> %s', (phone, masked) => {
      expect(maskPhone(phone)).toBe(masked);
    });

    it.each([['1234'], [''], [null], [undefined], ['sin número']])(
      'sin más de 4 dígitos (%s) -> ***',
      (phone) => {
        expect(maskPhone(phone)).toBe('***');
      },
    );
  });

  describe('maskPlate: 2 primeros y 2 últimos caracteres', () => {
    it.each([
      ['ABCD12', 'AB**12'],
      ['AB1234', 'AB**34'],
      ['ab-cd-12', 'AB**12'],
      ['BB·CD·12', 'BB**12'],
      ['ABC12', 'AB*12'],
    ])('%s -> %s', (plate, masked) => {
      expect(maskPlate(plate)).toBe(masked);
    });

    it.each([['AB12'], [''], [null], [undefined]])(
      'demasiado corta para enmascarar (%s) -> ***',
      (plate) => {
        expect(maskPlate(plate)).toBe('***');
      },
    );
  });

  describe('maskRut: solo el dígito verificador', () => {
    it.each([
      ['12.345.678-5', '***-5'],
      ['12345678-5', '***-5'],
      ['9.876.543-k', '***-K'],
      ['98765432K', '***-K'],
    ])('%s -> %s', (rut, masked) => {
      expect(maskRut(rut)).toBe(masked);
    });

    it.each([['P1234567'], ['AB123456'], ['12'], [''], [null]])(
      'pasaporte o valor sin forma de RUT (%s) -> ***',
      (rut) => {
        expect(maskRut(rut)).toBe('***');
      },
    );
  });

  describe('maskEmail: primera letra y dominio', () => {
    it.each([
      ['ana.soto@correo.cl', 'a***@correo.cl'],
      ['  Juan@Example.COM ', 'J***@Example.COM'],
      ['x@dominio.cl', 'x***@dominio.cl'],
    ])('%s -> %s', (email, masked) => {
      expect(maskEmail(email)).toBe(masked);
    });

    it.each([['sin-arroba'], ['@dominio.cl'], ['ana@'], [''], [undefined]])(
      'sin forma de email (%s) -> ***',
      (email) => {
        expect(maskEmail(email)).toBe('***');
      },
    );
  });

  describe('scrubPiiInText', () => {
    it('enmascara emails, RUT, celulares y patentes dentro de un texto', () => {
      expect(
        scrubPiiInText(
          'Visita de ana@correo.cl (RUT 12.345.678-5, fono +56 9 1234 5678) en el auto ABCD12 y la moto AB-1234',
        ),
      ).toBe(
        'Visita de a***@correo.cl (RUT ***-5, fono ***5678) en el auto AB**12 y la moto AB**34',
      );
    });

    it('celular sin prefijo y con prefijo pegado', () => {
      expect(scrubPiiInText('llamar al 912345678 o +56987654321')).toBe(
        'llamar al ***5678 o ***4321',
      );
    });

    it('no toca ids, fechas, casas ni números largos', () => {
      const text =
        'Visita 0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01 en la casa 15 a las 2026-10-09T10:00:00Z (ts 1791498985330, casa A-303)';
      expect(scrubPiiInText(text)).toBe(text);
    });

    it('no reconoce nombres (por eso se omiten en origen)', () => {
      expect(scrubPiiInText('Juan Pérez')).toBe('Juan Pérez');
    });

    /** Corrección P7 (cyber B4): más formatos de patente y RUT. */
    it.each([
      [
        'patente en minúsculas',
        'auto bbcd12 detectado',
        'auto BB**12 detectado',
      ],
      [
        'patente con guiones',
        'auto BB-CD-12 detectado',
        'auto BB**12 detectado',
      ],
      ['patente con puntos', 'auto bb.cd.12', 'auto BB**12'],
      ['patente antigua con guiones', 'moto AB-12-34', 'moto AB**34'],
      ['RUT sin guion', 'RUT 123456785 inválido', 'RUT ***-5 inválido'],
      ['RUT con puntos sin guion', 'RUT 12.345.6785', 'RUT ***-5'],
      ['RUT con K sin guion', 'RUT 12345678K', 'RUT ***-K'],
    ])('%s', (_case, text, expected) => {
      expect(scrubPiiInText(text)).toBe(expected);
    });

    it('recorta el texto a ~2 KB antes de aplicar las regex', () => {
      const result = scrubPiiInText(
        `${'x'.repeat(MAX_SCRUB_TEXT_LENGTH)} ana@correo.cl`,
      );
      expect(result).toBe(
        `${'x'.repeat(MAX_SCRUB_TEXT_LENGTH)}${TRUNCATED_SUFFIX}`,
      );
    });
  });

  describe('redactQuotedText (corrección P7, cyber B4)', () => {
    it('omite lo citado entre comillas (p. ej. el nombre de una familia)', () => {
      expect(
        redactQuotedText(
          'La unidad 15 ya tiene asignada la familia activa "Familia Pérez". Desactívala primero.',
        ),
      ).toBe(
        'La unidad 15 ya tiene asignada la familia activa "[REDACTED]". Desactívala primero.',
      );
      expect(redactQuotedText('Familia “Soto Ríos” y "Pérez"')).toBe(
        'Familia "[REDACTED]" y "[REDACTED]"',
      );
    });

    it('también una comilla que quedó abierta y enmascara el resto', () => {
      expect(redactQuotedText('familia "Pérez de ana@correo.cl')).toBe(
        'familia "[REDACTED]"',
      );
      expect(redactQuotedText('patente ABCD12, sin comillas')).toBe(
        'patente AB**12, sin comillas',
      );
    });
  });

  /**
   * Corrección P7 (cyber A1, ReDoS): la regex de email vieja era cuadrática
   * sobre un texto largo sin `@` (200 KB ≈ 25 s con el event loop
   * bloqueado). Cada función debe terminar en < 200 ms con 1e5 y 1e6
   * caracteres, en los peores casos de cada regex.
   */
  describe('sin ReDoS: textos enormes en < 200 ms', () => {
    const LIMIT_MS = 200;

    function elapsedMs(run: () => unknown): number {
      const start = process.hrtime.bigint();
      run();
      return Number(process.hrtime.bigint() - start) / 1e6;
    }

    const worstCases: Array<[string, (size: number) => string]> = [
      ['letras sin @ (regex de email vieja)', (n) => 'a'.repeat(n)],
      ['letras y un @ al final', (n) => `${'a'.repeat(n)}@`],
      ['un @ al principio', (n) => `@${'a'.repeat(n)}`],
      ['dígitos (RUT y teléfono)', (n) => '9'.repeat(n)],
      ['mayúsculas (patentes)', (n) => 'A'.repeat(n)],
      ['puntos y letras alternados', (n) => 'a.'.repeat(n / 2)],
      ['comillas abiertas', (n) => `"${'a'.repeat(n)}`],
    ];

    describe.each([1e5, 1e6])('%d caracteres', (size) => {
      it.each(worstCases)('%s', (_case, build) => {
        const text = build(size);
        expect(elapsedMs(() => scrubPiiInText(text))).toBeLessThan(LIMIT_MS);
        expect(elapsedMs(() => redactQuotedText(text))).toBeLessThan(LIMIT_MS);
        for (const mask of [maskEmail, maskPhone, maskPlate, maskRut]) {
          expect(elapsedMs(() => mask(text))).toBeLessThan(LIMIT_MS);
        }
      });
    });
  });
});
