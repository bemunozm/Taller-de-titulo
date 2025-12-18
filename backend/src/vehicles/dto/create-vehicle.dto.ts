import { IsString, IsOptional, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateVehicleDto {
  @ApiProperty({ description: 'Patente del vehículo', example: 'ABC123' })
  @IsString()
  @Transform(({ value }) => value?.toUpperCase())
  plate: string;

  @ApiPropertyOptional({ description: 'Marca del vehículo', example: 'Toyota' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ description: 'Modelo del vehículo', example: 'Corolla' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'ID del usuario propietario', example: 'user-uuid-123' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value === '' || value === null ? undefined : value)
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

  @ApiPropertyOptional({ description: 'Tipo de vehículo: auto, moto, camión, etc.', example: 'auto' })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @ApiPropertyOptional({ description: 'Nivel de acceso', example: 'residente, visitante, etc.' })
  @IsOptional()
  @IsString()
  accessLevel?: string;

  @ApiPropertyOptional({ description: 'Estado del vehículo Activo/Inactivo', example: 'true' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
