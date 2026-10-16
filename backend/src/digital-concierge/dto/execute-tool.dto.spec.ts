import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ExecuteToolDto,
  isWithinJsonLimits,
  MAX_TOOL_PARAMETERS_BYTES,
  MAX_TOOL_PARAMETERS_DEPTH,
} from './execute-tool.dto';

/**
 * Corrección P7 (cyber A1): `parameters` de `execute-tool` acotado a 8 KB
 * serializado y 4 niveles (el body admite 10 MB por las imágenes del LPR).
 */
describe('ExecuteToolDto — tope de parameters (corrección P7)', () => {
  async function errorsFor(parameters: unknown): Promise<string[]> {
    const dto = plainToInstance(ExecuteToolDto, {
      toolName: 'guardar_datos_visitante',
      parameters,
    });
    const errors = await validate(dto);
    return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
  }

  function nested(depth: number): Record<string, unknown> {
    let node: Record<string, unknown> = { hoja: 'x' };
    for (let level = 1; level < depth; level++) {
      node = { nivel: node };
    }
    return node;
  }

  it('acepta los inputs reales de las tools', async () => {
    await expect(
      errorsFor({
        nombre: 'Juan Pérez',
        rut: '12.345.678-5',
        telefono: '+56912345678',
        patente: 'ABCD12',
        motivo: 'Visita familiar',
        casa: 'A-303',
      }),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ residentes_ids: ['user-1', 'user-2'] }),
    ).resolves.toEqual([]);
    await expect(errorsFor({})).resolves.toEqual([]);
  });

  it(`rechaza más de ${MAX_TOOL_PARAMETERS_BYTES} bytes serializados`, async () => {
    await expect(
      errorsFor({ nombre: 'a'.repeat(MAX_TOOL_PARAMETERS_BYTES) }),
    ).resolves.toContain('isBoundedToolParameters');
    // Multibyte: cuenta bytes UTF-8, no caracteres.
    await expect(
      errorsFor({ nombre: 'ñ'.repeat(MAX_TOOL_PARAMETERS_BYTES / 2) }),
    ).resolves.toContain('isBoundedToolParameters');
  });

  it(`rechaza más de ${MAX_TOOL_PARAMETERS_DEPTH} niveles`, async () => {
    await expect(errorsFor(nested(MAX_TOOL_PARAMETERS_DEPTH))).resolves.toEqual(
      [],
    );
    await expect(
      errorsFor(nested(MAX_TOOL_PARAMETERS_DEPTH + 1)),
    ).resolves.toContain('isBoundedToolParameters');
  });

  it('rechaza un toolName de más de 64 caracteres', async () => {
    const dto = plainToInstance(ExecuteToolDto, {
      toolName: 't'.repeat(65),
      parameters: {},
    });
    const [error] = await validate(dto);
    expect(error?.property).toBe('toolName');
  });

  describe.each([1e5, 1e6])('parameters de %d elementos: < 200 ms', (size) => {
    function elapsedMs(run: () => unknown): number {
      const start = process.hrtime.bigint();
      run();
      return Number(process.hrtime.bigint() - start) / 1e6;
    }

    // Un objeto de 1e6 claves no llega: su JSON pesa ~17 MB y el body parser
    // lo corta en 10 MB (413). Además V8 enumera todas las claves de un
    // objeto así antes del primer `for...in` (lineal, ~160 ms con 1e6), así
    // que la cota de 200 ms se mide con 1e5 claves (lo que cabe en el body).
    const cases: Array<[string, () => unknown]> = [
      ['un string enorme', () => ({ nombre: 'a'.repeat(size) })],
      ['un array enorme', () => ({ ids: new Array<string>(size).fill('a') })],
      [
        'muchas claves',
        () =>
          Object.fromEntries(
            Array.from({ length: Math.min(size, 1e5) }, (_, i) => [`k${i}`, i]),
          ),
      ],
    ];

    it.each(cases)('%s se rechaza sin recorrerlo entero', (_case, build) => {
      const value = build();
      let result = true;
      const elapsed = elapsedMs(() => {
        result = isWithinJsonLimits(
          value,
          MAX_TOOL_PARAMETERS_BYTES,
          MAX_TOOL_PARAMETERS_DEPTH,
        );
      });
      expect(result).toBe(false);
      expect(elapsed).toBeLessThan(200);
    });
  });
});
