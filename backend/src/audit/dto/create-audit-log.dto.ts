import {
  IsEnum,
  IsOptional,
  IsString,
  IsObject,
  IsUUID,
} from 'class-validator';
import { AuditAction, AuditModule } from '../entities/audit-log.entity';

export class CreateAuditLogDto {
  @IsEnum(AuditModule)
  module: AuditModule;

  @IsEnum(AuditAction)
  action: AuditAction;

  @IsOptional()
  @IsString()
  userId?: string;

  /** Condominio del evento (P5); `null`/ausente = sin condominio (solo super-admin lo lee). */
  @IsOptional()
  @IsUUID('all')
  organizationId?: string | null;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsObject()
  oldValue?: any;

  @IsOptional()
  @IsObject()
  newValue?: any;

  @IsOptional()
  @IsObject()
  metadata?: {
    ip?: string;
    userAgent?: string;
    requestId?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number;
    duration?: number;
  };

  @IsOptional()
  @IsString()
  description?: string;
}
