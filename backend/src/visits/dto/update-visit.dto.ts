import { IsOptional, IsEnum, IsDateString, IsString, IsUUID, IsInt, Min, Max, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { VisitStatus, VisitType } from '../entities/visit.entity';

export class UpdateVisitDto {
  @ApiPropertyOptional({ 
    description: 'Tipo de visita', 
    enum: VisitType,
    example: 'pedestrian'
  })
  @IsOptional()
  @IsEnum(VisitType)
  type?: VisitType;

  @ApiPropertyOptional({ 
    description: 'Nombre completo del visitante', 
    example: 'Juan Pérez González',
    maxLength: 128
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  visitorName?: string;

  @ApiPropertyOptional({ 
    description: 'RUT o pasaporte del visitante', 
    example: '12.345.678-9',
    maxLength: 32
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  visitorRut?: string;

  @ApiPropertyOptional({ 
    description: 'Teléfono del visitante', 
    example: '+56912345678',
    maxLength: 15
  })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  visitorPhone?: string;

  @ApiPropertyOptional({ 
    description: 'Motivo o razón de la visita', 
    example: 'Reunión familiar',
    maxLength: 256
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;

  @ApiPropertyOptional({ 
    description: 'Fecha y hora desde cuando la visita es válida', 
    example: '2025-11-27T15:00:00Z' 
  })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ 
    description: 'Fecha y hora hasta cuando la visita es válida', 
    example: '2025-11-27T20:00:00Z' 
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ 
    description: 'ID del usuario anfitrión (residente). La familia se actualizará automáticamente desde la familia del nuevo anfitrión.', 
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsOptional()
  @IsUUID()
  hostId?: string;

  @ApiPropertyOptional({ 
    description: 'Cantidad máxima de usos permitidos (null = ilimitado)', 
    example: 5,
    minimum: 1,
    maximum: 1000
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @ApiPropertyOptional({ 
    description: 'Patente del vehículo (para visitas vehiculares)', 
    example: 'ABC123',
    maxLength: 16
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  vehiclePlate?: string;

  @ApiPropertyOptional({ 
    description: 'Marca del vehículo', 
    example: 'Toyota',
    maxLength: 128
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  vehicleBrand?: string;

  @ApiPropertyOptional({ 
    description: 'Modelo del vehículo', 
    example: 'Corolla',
    maxLength: 64
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vehicleModel?: string;

  @ApiPropertyOptional({ 
    description: 'Color del vehículo', 
    example: 'Blanco',
    maxLength: 32
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  vehicleColor?: string;

  @ApiPropertyOptional({ 
    description: 'Estado de la visita', 
    enum: VisitStatus 
  })
  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @ApiPropertyOptional({ 
    description: 'Fecha y hora de entrada real', 
    example: '2025-11-04T10:30:00Z' 
  })
  @IsOptional()
  @IsDateString()
  entryTime?: string;

  @ApiPropertyOptional({ 
    description: 'Fecha y hora de salida real', 
    example: '2025-11-04T20:30:00Z' 
  })
  @IsOptional()
  @IsDateString()
  exitTime?: string;
}
