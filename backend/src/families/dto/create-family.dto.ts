import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFamilyDto {
  @ApiProperty({
    description: 'Nombre de la familia',
    example: 'Familia Pérez',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Descripción de la familia',
    example: 'Familia que vive en el departamento 101',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'ID de la unidad asignada a esta familia',
    example: 'uuid-de-unidad',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({
    description: 'Estado de la familia (activa/inactiva)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // Fase 4 · P5.C (creación estricta): solo el super-admin lo envía (y es
  // obligatorio para él); cualquier otro actor que lo envíe → 403. La edición
  // lo ignora (una familia no cambia de condominio).
  @ApiPropertyOptional({
    description:
      'Condominio de la familia. Solo super-admin (obligatorio para él); otro actor → 403',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
