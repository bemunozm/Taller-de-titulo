import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { toStoredLprSettings, UpdateLprSettingsDto } from './lpr-settings.dto';
import { MAX_GUARDIAN_ZONES } from './update-guardian-zones.dto';

/** Mismo `ValidationPipe` que main.ts. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validate(body: unknown): Promise<UpdateLprSettingsDto> {
  return pipe.transform(body, {
    type: 'body',
    metatype: UpdateLprSettingsDto,
  }) as Promise<UpdateLprSettingsDto>;
}

async function messagesFor(body: unknown): Promise<string> {
  try {
    await validate(body);
  } catch (error) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse() as { message: string[] };
      return response.message.join(' | ');
    }
    throw error;
  }
  throw new Error('se esperaba un 400');
}

const TRIANGLE = [
  { x: 0.1, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.4, y: 0.9 },
];

const FULL = {
  action: 'register',
  direction: 'both',
  zone: [TRIANGLE],
  detectorImgsz: 1920,
  sampleFps: 8,
  crop: { minWidth: 60, maxWidth: 250, minRatio: 0.8, maxRatio: 6 },
  confirmReads: 3,
};

describe('UpdateLprSettingsDto', () => {
  describe('acepta', () => {
    it('la configuración completa de porton-hd', async () => {
      const dto = await validate(FULL);

      expect(dto).toBeInstanceOf(UpdateLprSettingsDto);
      expect(toStoredLprSettings(dto)).toEqual(FULL);
    });

    it('un subconjunto de campos', async () => {
      const dto = await validate({ action: 'access', sampleFps: 1 });

      expect(toStoredLprSettings(dto)).toEqual({
        action: 'access',
        sampleFps: 1,
      });
    });

    it('{} y se guarda como null (defaults del worker)', async () => {
      const dto = await validate({});

      expect(toStoredLprSettings(dto)).toBeNull();
    });

    it('zone [] y crop {} equivalen a no enviarlos', async () => {
      const dto = await validate({ zone: [], crop: {} });

      expect(toStoredLprSettings(dto)).toBeNull();
    });

    it('crop.maxWidth null = sin tope superior', async () => {
      const dto = await validate({ crop: { minWidth: 60, maxWidth: null } });

      expect(toStoredLprSettings(dto)).toEqual({
        crop: { minWidth: 60, maxWidth: null },
      });
    });

    it.each([640, 960, 1280, 1920])('detectorImgsz %i', async (imgsz) => {
      const dto = await validate({ detectorImgsz: imgsz });
      expect(dto.detectorImgsz).toBe(imgsz);
    });

    it('recorta un vértice fuera del cuadro a [0, 1] (como el Guardián)', async () => {
      const dto = await validate({
        zone: [
          [
            { x: -0.02, y: 0.1 },
            { x: 1.05, y: 0.1 },
            { x: 0.5, y: 0.9 },
          ],
        ],
      });

      expect(toStoredLprSettings(dto)?.zone?.[0].slice(0, 2)).toEqual([
        { x: 0, y: 0.1 },
        { x: 1, y: 0.1 },
      ]);
    });

    it('guarda los puntos como JSON plano {x, y}', async () => {
      const dto = await validate({ zone: [TRIANGLE] });

      const stored = toStoredLprSettings(dto);
      expect(Object.getPrototypeOf(stored?.zone?.[0][0])).toBe(
        Object.prototype,
      );
    });
  });

  describe('rechaza', () => {
    it.each([
      ['action', { action: 'open' }],
      ['direction', { direction: 'left' }],
      ['detectorImgsz', { detectorImgsz: 800 }],
      ['detectorImgsz como texto', { detectorImgsz: '1920' }],
      ['sampleFps 0', { sampleFps: 0 }],
      ['sampleFps 16', { sampleFps: 16 }],
      ['sampleFps NaN', { sampleFps: Number.NaN }],
      ['sampleFps texto', { sampleFps: '8' }],
      ['confirmReads 0', { confirmReads: 0 }],
      ['confirmReads 11', { confirmReads: 11 }],
      ['confirmReads decimal', { confirmReads: 2.5 }],
      ['crop.minWidth -1', { crop: { minWidth: -1 } }],
      ['crop.minWidth 2001', { crop: { minWidth: 2001 } }],
      ['crop.maxWidth 0', { crop: { maxWidth: 0 } }],
      ['crop.maxWidth 4001', { crop: { maxWidth: 4001 } }],
      ['crop.minRatio 0.05', { crop: { minRatio: 0.05 } }],
      ['crop.maxRatio 21', { crop: { maxRatio: 21 } }],
      ['crop.minWidth decimal', { crop: { minWidth: 60.5 } }],
      ['crop no objeto', { crop: 'grande' }],
    ])('%s', async (_name, body) => {
      await expect(validate(body)).rejects.toThrow(BadRequestException);
    });

    it('null en vez de ausente (salvo crop.maxWidth)', async () => {
      await expect(validate({ action: null })).rejects.toThrow(
        BadRequestException,
      );
      await expect(validate({ crop: { maxRatio: null } })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('propiedades desconocidas, en la raíz y anidadas', async () => {
      expect(await messagesFor({ action: 'register', foo: 1 })).toMatch(/foo/);
      expect(await messagesFor({ crop: { minWidth: 60, extra: 1 } })).toMatch(
        /extra/,
      );
    });

    it('crop.minWidth > crop.maxWidth', async () => {
      expect(
        await messagesFor({ crop: { minWidth: 300, maxWidth: 250 } }),
      ).toMatch(/maxWidth no puede ser menor/);
    });

    it('crop.minRatio > crop.maxRatio', async () => {
      expect(
        await messagesFor({ crop: { minRatio: 6, maxRatio: 0.8 } }),
      ).toMatch(/maxRatio no puede ser menor/);
    });

    it.each([
      [
        'minWidth sin maxWidth',
        { crop: { minWidth: 60 } },
        /maxWidth es obligatorio/,
      ],
      [
        'maxWidth sin minWidth',
        { crop: { maxWidth: 250 } },
        /minWidth es obligatorio/,
      ],
      [
        'maxWidth null sin minWidth',
        { crop: { maxWidth: null } },
        /minWidth es obligatorio/,
      ],
      [
        'minRatio sin maxRatio',
        { crop: { minRatio: 0.8 } },
        /maxRatio es obligatorio/,
      ],
      [
        'maxRatio sin minRatio',
        { crop: { maxRatio: 6 } },
        /minRatio es obligatorio/,
      ],
    ])('par incompleto del recorte: %s', async (_name, body, message) => {
      expect(await messagesFor(body)).toMatch(message);
    });

    it('confirmReads < 3 con acción de acceso (explícita o implícita)', async () => {
      expect(await messagesFor({ confirmReads: 2 })).toMatch(/al menos 3/);
      expect(await messagesFor({ action: 'access', confirmReads: 1 })).toMatch(
        /al menos 3/,
      );
    });

    it('confirmReads 1 y 2 sí con register; 3 con acceso', async () => {
      await expect(
        validate({ action: 'register', confirmReads: 1 }),
      ).resolves.toBeDefined();
      await expect(
        validate({ action: 'access', confirmReads: 3 }),
      ).resolves.toBeDefined();
    });

    it('acepta minWidth == maxWidth', async () => {
      await expect(
        validate({ crop: { minWidth: 100, maxWidth: 100 } }),
      ).resolves.toBeDefined();
    });

    it('zona con menos de 3 puntos o más de 100', async () => {
      await expect(validate({ zone: [TRIANGLE.slice(0, 2)] })).rejects.toThrow(
        BadRequestException,
      );
      const big = Array.from({ length: 101 }, () => ({ x: 0.5, y: 0.5 }));
      await expect(validate({ zone: [big] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it(`más de ${MAX_GUARDIAN_ZONES} zonas`, async () => {
      const zones = Array.from(
        { length: MAX_GUARDIAN_ZONES + 1 },
        () => TRIANGLE,
      );
      await expect(validate({ zone: zones })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('vértices no numéricos o con propiedades extra', async () => {
      await expect(
        validate({
          zone: [[{ x: 'a', y: 0 }, TRIANGLE[1], TRIANGLE[2]]],
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        validate({
          zone: [[{ x: 0.1, y: 0.1, z: 1 }, TRIANGLE[1], TRIANGLE[2]]],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('zone que no es una lista de listas', async () => {
      await expect(validate({ zone: 'portón' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(validate({ zone: [TRIANGLE[0]] })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
