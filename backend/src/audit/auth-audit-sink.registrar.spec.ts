import {
  attemptedEmailFingerprint,
  auditAuthEndpointResult,
  auditSessionCreated,
  setAuthAuditSink,
} from '../auth/auth-audit';
import type { AuditService } from './audit.service';
import type { OrganizationMembershipService } from '../organization-membership/organization-membership.service';
import {
  AuthAuditSinkRegistrar,
  toAuthAuditLog,
} from './auth-audit-sink.registrar';
import type { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditAction, AuditModule } from './entities/audit-log.entity';

/**
 * Fase 4 · P4.B: el provider conecta la auditoría de login de better-auth
 * (fuera de DI) con `AuditService.log`.
 */
describe('AuthAuditSinkRegistrar', () => {
  const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
  let auditService: { log: jest.Mock };
  let membership: {
    getOrganizationIdForUser: jest.Mock<Promise<string | null>, [string]>;
  };
  let registrar: AuthAuditSinkRegistrar;

  beforeEach(() => {
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    membership = {
      getOrganizationIdForUser: jest
        .fn<Promise<string | null>, [string]>()
        .mockResolvedValue(ORG_A),
    };
    registrar = new AuthAuditSinkRegistrar(
      auditService as unknown as AuditService,
      membership as unknown as OrganizationMembershipService,
    );
    registrar.onModuleInit();
  });

  afterEach(() => {
    registrar.onModuleDestroy();
    setAuthAuditSink(null);
  });

  function loggedEntries(): CreateAuditLogDto[] {
    return (auditService.log.mock.calls as CreateAuditLogDto[][]).map(
      ([entry]) => entry,
    );
  }

  it('al iniciar registra el sink: un LOGIN llega a AuditService.log', async () => {
    await auditSessionCreated(
      { userId: 'user-1', ipAddress: '203.0.113.5', userAgent: 'Mozilla/5.0' },
      { path: '/sign-in/email' },
    );

    expect(loggedEntries()).toEqual([
      {
        module: AuditModule.AUTH,
        action: AuditAction.LOGIN,
        userId: 'user-1',
        // Fase 4 · P5.A: el condominio del usuario por membresía.
        organizationId: ORG_A,
        entityType: 'User',
        entityId: 'user-1',
        newValue: undefined,
        metadata: {
          ip: '203.0.113.5',
          userAgent: 'Mozilla/5.0',
          endpoint: '/api/auth/sign-in/email',
          method: 'POST',
        },
        description: 'Inicio de sesión',
      },
    ]);
  });

  it('LOGIN_FAILED guarda el email intentado y el motivo, nunca la contraseña', async () => {
    await auditAuthEndpointResult({
      path: '/sign-in/email',
      body: { email: 'Ana@Example.com', password: 'Sup3r-Secreta!' },
      returned: Object.assign(new Error('x'), {
        body: { code: 'INVALID_EMAIL_OR_PASSWORD' },
      }),
      failed: true,
    });

    const [entry] = loggedEntries();
    expect(entry).toEqual(
      expect.objectContaining({
        action: AuditAction.LOGIN_FAILED,
        userId: undefined,
        // Sin condominio: solo lo lee el super-admin.
        organizationId: null,
        // Corrección P7 (cyber B4): enmascarado + HMAC, nunca en claro.
        newValue: {
          attemptedEmail: 'a***@example.com',
          attemptedEmailHash: attemptedEmailFingerprint('ana@example.com'),
          reason: 'INVALID_EMAIL_OR_PASSWORD',
        },
      }),
    );
    expect(JSON.stringify(entry)).not.toContain('Sup3r-Secreta!');
    expect(JSON.stringify(entry)).not.toMatch(/ana@example/i);
  });

  it('LOGIN_FAILED no consulta membresías', async () => {
    await auditAuthEndpointResult({
      path: '/sign-in/email',
      body: { email: 'ana@example.com' },
      returned: Object.assign(new Error('x'), {
        body: { code: 'INVALID_EMAIL_OR_PASSWORD' },
      }),
      failed: true,
    });

    expect(membership.getOrganizationIdForUser).not.toHaveBeenCalled();
  });

  it('LOGIN de un usuario sin membresía (p. ej. super-admin): organizationId null', async () => {
    membership.getOrganizationIdForUser.mockResolvedValue(null);

    await auditSessionCreated({ userId: 'root' }, { path: '/sign-in/email' });

    expect(loggedEntries()[0]).toEqual(
      expect.objectContaining({ userId: 'root', organizationId: null }),
    );
  });

  it('si AuditService.log falla, el flujo de auth no se entera', async () => {
    auditService.log.mockRejectedValue(new Error('BD caída'));

    await expect(
      auditSessionCreated({ userId: 'user-1' }, { path: '/sign-in/email' }),
    ).resolves.toBeUndefined();
  });

  it('al destruir el módulo quita el sink', async () => {
    registrar.onModuleDestroy();

    await auditSessionCreated({ userId: 'user-1' }, { path: '/sign-in/email' });

    expect(auditService.log).not.toHaveBeenCalled();
  });

  it.each([
    ['LOGIN', AuditAction.LOGIN],
    ['LOGIN_FAILED', AuditAction.LOGIN_FAILED],
    ['LOGOUT', AuditAction.LOGOUT],
  ] as const)(
    'toAuthAuditLog mapea %s a AuditAction.%s',
    (action, expected) => {
      expect(toAuthAuditLog({ action }).action).toBe(expected);
    },
  );
});
