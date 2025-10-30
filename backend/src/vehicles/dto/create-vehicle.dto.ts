import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVehicleDto {
  @ApiProperty({ description: 'Patente del vehículo', example: 'ABC123' })
  @IsString()
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
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Color del vehículo', example: 'Rojo' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ description: 'Año del vehículo', example: 2020 })
  @IsOptional()
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
