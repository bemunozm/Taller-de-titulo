import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditModule } from '../entities/audit-log.entity';

export interface AuditableOptions {
  module: AuditModule;
  action: AuditAction;
  entityType?: string;
  description?: string;
  captureRequest?: boolean;
  captureResponse?: boolean;
  captureOldValue?: boolean; // Para capturar el estado anterior en UPDATE/DELETE
}

export const AUDITABLE_KEY = 'auditable';
export const Auditable = (options: AuditableOptions) => SetMetadata(AUDITABLE_KEY, options);
