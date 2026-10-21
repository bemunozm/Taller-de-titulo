import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreatePlateDetectionDto } from './create-plate-detection.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validate(body: unknown): Promise<CreatePlateDetectionDto> {
  return pipe.transform(body, {
    type: 'body',
    metatype: CreatePlateDetectionDto,
  }) as Promise<CreatePlateDetectionDto>;
}

const BASE = { cameraId: 'cam-1', plate: 'ABCD12' };
const TRACK = { id: 3, reads: 5, votes: 4, winner_share: 0.8 };

describe('CreatePlateDetectionDto (meta.direction / meta.track)', () => {
  it('acepta direction y track válidos', async () => {
    const dto = await validate({
      ...BASE,
      meta: { direction: 'entry', track: TRACK },
    });

    expect(dto.meta?.direction).toBe('entry');
    expect(dto.meta?.track).toEqual(TRACK);
  });

  it.each([
    ['direction desconocida', { direction: 'left' }],
    ['track.id negativo', { track: { ...TRACK, id: -1 } }],
    ['track.id sobre 2^31-1', { track: { ...TRACK, id: 2147483648 } }],
    ['track.reads sobre 10000', { track: { ...TRACK, reads: 10001 } }],
    ['track.votes decimal', { track: { ...TRACK, votes: 1.5 } }],
    ['track.winner_share > 1', { track: { ...TRACK, winner_share: 1.1 } }],
    ['track con campo extra', { track: { ...TRACK, extra: 1 } }],
    ['track arreglo', { track: [TRACK] }],
    ['track texto', { track: 'x' }],
  ])('rechaza meta con %s', async (_name, meta) => {
    await expect(validate({ ...BASE, meta })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza meta que es un arreglo o un texto', async () => {
    await expect(validate({ ...BASE, meta: [] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(validate({ ...BASE, meta: 'x' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('plate_raw: 64 caracteres sí, 65 no (columna varchar(64))', async () => {
    await expect(
      validate({ ...BASE, plate_raw: 'A'.repeat(64) }),
    ).resolves.toBeDefined();
    await expect(
      validate({ ...BASE, plate_raw: 'A'.repeat(65) }),
    ).rejects.toThrow(BadRequestException);
  });

  it('plate: 16 caracteres sí, 17 no', async () => {
    await expect(
      validate({ ...BASE, plate: 'A'.repeat(16) }),
    ).resolves.toBeDefined();
    await expect(validate({ ...BASE, plate: 'A'.repeat(17) })).rejects.toThrow(
      BadRequestException,
    );
  });
});
