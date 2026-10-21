import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

/**
 * Vértice de una zona (Guardián Visual y zona de detección LPR) en
 * coordenadas NORMALIZADAS al cuadro (0 a 1). Compartido por
 * `UpdateGuardianZonesDto` y `LprSettingsDto`.
 *
 * El editor del frontend no acota las coordenadas al arrastrar un vértice
 * fuera del video (puede mandar, p. ej., -0.02 o 1.05). En vez de rechazar ese
 * guardado, un número finito se recorta a [0, 1] (el borde del cuadro); un
 * valor no numérico, NaN o infinito se rechaza con 400.
 */

export const MIN_POINTS_PER_ZONE = 3;
export const MAX_POINTS_PER_ZONE = 100;

/**
 * Recorta un número finito al rango normalizado [0, 1]. Cualquier otro valor
 * pasa sin cambios para que `@IsNumber` lo rechace.
 */
export function clampNormalizedCoordinate(value: unknown): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return value;
  }
  return Math.min(1, Math.max(0, value));
}

const COORDINATE_NUMBER = { allowNaN: false, allowInfinity: false } as const;

/** Vértice de una zona, en coordenadas normalizadas al cuadro. */
export class ZonePointDto {
  @ApiProperty({
    description: 'Coordenada horizontal normalizada (0 = borde izquierdo)',
    minimum: 0,
    maximum: 1,
    example: 0.25,
  })
  @Transform(({ value }: { value: unknown }) =>
    clampNormalizedCoordinate(value),
  )
  @IsNumber(COORDINATE_NUMBER, { message: 'x debe ser un número' })
  @Min(0)
  @Max(1)
  x: number;

  @ApiProperty({
    description: 'Coordenada vertical normalizada (0 = borde superior)',
    minimum: 0,
    maximum: 1,
    example: 0.75,
  })
  @Transform(({ value }: { value: unknown }) =>
    clampNormalizedCoordinate(value),
  )
  @IsNumber(COORDINATE_NUMBER, { message: 'y debe ser un número' })
  @Min(0)
  @Max(1)
  y: number;
}
