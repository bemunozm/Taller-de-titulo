import {
  describeInputShape,
  isSecretKey,
  MAX_SHAPE_KEYS,
  redactPersonalData,
} from './pii-redaction';

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): redacción por
 * campo de lo que se persiste como registro técnico (auditoría, auditoría de
 * tools y acciones pendientes).
 */
describe('redactPersonalData', () => {
  it('secretos: los mismos de la auditoría desde P5, en cualquier nivel', () => {
    expect(
      redactPersonalData({
        password: 'x',
        nested: [
          {
            apiKey: 'k',
            'x-api-key': 'k',
            qrCode: 'qr',
            sourceUrl: 'rtsp://u:p@h/a',
          },
        ],
      }),
    ).toEqual({
      password: '[REDACTED]',
      nested: [
        {
          apiKey: '[REDACTED]',
          'x-api-key': '[REDACTED]',
          qrCode: '[REDACTED]',
          sourceUrl: '[REDACTED]',
        },
      ],
    });
    expect(isSecretKey('hubSecret')).toBe(true);
    expect(isSecretKey('qr_code')).toBe(true);
    expect(isSecretKey('visitorName')).toBe(false);
  });

  it('compara las claves sin mayúsculas ni separadores', () => {
    expect(
      redactPersonalData({
        plate_raw: 'ABCD12',
        PLATE: 'AB1234',
        visitor_rut: '12345678-5',
        Visitor_Phone: '+56911112222',
      }),
    ).toEqual({
      plate_raw: 'AB**12',
      PLATE: 'AB**34',
      visitor_rut: '***-5',
      Visitor_Phone: '***2222',
    });
  });

  it('conserva null/undefined, fechas, booleanos e ids; corta referencias circulares', () => {
    const when = new Date('2026-10-09T10:00:00Z');
    const circular: Record<string, unknown> = {
      id: 'x',
      name: null,
      rut: undefined,
      active: true,
      when,
    };
    circular.self = circular;

    expect(redactPersonalData(circular)).toEqual({
      id: 'x',
      name: null,
      rut: undefined,
      active: true,
      when,
      self: '[Circular]',
    });
    expect(redactPersonalData('texto')).toBe('texto');
    expect(redactPersonalData(42)).toBe(42);
    expect(redactPersonalData(null)).toBeNull();
  });

  describe('name (decisión fail-closed)', () => {
    it('se redacta por defecto, también en objetos anidados', () => {
      expect(
        redactPersonalData({ name: 'Ana', owner: { id: 'u', name: 'Ana' } }),
      ).toEqual({ name: '[REDACTED]', owner: { id: 'u', name: '[REDACTED]' } });
    });

    it('se conserva en la raíz de catálogo y bajo claves de catálogo, sin heredar a los hijos', () => {
      expect(
        redactPersonalData(
          {
            name: 'Administrador',
            permissions: [{ name: 'users.read' }],
            users: [{ name: 'Ana', roles: [{ name: 'Conserje' }] }],
            organization: { name: 'Condominio San Lorenzo' },
            camera: { name: 'Portón', owner: { name: 'Ana' } },
          },
          { catalogRoot: true },
        ),
      ).toEqual({
        name: 'Administrador',
        permissions: [{ name: 'users.read' }],
        users: [{ name: '[REDACTED]', roles: [{ name: 'Conserje' }] }],
        organization: { name: 'Condominio San Lorenzo' },
        camera: { name: 'Portón', owner: { name: '[REDACTED]' } },
      });
    });
  });

  it('un campo personal que es una relación se recorre: conserva el id y omite el nombre', () => {
    expect(
      redactPersonalData({
        residente: { id: 'u-1', name: 'Ana', email: 'ana@correo.cl' },
        respondedBy: { id: 'u-2', name: 'Beto' },
      }),
    ).toEqual({
      residente: { id: 'u-1', name: '[REDACTED]', email: 'a***@correo.cl' },
      respondedBy: { id: 'u-2', name: '[REDACTED]' },
    });
  });

  it('imágenes por contenido (data URL o base64 largo) aunque la clave no lo diga', () => {
    expect(
      redactPersonalData({
        foo: 'data:image/png;base64,iVBORw0KGgo=',
        bar: 'Q'.repeat(600),
        short: 'QUJD',
      }),
    ).toEqual({ foo: '[REDACTED]', bar: '[REDACTED]', short: 'QUJD' });
  });

  describe('tools del agente (claves en español de los esquemas Zod)', () => {
    it('guardar_datos_visitante: input y saved', () => {
      expect(
        redactPersonalData({
          nombre: 'Juan Pérez',
          rut: '12.345.678-5',
          telefono: '+56 9 1234 5678',
          patente: 'ABCD12',
          motivo: 'cumpleaños de mi tía',
          casa: 'A-303',
        }),
      ).toEqual({
        nombre: '[REDACTED]',
        rut: '***-5',
        telefono: '***5678',
        patente: 'AB**12',
        motivo: '[REDACTED]',
        casa: 'A-303',
      });
    });

    it('buscar_residente (canal humano): conserva ids y conteo; omite nombres y familia', () => {
      expect(
        redactPersonalData({
          encontrado: true,
          casa: '15',
          familia: 'Familia Pérez',
          cantidad_residentes: 2,
          residentes: [
            { id: 'u-1', nombre: 'Ana' },
            { id: 'u-2', nombre: 'Beto' },
          ],
        }),
      ).toEqual({
        encontrado: true,
        casa: '15',
        familia: '[REDACTED]',
        cantidad_residentes: 2,
        residentes: [
          { id: 'u-1', nombre: '[REDACTED]' },
          { id: 'u-2', nombre: '[REDACTED]' },
        ],
      });
    });

    it('notificar_residente y consultas: listas de nombres, propietario, visitante y mensajes', () => {
      expect(
        redactPersonalData({
          residentes_notificados: ['Ana', 'Beto'],
          propietario: 'Ana',
          visitas: [{ id: 'v-1', visitante: 'Juan', patente: 'AB1234' }],
          accesos: [
            { patente: 'BCDF34', motivo: 'Salida - Juan', residente: 'Ana' },
          ],
          mensaje:
            'No se encontró ningún vehículo registrado con patente ABCD12.',
        }),
      ).toEqual({
        residentes_notificados: ['[REDACTED]', '[REDACTED]'],
        propietario: '[REDACTED]',
        visitas: [{ id: 'v-1', visitante: '[REDACTED]', patente: 'AB**34' }],
        accesos: [
          { patente: 'BC**34', motivo: '[REDACTED]', residente: '[REDACTED]' },
        ],
        mensaje:
          'No se encontró ningún vehículo registrado con patente AB**12.',
      });
    });
  });

  /** Corrección P7 (cyber B4): `description` sigue la regla de `name`. */
  it('description: se omite fuera del catálogo (familia) y se conserva en un rol', () => {
    expect(
      redactPersonalData({
        id: 'fam-1',
        description: 'Familia de Juan Pérez, casa 15',
      }),
    ).toEqual({ id: 'fam-1', description: '[REDACTED]' });
    expect(
      redactPersonalData(
        { name: 'Conserje', description: 'Atiende el acceso' },
        { catalogRoot: true },
      ),
    ).toEqual({ name: 'Conserje', description: 'Atiende el acceso' });
  });

  it('un texto largo sin clasificar se guarda recortado a ~2 KB', () => {
    const result = redactPersonalData({
      nota: 'texto libre '.repeat(1_000),
    }) as {
      nota: string;
    };
    expect(result.nota.length).toBeLessThan(2_100);
    expect(result.nota.endsWith('…[truncado]')).toBe(true);
  });

  /** Corrección P7 (cyber A1): sin regex costosas sobre valores enormes. */
  describe.each([1e5, 1e6])(
    'sin ReDoS: valores de %d caracteres en < 200 ms',
    (size) => {
      function elapsedMs(run: () => unknown): number {
        const start = process.hrtime.bigint();
        run();
        return Number(process.hrtime.bigint() - start) / 1e6;
      }

      it.each([
        ['texto sin @', 'a'.repeat(size)],
        ['base64 casi entero', `${'A'.repeat(size)}!`],
        ['data URL', `data:${'a'.repeat(size)}`],
        ['dígitos', '9'.repeat(size)],
      ])('%s, en campos de todo tipo y como clave', (_case, big) => {
        const input = {
          mensaje: big,
          nota: big,
          rut: big,
          telefono: big,
          email: big,
          patente: big,
          lista: [big, { description: big }],
          [big]: 'valor',
        };
        expect(elapsedMs(() => redactPersonalData(input))).toBeLessThan(200);
        expect(elapsedMs(() => describeInputShape(input))).toBeLessThan(200);
      });
    },
  );
});

