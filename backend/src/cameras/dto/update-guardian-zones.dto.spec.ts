import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  clampNormalizedCoordinate,
  GuardianZonePointDto,
  MAX_GUARDIAN_ZONES,
  MAX_POINTS_PER_ZONE,
  UpdateGuardianZonesDto,
} from './update-guardian-zones.dto';

/**
 * Fase 4 · P9 (QA MEDIO): `PATCH /cameras/:id/zones` valida la forma que
 * envía `GuardianZoneEditor` y lee el LPR: `{ zones: [[{x, y}, ...], ...] }`,
 * coordenadas normalizadas. Mismo `ValidationPipe` que main.ts.
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
      expect(dto.zones).toEqual([TRIANGLE]);
      expect(dto.zones[0][0]).toBeInstanceOf(GuardianZonePointDto);
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
        zones: [square],
      });
    });

    it(`límites: ${MAX_GUARDIAN_ZONES} zonas de ${MAX_POINTS_PER_ZONE} puntos`, async () => {
      const zones = Array.from({ length: MAX_GUARDIAN_ZONES }, (_, i) =>
        zone(MAX_POINTS_PER_ZONE, i),
      );

      const dto = await validate({ zones });

      expect(dto.zones).toHaveLength(MAX_GUARDIAN_ZONES);
      expect(dto.zones[0]).toHaveLength(MAX_POINTS_PER_ZONE);
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

      expect(dto.zones[0]).toEqual([
        { x: 0, y: 0.5 },
        { x: 1, y: 0 },
        { x: 0.5, y: 1 },
      ]);
    });
  });

  describe('rechaza (400)', () => {
    it.each([
      ['sin zones', {}],
      ['zones null', { zones: null }],
      ['zones string', { zones: '[[...]]' }],
      ['zones como un punto suelto', { zones: { x: 0.5, y: 0.5 } }],
    ])('%s', async (_label, body) => {
      expect(await messagesFor(body)).toContain(
        'zones debe ser una lista de zonas',
      );
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
      ).toContain(`cada zona admite como máximo ${MAX_POINTS_PER_ZONE} puntos`);
    });

    it('una zona con menos de 3 puntos (el LPR la ignoraría)', async () => {
      expect(await messagesFor({ zones: [TRIANGLE.slice(0, 2)] })).toContain(
        'cada zona necesita al menos 3 puntos',
      );
    });

    it('una zona que no es lista', async () => {
      expect(await messagesFor({ zones: [{ x: 0.1, y: 0.1 }] })).toContain(
        'cada zona debe ser una lista de puntos',
      );
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
