import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Body de `PATCH /cameras/:id/zones` (Fase 4 · P9, QA MEDIO). Antes era
 * `zones: any[]` sin validar y se guardaba tal cual en `camera.guardianZones`
 * (jsonb), que el Guardián del LPR lee como polígonos
 * (`lpr/processor/guardian_worker.py`: `p['x'] * w`, `p['y'] * h`; descarta
 * zonas de menos de 3 puntos).
 *
 * Forma (la que envía `GuardianZoneEditor` del frontend):
 *   { "zones": [ [ { "x": 0.1, "y": 0.2 }, ... ], ... ] }
 * - cada zona es un polígono de 3 a 100 puntos; hasta 20 zonas;
 * - `x` e `y` son coordenadas NORMALIZADAS al cuadro (0 a 1).
 *
 * El editor no acota las coordenadas al arrastrar un vértice fuera del video
 * (puede mandar, p. ej., -0.02 o 1.05). En vez de rechazar ese guardado, un
 * número finito se recorta a [0, 1] (el borde del cuadro); un valor no
 * numérico, NaN o infinito se rechaza con 400.
 */

export const MAX_GUARDIAN_ZONES = 20;
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
export class GuardianZonePointDto {
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

export class UpdateGuardianZonesDto {
  @ApiProperty({
    description: `Polígonos de alarma del Guardián Visual: hasta ${MAX_GUARDIAN_ZONES} zonas de ${MIN_POINTS_PER_ZONE} a ${MAX_POINTS_PER_ZONE} puntos. Reemplaza las zonas guardadas; [] las borra todas.`,
    type: 'array',
    maxItems: MAX_GUARDIAN_ZONES,
    items: {
      type: 'array',
      minItems: MIN_POINTS_PER_ZONE,
      maxItems: MAX_POINTS_PER_ZONE,
      items: {
        type: 'object',
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    example: [
      [
        { x: 0.1, y: 0.2 },
        { x: 0.6, y: 0.2 },
        { x: 0.4, y: 0.9 },
      ],
    ],
  })
  @IsArray({ message: 'zones debe ser una lista de zonas' })
  @ArrayMaxSize(MAX_GUARDIAN_ZONES, {
    message: `zones admite como máximo ${MAX_GUARDIAN_ZONES} zonas`,
  })
  @IsArray({ each: true, message: 'cada zona debe ser una lista de puntos' })
  @ArrayMinSize(MIN_POINTS_PER_ZONE, {
    each: true,
    message: `cada zona necesita al menos ${MIN_POINTS_PER_ZONE} puntos`,
  })
  @ArrayMaxSize(MAX_POINTS_PER_ZONE, {
    each: true,
    message: `cada zona admite como máximo ${MAX_POINTS_PER_ZONE} puntos`,
  })
  @ValidateNested({ each: true })
  @Type(() => GuardianZonePointDto)
  zones: GuardianZonePointDto[][];
}
