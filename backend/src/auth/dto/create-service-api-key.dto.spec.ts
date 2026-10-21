import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DECORATORS } from '@nestjs/swagger';
import {
  CreateServiceApiKeyDto,
  DEFAULT_SERVICE_API_KEY_DURATION,
  SERVICE_API_KEY_DURATION_OPTIONS,
} from './create-service-api-key.dto';

async function durationErrors(duration: unknown): Promise<string[]> {
  const dto = plainToInstance(CreateServiceApiKeyDto, {
    name: 'LPR',
    duration,
  });
  const errors = await validate(dto);
  return errors
    .filter((error) => error.property === 'duration')
    .flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe('CreateServiceApiKeyDto', () => {
  it('rechaza duration "never": toda key expira', async () => {
    await expect(durationErrors('never')).resolves.toContain('isIn');
  });

  it.each(SERVICE_API_KEY_DURATION_OPTIONS)(
    'acepta duration %s',
    async (duration) => {
      await expect(durationErrors(duration)).resolves.toEqual([]);
    },
  );

  it.each(['0d', '730d', '', 42])('rechaza duration %p', async (duration) => {
    await expect(durationErrors(duration)).resolves.not.toEqual([]);
  });

  it('sin duration usa 365d por defecto', async () => {
    const dto = plainToInstance(CreateServiceApiKeyDto, { name: 'LPR' });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.duration).toBe(DEFAULT_SERVICE_API_KEY_DURATION);
    expect(DEFAULT_SERVICE_API_KEY_DURATION).toBe('365d');
  });

  it('la documentación OpenAPI no ofrece "never"', () => {
    const property = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES,
      CreateServiceApiKeyDto.prototype,
      'duration',
    ) as { enum?: string[] } | undefined;

    expect(property?.enum).toEqual([...SERVICE_API_KEY_DURATION_OPTIONS]);
    expect(property?.enum).not.toContain('never');
  });
});
