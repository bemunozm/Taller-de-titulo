import { IsOptional, IsInt, Min, Max, IsIn, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardQueryDto {
  @ApiPropertyOptional({
    description: 'Período de tiempo para las estadísticas',
    enum: ['today', 'week', 'month', 'custom'],
    default: 'today',
  })
  @IsOptional()
  @IsIn(['today', 'week', 'month', 'custom'])
  period?: string = 'today';

  @ApiPropertyOptional({
    description: 'Fecha de inicio (para período custom)',
    example: '2025-11-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Fecha de fin (para período custom)',
    example: '2025-12-01',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class VisitsTrendQueryDto {
  @ApiPropertyOptional({
    description: 'Número de días para la tendencia',
    default: 7,
    minimum: 1,
    maximum: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number = 7;
}

export class RecentActivityQueryDto {
  @ApiPropertyOptional({
    description: 'Límite de items a retornar',
    default: 10,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Filtrar por tipo de actividad',
    enum: ['detection', 'visit', 'audit', 'error', 'notification'],
  })
  @IsOptional()
  @IsIn(['detection', 'visit', 'audit', 'error', 'notification'])
  type?: string;
}

export class DetectionsQueryDto {
  @ApiPropertyOptional({
    description: 'Límite de detecciones a retornar',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Solo mostrar detecciones con match',
    default: false,
  })
  @IsOptional()
  matchedOnly?: boolean = false;
}
