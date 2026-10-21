import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVisitDto } from './create-visit.dto';
import { VisitType } from '../entities/visit.entity';

const HOST_ID = '11111111-1111-4111-8111-111111111111';

async function visitorNameErrors(visitorName: unknown): Promise<string[]> {
  const dto = plainToInstance(CreateVisitDto, {
    type: VisitType.PEDESTRIAN,
    visitorName,
    validFrom: '2026-10-09T10:00:00Z',
    validUntil: '2026-10-09T22:00:00Z',
    hostId: HOST_ID,
  });
  const errors = await validate(dto);
  return errors
    .filter((error) => error.property === 'visitorName')
    .flatMap((error) => Object.keys(error.constraints ?? {}));
}

/**
 * Fase 4 · P6.M: `visitorName` con el mismo tope que `UpdateVisitDto` y que
 * la columna (128). El nombre termina, saneado, en el contexto del conserje de
 * voz.
 */
describe('CreateVisitDto.visitorName', () => {
  it('acepta 128 caracteres (con tildes y ñ)', async () => {
    await expect(visitorNameErrors('Ñ'.repeat(128))).resolves.toEqual([]);
    await expect(visitorNameErrors('José Peña Núñez')).resolves.toEqual([]);
  });

  it('rechaza más de 128 caracteres', async () => {
    await expect(visitorNameErrors('a'.repeat(129))).resolves.toContain(
      'maxLength',
    );
  });

  it('sigue exigiendo un string', async () => {
    await expect(visitorNameErrors(42)).resolves.toContain('isString');
  });
});
