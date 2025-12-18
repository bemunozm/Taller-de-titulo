import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFamilyDto {
  @ApiProperty({ description: 'Nombre de la familia', example: 'Familia Pérez' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Descripción de la familia', example: 'Familia que vive en el departamento 101' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'ID de la unidad asignada a esta familia', example: 'uuid-de-unidad' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ description: 'Estado de la familia (activa/inactiva)', example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}