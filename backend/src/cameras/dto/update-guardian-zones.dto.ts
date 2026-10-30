import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  GUARDIAN_ZONE_TYPES,
  MAX_LOITER_SECONDS,
  MIN_LOITER_SECONDS,
  type GuardianZoneType,
} from '../guardian-zones';
import {
  clampNormalizedCoordinate,
  MAX_POINTS_PER_ZONE,
  MIN_POINTS_PER_ZONE,
  ZonePointDto,
} from './zone-point.dto';

/**
 * Body de `PATCH /cameras/:id/zones` (Fase 4 · P9, QA MEDIO). Antes era
 * `zones: any[]` sin validar y se guardaba tal cual en `camera.guardianZones`
 * (jsonb), que el Guardián del LPR lee como polígonos.
 *
 * Acepta dos formas y SIEMPRE guarda/devuelve la NUEVA:
 *   LEGACY: { "zones": [ [ { "x": 0.1, "y": 0.2 }, ... ], ... ] }
 *   NUEVA:  { "zones": [ { "points": [ {x, y}, ... ],
 *                          "type": "intrusion" | "loitering",
 *                          "loiterSeconds": 5..600 }, ... ] }
 * Una zona legacy pasa a `{ points, type: 'intrusion' }`.
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

/** Una zona del Guardián en formato nuevo. */
export class GuardianZoneConfigDto {
  @ApiProperty({
    description: `Polígono de ${MIN_POINTS_PER_ZONE} a ${MAX_POINTS_PER_ZONE} puntos normalizados (0 a 1)`,
    type: [ZonePointDto],
  })
  @IsArray({ message: 'points debe ser una lista de puntos' })
  @ArrayMinSize(MIN_POINTS_PER_ZONE, {
    message: `cada zona necesita al menos ${MIN_POINTS_PER_ZONE} puntos`,
  })
  @ArrayMaxSize(MAX_POINTS_PER_ZONE, {
    message: `cada zona admite como máximo ${MAX_POINTS_PER_ZONE} puntos`,
  })
  @ValidateNested({ each: true })
  @Type(() => ZonePointDto)
  points: ZonePointDto[];

  @ApiProperty({
    enum: GUARDIAN_ZONE_TYPES,
    description:
      'intrusion: alerta al entrar a la zona. loitering: alerta al permanecer loiterSeconds dentro.',
  })
  @IsIn(GUARDIAN_ZONE_TYPES, {
    message: `type debe ser uno de: ${GUARDIAN_ZONE_TYPES.join(', ')}`,
  })
  type: GuardianZoneType;

  @ApiPropertyOptional({
    minimum: MIN_LOITER_SECONDS,
    maximum: MAX_LOITER_SECONDS,
    description:
      'Segundos de permanencia para disparar el merodeo (solo type=loitering; el worker usa 20 si falta)',
  })
  @IsOptional()
  @IsInt({ message: 'loiterSeconds debe ser un entero' })
  @Min(MIN_LOITER_SECONDS)
  @Max(MAX_LOITER_SECONDS)
  loiterSeconds?: number;
}

/**
 * Convierte cada elemento de `zones` a `GuardianZoneConfigDto`: una zona
 * legacy (arreglo de puntos) pasa a `{ points, type: 'intrusion' }`. Se hace
 * a mano (sin `@Type`) porque `@Transform` corre DESPUÉS de la conversión
 * anidada de `@Type`, que no sabe qué hacer con un arreglo como zona.
 */
function toZoneInstances(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return (value as unknown[]).map((zone) => {
    if (typeof zone !== 'object' || zone === null) return zone;
    return plainToInstance(
      GuardianZoneConfigDto,
      Array.isArray(zone) ? { points: zone, type: 'intrusion' } : zone,
    );
  });
}

export class UpdateGuardianZonesDto {
  @ApiProperty({
    description: `Zonas del Guardián Visual: hasta ${MAX_GUARDIAN_ZONES}. Acepta el formato legacy (lista de listas de puntos) o el nuevo ({ points, type, loiterSeconds? }); se guarda siempre el nuevo. Reemplaza las zonas guardadas; [] las borra todas.`,
    type: [GuardianZoneConfigDto],
    maxItems: MAX_GUARDIAN_ZONES,
    example: [
      {
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.6, y: 0.2 },
          { x: 0.4, y: 0.9 },
        ],
        type: 'loitering',
        loiterSeconds: 30,
      },
    ],
  })
  @Transform(({ value }: { value: unknown }) => toZoneInstances(value))
  @IsArray({ message: 'zones debe ser una lista de zonas' })
  @ArrayMaxSize(MAX_GUARDIAN_ZONES, {
    message: `zones admite como máximo ${MAX_GUARDIAN_ZONES} zonas`,
  })
  @ValidateNested({ each: true })
  zones: GuardianZoneConfigDto[];
}
