import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsIn,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  VEHICLE_ACCESS_LEVELS,
  VEHICLE_TYPES,
  VehicleAccessLevel,
  VehicleType,
} from '../vehicle-access';

/**
 * `''` (el "Seleccionar" de un `<select>`) se trata como "sin valor":
 * `null`, que `@IsOptional` acepta y que en una edición limpia el campo.
 */
function emptyToNull({ value }: { value: unknown }): unknown {
  return value === '' ? null : value;
}

function toUpperCase({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

/** `ownerId` vacío o `null` = sin cambio de propietario (`undefined`). */
function emptyToUndefined({ value }: { value: unknown }): unknown {
  return value === '' || value === null ? undefined : value;
}

export class CreateVehicleDto {
  @ApiProperty({ description: 'Patente del vehículo', example: 'ABC123' })
  @IsString()
  @Transform(toUpperCase)
  plate: string;

  @ApiPropertyOptional({ description: 'Marca del vehículo', example: 'Toyota' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({
    description: 'Modelo del vehículo',
    example: 'Corolla',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: 'ID del usuario propietario (miembro activo del condominio)',
    example: 'user-uuid-123',
  })
  @IsOptional()
  @IsString()
  @Transform(emptyToUndefined)
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Color del vehículo', example: 'Rojo' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ description: 'Año del vehículo', example: 2020 })
  @IsOptional()
  @IsNumber()
  @Min(1900)
  @Max(new Date().getFullYear() + 1)
  year?: number;

  // Fase 4 · P5.C (modelo corregido, ver vehicle-access.ts): carrocería,
  // solo descriptiva. Cualquier otro valor → 400.
  @ApiPropertyOptional({
    description: 'Carrocería del vehículo (descriptiva, no decide el portón)',
    enum: VehicleType,
    example: VehicleType.CAR,
    nullable: true,
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsIn(VEHICLE_TYPES, {
    message: `vehicleType debe ser uno de: ${VEHICLE_TYPES.join(', ')}`,
  })
  vehicleType?: VehicleType | null;

  // Lo único que decide el portón: residente → abre; visitante → exige una
  // visita válida; servicio o null → escala al conserje.
  @ApiPropertyOptional({
    description:
      'Nivel de acceso para el portón: residente (abre), visitante (exige visita válida), servicio o null (escala al conserje)',
    enum: VehicleAccessLevel,
    example: VehicleAccessLevel.RESIDENT,
    nullable: true,
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsIn(VEHICLE_ACCESS_LEVELS, {
    message: `accessLevel debe ser uno de: ${VEHICLE_ACCESS_LEVELS.join(', ')}`,
  })
  accessLevel?: VehicleAccessLevel | null;

  @ApiPropertyOptional({
    description: 'Estado del vehículo Activo/Inactivo',
    example: 'true',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // Fase 4 · P5.C (creación estricta): solo el super-admin lo envía (y es
  // obligatorio para él); cualquier otro actor que lo envíe → 403. En la
  // edición se ignora (un vehículo no cambia de condominio).
  @ApiPropertyOptional({
    description:
      'Condominio del vehículo. Solo super-admin (obligatorio para él); otro actor → 403',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
