import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  setAuthAuditSink,
  type AuthAuditAction,
  type AuthAuditEvent,
} from '../auth/auth-audit';
import { AuditService } from './audit.service';
import type { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditAction, AuditModule } from './entities/audit-log.entity';
import { OrganizationMembershipService } from '../organization-membership/organization-membership.service';

const AUDIT_ACTIONS: Record<AuthAuditAction, AuditAction> = {
  LOGIN: AuditAction.LOGIN,
  LOGIN_FAILED: AuditAction.LOGIN_FAILED,
  LOGOUT: AuditAction.LOGOUT,
};

const DESCRIPTIONS: Record<AuthAuditAction, string> = {
  LOGIN: 'Inicio de sesión',
  LOGIN_FAILED: 'Inicio de sesión fallido',
  LOGOUT: 'Cierre de sesión',
};

/**
 * Registro de auditoría de un evento de login de better-auth.
 * `organizationId`: el condominio del usuario por membresía (Fase 4 · P5);
 * `null` si no tiene (o es `LOGIN_FAILED`, que no tiene usuario).
 */
export function toAuthAuditLog(
  event: AuthAuditEvent,
  organizationId: string | null = null,
): CreateAuditLogDto {
  return {
    module: AuditModule.AUTH,
    action: AUDIT_ACTIONS[event.action],
    userId: event.userId,
    organizationId,
    entityType: 'User',
    entityId: event.userId,
    // Corrección P7 (cyber B4): email enmascarado + HMAC para correlacionar
    // intentos (`attemptedEmailFingerprint`); nunca el email en claro.
    newValue:
      event.attemptedEmail !== undefined || event.reason !== undefined
        ? {
            attemptedEmail: event.attemptedEmail,
            attemptedEmailHash: event.attemptedEmailHash,
            reason: event.reason,
          }
        : undefined,
    metadata: {
      ip: event.ip,
      userAgent: event.userAgent,
      endpoint: event.endpoint,
      method: 'POST',
    },
    description: DESCRIPTIONS[event.action],
  };
}

/**
 * Conecta la auditoría de login de better-auth (auth/auth-audit.ts) con
 * `AuditService` (Fase 4 · P4.B). better-auth vive fuera de DI, así que este
 * provider registra el sink al iniciar el módulo y lo quita al cerrarse.
 *
 * Vive en `AuditModule` (y no en `AuthModule`) porque es quien tiene
 * `AuditService`; `AuditModule` ya importa `AuthModule`, así no se agrega una
 * importación circular nueva.
 */
@Injectable()
export class AuthAuditSinkRegistrar implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly auditService: AuditService,
    private readonly membershipService: OrganizationMembershipService,
  ) {}

  onModuleInit(): void {
    setAuthAuditSink(async (event) => {
      await this.auditService.log(
        toAuthAuditLog(event, await this.organizationIdOf(event)),
      );
    });
  }

  /**
   * LOGIN/LOGOUT: el condominio del usuario por membresía, para que el
   * Administrador vea los de su condominio (P5). `LOGIN_FAILED` (sin usuario
   * resuelto) queda sin condominio: solo lo lee el super-admin.
   */
  private async organizationIdOf(
    event: AuthAuditEvent,
  ): Promise<string | null> {
    if (event.action === 'LOGIN_FAILED' || !event.userId) {
      return null;
    }
    return this.membershipService.getOrganizationIdForUser(event.userId);
  }

  onModuleDestroy(): void {
    setAuthAuditSink(null);
  }
}
