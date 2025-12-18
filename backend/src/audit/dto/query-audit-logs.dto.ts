import { IsOptional, IsEnum, IsDateString, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction, AuditModule } from '../entities/audit-log.entity';

export class QueryAuditLogsDto {
  @IsOptional()
  @IsEnum(AuditModule)
  module?: AuditModule;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  search?: string; // Búsqueda en descripción

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number = 20;
}
