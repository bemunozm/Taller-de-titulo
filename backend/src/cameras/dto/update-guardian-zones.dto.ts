import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import {
  clampNormalizedCoordinate,
  MAX_POINTS_PER_ZONE,
  MIN_POINTS_PER_ZONE,
  ZonePointDto,
} from './zone-point.dto';

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

// El vértice y sus límites viven en un archivo común (lo comparte la zona de
// detección LPR). Se reexportan con los nombres históricos.
export {
  clampNormalizedCoordinate,
  MAX_POINTS_PER_ZONE,
  MIN_POINTS_PER_ZONE,
  ZonePointDto as GuardianZonePointDto,
};

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
  @Type(() => ZonePointDto)
  zones: ZonePointDto[][];
}
