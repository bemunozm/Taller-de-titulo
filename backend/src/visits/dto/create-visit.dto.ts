import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitType } from '../entities/visit.entity';

/**
 * Sin `status` (Fase 4 · P3, D3): el estado inicial lo decide el servidor
 * (`PENDING` para HTTP; `AWAITING_APPROVAL` solo desde el conserje digital,
 * vía la opción interna `initialStatus` de `VisitsService.create`). El
 * `ValidationPipe` global (`forbidNonWhitelisted`) rechaza un `status` en el
 * body.
 */
export class CreateVisitDto {
  @ApiProperty({
    description: 'Tipo de visita',
    enum: VisitType,
    example: VisitType.VEHICULAR,
  })
  @IsEnum(VisitType)
  type: VisitType;

  // Fase 4 · P6.M: mismo tope que `UpdateVisitDto` y que la columna
  // (`varchar(128)`). Antes un nombre más largo llegaba a la BD (500) y era
  // texto libre ilimitado en el contexto del conserje de voz.
  @ApiProperty({
    description: 'Nombre del visitante',
    example: 'Juan Pérez',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  visitorName: string;

  @ApiPropertyOptional({
    description: 'RUT del visitante',
    example: '12345678-9',
  })
  @IsOptional()
  @IsString()
  visitorRut?: string;

  @ApiPropertyOptional({
    description: 'Teléfono del visitante',
    example: '+56912345678',
  })
  @IsOptional()
  @IsString()
  visitorPhone?: string;

  @ApiPropertyOptional({
    description: 'Motivo de la visita',
    example: 'Reunión familiar',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({
    description: 'Fecha y hora desde la cual es válida la visita (ISO 8601)',
    example: '2025-11-04T10:00:00Z',
  })
  @IsDateString()
  validFrom: string;

  @ApiProperty({
    description: 'Fecha y hora hasta la cual es válida la visita (ISO 8601)',
    example: '2025-11-04T22:00:00Z',
  })
  @IsDateString()
  validUntil: string;

  @ApiPropertyOptional({
    description:
      'Cantidad máxima de usos (check-ins) permitidos. null = ilimitado',
    example: 5,
    nullable: true,
  })
  @IsOptional()
  maxUses?: number | null;

  @ApiProperty({
    description:
      'ID del usuario anfitrión (residente que autoriza). La familia se asignará automáticamente desde la familia del anfitrión.',
    example: 'uuid-del-usuario',
  })
  @IsUUID()
  hostId: string;

  // Para visitas vehiculares
  @ApiPropertyOptional({
    description: 'Patente del vehículo (requerido para visitas vehiculares)',
    example: 'ABC123',
  })
  @ValidateIf((o: CreateVisitDto) => o.type === VisitType.VEHICULAR)
  @IsString()
  vehiclePlate?: string;

  @ApiPropertyOptional({
    description: 'Marca del vehículo',
    example: 'Toyota',
  })
  @IsOptional()
  @IsString()
  vehicleBrand?: string;

  @ApiPropertyOptional({
    description: 'Modelo del vehículo',
    example: 'Corolla',
  })
  @IsOptional()
  @IsString()
  vehicleModel?: string;

  @ApiPropertyOptional({
    description: 'Color del vehículo',
    example: 'Blanco',
  })
  @IsOptional()
  @IsString()
  vehicleColor?: string;
}
