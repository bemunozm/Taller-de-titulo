import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  clampNormalizedCoordinate,
  GuardianZoneConfigDto,
  GuardianZonePointDto,
  MAX_GUARDIAN_ZONES,
  MAX_POINTS_PER_ZONE,
  UpdateGuardianZonesDto,
} from './update-guardian-zones.dto';

/**
 * Fase 4 · P9 (QA MEDIO): `PATCH /cameras/:id/zones` valida la forma que
 * envía `GuardianZoneEditor` y lee el LPR. Acepta el formato LEGACY
 * (`{ zones: [[{x, y}, ...], ...] }`) y el NUEVO
 * (`{ zones: [{ points, type, loiterSeconds? }] }`) y normaliza al nuevo.
 * Coordenadas normalizadas. Mismo `ValidationPipe` que main.ts.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validate(body: unknown): Promise<UpdateGuardianZonesDto> {
  return pipe.transform(body, {
    type: 'body',
    metatype: UpdateGuardianZonesDto,
  }) as Promise<UpdateGuardianZonesDto>;
}

async function messagesFor(body: unknown): Promise<string[]> {
  try {
    await validate(body);
  } catch (error) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse() as { message: string[] };
      return response.message;
    }
    throw error;
  }
  throw new Error('se esperaba un 400');
}

function zone(points: number, offset = 0): Array<{ x: number; y: number }> {
  return Array.from({ length: points }, (_, i) => ({
    x: (i + offset) / (points + offset + 1),
    y: ((i * 7) % (points + 1)) / (points + 1),
  }));
}

const TRIANGLE = [
  { x: 0.1, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.4, y: 0.9 },
];

describe('UpdateGuardianZonesDto', () => {
  describe('acepta lo que envía el editor del frontend', () => {
    it('una zona triangular', async () => {
      const dto = await validate({ zones: [TRIANGLE] });

      expect(dto).toBeInstanceOf(UpdateGuardianZonesDto);
      expect(dto.zones).toHaveLength(1);
      expect(dto.zones[0]).toBeInstanceOf(GuardianZoneConfigDto);
      expect(dto.zones[0].points).toEqual(TRIANGLE);
      expect(dto.zones[0].points[0]).toBeInstanceOf(GuardianZonePointDto);
    });

    it('[] borra todas las zonas', async () => {
      await expect(validate({ zones: [] })).resolves.toMatchObject({
        zones: [],
      });
    });

    it('bordes del cuadro: 0 y 1', async () => {
      const square = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
      await expect(validate({ zones: [square] })).resolves.toMatchObject({
        zones: [{ points: square }],
      });
    });

    it(`límites: ${MAX_GUARDIAN_ZONES} zonas de ${MAX_POINTS_PER_ZONE} puntos`, async () => {
      const zones = Array.from({ length: MAX_GUARDIAN_ZONES }, (_, i) =>
        zone(MAX_POINTS_PER_ZONE, i),
      );

      const dto = await validate({ zones });

      expect(dto.zones).toHaveLength(MAX_GUARDIAN_ZONES);
      expect(dto.zones[0].points).toHaveLength(MAX_POINTS_PER_ZONE);
    });

    it('un vértice arrastrado fuera del video se recorta al borde (0 a 1)', async () => {
      const dto = await validate({
        zones: [
          [
            { x: -0.04, y: 0.5 },
            { x: 1.2, y: -3 },
            { x: 0.5, y: 1.0001 },
          ],
        ],
      });

      expect(dto.zones[0].points).toEqual([
        { x: 0, y: 0.5 },
        { x: 1, y: 0 },
        { x: 0.5, y: 1 },
      ]);
    });

    describe('legacy y formato nuevo', () => {
      it('una zona legacy se normaliza a { points, type: "intrusion" }', async () => {
        const dto = await validate({ zones: [TRIANGLE] });

        expect(dto.zones[0].type).toBe('intrusion');
        expect(dto.zones[0].loiterSeconds).toBeUndefined();
      });

      it('formato nuevo: type y loiterSeconds se conservan', async () => {
        const dto = await validate({
          zones: [{ points: TRIANGLE, type: 'loitering', loiterSeconds: 30 }],
        });

        expect(dto.zones[0]).toMatchObject({
          points: TRIANGLE,
          type: 'loitering',
          loiterSeconds: 30,
        });
      });

      it('mezcla legacy + nuevo en la misma lista', async () => {
        const dto = await validate({
          zones: [
            TRIANGLE,
            { points: TRIANGLE, type: 'loitering', loiterSeconds: 5 },
          ],
        });

        expect(dto.zones.map((z) => z.type)).toEqual([
          'intrusion',
          'loitering',
        ]);
      });

      it.each([5, 600])('loiterSeconds en el borde (%p)', async (seconds) => {
        const dto = await validate({
          zones: [
            { points: TRIANGLE, type: 'loitering', loiterSeconds: seconds },
          ],
        });
        expect(dto.zones[0].loiterSeconds).toBe(seconds);
      });

      it('formato nuevo también recorta vértices fuera del cuadro', async () => {
        const dto = await validate({
          zones: [
            {
              points: [
                { x: -1, y: 0.5 },
                { x: 2, y: 0.5 },
                { x: 0.5, y: 0.5 },
              ],
              type: 'intrusion',
            },
          ],
        });
        expect(dto.zones[0].points[0].x).toBe(0);
        expect(dto.zones[0].points[1].x).toBe(1);
      });
    });
  });

  describe('rechaza (400)', () => {
    it.each([
      ['sin zones', {}],
      ['zones null', { zones: null }],
      ['zones string', { zones: '[[...]]' }],
    ])('%s', async (_label, body) => {
      expect(await messagesFor(body)).toContain(
        'zones debe ser una lista de zonas',
      );
    });

    it('zones como un punto suelto (objeto): 400', async () => {
      const messages = await messagesFor({ zones: { x: 0.5, y: 0.5 } });
      expect(messages.length).toBeGreaterThan(0);
    });

    it('zones objeto con zonas adentro (Nest informa los errores anidados)', async () => {
      const messages = await messagesFor({ zones: { a: TRIANGLE } });
      expect(messages.length).toBeGreaterThan(0);
    });

    it(`más de ${MAX_GUARDIAN_ZONES} zonas`, async () => {
      const zones = Array.from({ length: MAX_GUARDIAN_ZONES + 1 }, () => [
        ...TRIANGLE,
      ]);
      expect(await messagesFor({ zones })).toContain(
        `zones admite como máximo ${MAX_GUARDIAN_ZONES} zonas`,
      );
    });

    it(`una zona con más de ${MAX_POINTS_PER_ZONE} puntos`, async () => {
      expect(
        await messagesFor({ zones: [zone(MAX_POINTS_PER_ZONE + 1)] }),
      ).toContain(
        `zones.0.cada zona admite como máximo ${MAX_POINTS_PER_ZONE} puntos`,
      );
    });

    it('una zona con menos de 3 puntos (el LPR la ignoraría)', async () => {
      expect(await messagesFor({ zones: [TRIANGLE.slice(0, 2)] })).toContain(
        'zones.0.cada zona necesita al menos 3 puntos',
      );
      expect(
        await messagesFor({
          zones: [{ points: TRIANGLE.slice(0, 2), type: 'intrusion' }],
        }),
      ).toContain('zones.0.cada zona necesita al menos 3 puntos');
    });

    it('una zona que no es lista ni objeto con points', async () => {
      const messages = await messagesFor({ zones: [{ x: 0.1, y: 0.1 }] });
      expect(messages.join(' ')).toContain('points debe ser una lista');
    });

    it('una zona que es un número', async () => {
      const messages = await messagesFor({ zones: [5] });
      expect(messages.join(' ')).toMatch(/must be either object or array/);
    });

    it('type desconocido', async () => {
      const messages = await messagesFor({
        zones: [{ points: TRIANGLE, type: 'perimetro' }],
      });
      expect(messages.join(' ')).toContain('type debe ser uno de');
    });

    it('formato nuevo sin type', async () => {
      const messages = await messagesFor({ zones: [{ points: TRIANGLE }] });
      expect(messages.join(' ')).toContain('type debe ser uno de');
    });

    it.each([4, 601, 0, -3, 10.5, '30'])(
      'loiterSeconds fuera de rango o no entero (%p)',
      async (seconds) => {
        const messages = await messagesFor({
          zones: [
            { points: TRIANGLE, type: 'loitering', loiterSeconds: seconds },
          ],
        });
        expect(messages.join(' ')).toMatch(/loiterSeconds|must not be/);
      },
    );

    it('propiedad extra en la zona nueva', async () => {
      const messages = await messagesFor({
        zones: [{ points: TRIANGLE, type: 'intrusion', color: 'rojo' }],
      });
      expect(messages.join(' ')).toMatch(/property color should not exist/);
    });

    it('un punto que no es objeto', async () => {
      const messages = await messagesFor({ zones: [[1, 2, 3]] });
      expect(messages.join(' ')).toMatch(/must be either object or array/);
    });

    it.each([
      ['string', '0.5'],
      ['null', null],
      ['booleano', true],
      ['objeto', { v: 1 }],
    ])('una coordenada %s', async (_label, value) => {
      const messages = await messagesFor({
        zones: [[{ x: value, y: 0.1 }, ...TRIANGLE.slice(1)]],
      });
      expect(messages.join(' ')).toContain('x debe ser un número');
    });

    it('una coordenada que falta', async () => {
      const messages = await messagesFor({
        zones: [[{ x: 0.1 }, ...TRIANGLE.slice(1)]],
      });
      expect(messages.join(' ')).toContain('y debe ser un número');
    });

    it('propiedades extra en un punto o en el body (forbidNonWhitelisted)', async () => {
      const inPoint = await messagesFor({
        zones: [[{ x: 0.1, y: 0.1, z: 1 }, ...TRIANGLE.slice(1)]],
      });
      expect(inPoint.join(' ')).toMatch(/property z should not exist/);

      const inBody = await messagesFor({ zones: [TRIANGLE], extra: true });
      expect(inBody.join(' ')).toMatch(/property extra should not exist/);
    });
  });
});

describe('clampNormalizedCoordinate', () => {
  it.each([
    [0.5, 0.5],
    [-1, 0],
    [2, 1],
    [0, 0],
    [1, 1],
  ])('%p -> %p', (value, expected) => {
    expect(clampNormalizedCoordinate(value)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '0.5', null, undefined])(
    '%p pasa sin cambios (lo rechaza @IsNumber)',
    (value) => {
      expect(clampNormalizedCoordinate(value)).toBe(value);
    },
  );
});
