import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { UpdateLprSettingsDto } from './lpr-settings.dto';

/**
 * Contrato compartido de `Camera.lprSettings` (`contracts/lpr-settings.cases.json`,
 * en la raíz del repo): lo consumen este DTO, el zod del frontend y el worker
 * LPR. Cada caso `valid` debe aceptarse y cada `invalid` rechazarse con la
 * misma `ValidationPipe` que usa la app.
 */
interface ContractCase {
  name: string;
  settings: unknown;
  offending?: string;
}

interface Contract {
  valid: ContractCase[];
  invalid: ContractCase[];
}

function findContractFile(): string {
  let dir = __dirname;
  for (;;) {
    const candidate = join(dir, 'contracts', 'lpr-settings.cases.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('No se encontró contracts/lpr-settings.cases.json');
    }
    dir = parent;
  }
}

const contract = JSON.parse(
  readFileSync(findContractFile(), 'utf8'),
) as Contract;

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validate(body: unknown): Promise<unknown> {
  return pipe.transform(body, {
    type: 'body',
    metatype: UpdateLprSettingsDto,
  }) as Promise<unknown>;
}

describe('contrato lpr-settings.cases.json', () => {
  it('tiene casos', () => {
    expect(contract.valid.length).toBeGreaterThan(0);
    expect(contract.invalid.length).toBeGreaterThan(0);
  });

  it.each(contract.valid.map((c) => [c.name, c] as const))(
    'acepta: %s',
    async (_name, testCase) => {
      await expect(validate(testCase.settings)).resolves.toBeDefined();
    },
  );

  it.each(contract.invalid.map((c) => [c.name, c] as const))(
    'rechaza: %s',
    async (_name, testCase) => {
      await expect(validate(testCase.settings)).rejects.toThrow(
        BadRequestException,
      );
    },
  );
});