/**
 * Corrección P7 (cyber A1): de un input rechazado (canal, permiso o Zod) se
 * audita solo la forma, nunca los valores.
 */
describe('describeInputShape', () => {
  it('claves de primer nivel con tipo y largo, sin valores', () => {
    const shape = describeInputShape({
      nombre: 'Juan Pérez',
      rut: '12.345.678-5',
      edad: 41,
      activo: true,
      vacio: null,
      ids: ['a', 'b'],
      anidado: { secreto: 'x' },
    });

    expect(shape).toEqual({
      type: 'object',
      keys: {
        nombre: 'string(10)',
        rut: 'string(12)',
        edad: 'number',
        activo: 'boolean',
        vacio: 'null',
        ids: 'array(2)',
        anidado: 'object',
      },
    });
    expect(JSON.stringify(shape)).not.toMatch(/Juan|12\.345|secreto|"x"/);
  });

  it(`a lo más ${MAX_SHAPE_KEYS} claves, recortadas y enmascaradas`, () => {
    const input: Record<string, string> = {
      'ana@correo.cl': 'x',
      ['k'.repeat(500)]: 'y',
    };
    for (let i = 0; i < 30; i++) {
      input[`campo${i}`] = 'z';
    }

    const shape = describeInputShape(input);
    const keys = Object.keys(shape.keys ?? {});

    expect(keys).toHaveLength(MAX_SHAPE_KEYS);
    expect(shape.omittedKeys).toBe(32 - MAX_SHAPE_KEYS);
    expect(keys).toContain('a***@correo.cl');
    expect(keys.every((key) => key.length < 100)).toBe(true);
  });

  it.each([
    ['un string', 'a'.repeat(50), 'string(50)'],
    ['un array', [1, 2, 3], 'array(3)'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
  ])('%s -> solo su tipo', (_case, value, type) => {
    expect(describeInputShape(value)).toEqual({ type });
  });
});
