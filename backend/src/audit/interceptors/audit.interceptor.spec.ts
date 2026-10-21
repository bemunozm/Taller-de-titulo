import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
// Fase 4 · P7.L: la redacción de secretos vive junto a la de datos personales.
import { redactPersonalData as redactSensitiveData } from '../../common/privacy/pii-redaction';
import type { AuditService } from '../audit.service';
import type { AuditableOptions } from '../decorators/auditable.decorator';
import { AuditAction, AuditModule } from '../entities/audit-log.entity';
import type { OrganizationMembershipService } from '../../organization-membership/organization-membership.service';
import type { TenantContext } from '../../common/tenant/tenant-context.types';

const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const ORG_B = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0b02';

const CONFIG: AuditableOptions = {
  module: AuditModule.USERS,
  action: AuditAction.UPDATE,
  entityType: 'User',
  description: 'Usuario actualizado',
};

interface FakeRequest {
  user?: { id: string };
  tenantContext?: TenantContext;
  params: { id?: string };
  headers: Record<string, string>;
  url: string;
  method: string;
}

/**
 * Fase 4 · P5.A: el interceptor estampa `organizationId` desde el
 * `tenantContext` de la request (o la membresía del usuario si no hay).
 */
describe('AuditInterceptor — organizationId (Fase 4 · P5.A)', () => {
  let auditService: { log: jest.Mock };
  let membership: {
    getOrganizationIdForUser: jest.Mock<Promise<string | null>, [string]>;
  };
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    membership = {
      getOrganizationIdForUser: jest
        .fn<Promise<string | null>, [string]>()
        .mockResolvedValue(ORG_B),
    };
    interceptor = new AuditInterceptor(
      { get: () => CONFIG } as unknown as Reflector,
      auditService as unknown as AuditService,
      membership as unknown as OrganizationMembershipService,
    );
  });

  function contextFor(request: FakeRequest): ExecutionContext {
    return {
      getHandler: () => () => undefined,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;
  }

  function request(overrides: Partial<FakeRequest> = {}): FakeRequest {
    return {
      user: { id: 'user-1' },
      params: { id: 'target-1' },
      headers: {},
      url: '/api/v1/users/target-1',
      method: 'PATCH',
      ...overrides,
    };
  }

  /** Corre el interceptor y espera el registro (que es best-effort, sin await). */
  async function run(
    req: FakeRequest,
    handler: CallHandler = { handle: () => of({ id: 'target-1' }) },
  ): Promise<Record<string, unknown>> {
    await lastValueFrom(interceptor.intercept(contextFor(req), handler)).catch(
      () => undefined,
    );
    for (let i = 0; i < 5 && auditService.log.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const [[entry]] = auditService.log.mock.calls as Array<
      [Record<string, unknown>]
    >;
    return entry;
  }

  it('estampa el condominio del tenantContext de la request', async () => {
    const entry = await run(
      request({
        tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
      }),
    );

    expect(entry.organizationId).toBe(ORG_A);
    expect(membership.getOrganizationIdForUser).not.toHaveBeenCalled();
  });

  it('super-admin (sin condominio): organizationId null, sin buscar membresía', async () => {
    const entry = await run(
      request({ tenantContext: { organizationId: null, isSuperAdmin: true } }),
    );

    expect(entry.organizationId).toBeNull();
    expect(membership.getOrganizationIdForUser).not.toHaveBeenCalled();
  });

  it('sin tenantContext: usa la membresía del usuario', async () => {
    const entry = await run(request());

    expect(membership.getOrganizationIdForUser).toHaveBeenCalledWith('user-1');
    expect(entry.organizationId).toBe(ORG_B);
  });

  it('sin usuario ni contexto: organizationId null', async () => {
    const entry = await run(request({ user: undefined }));

    expect(entry.organizationId).toBeNull();
  });

  it('también lo estampa en el registro de una operación fallida', async () => {
    const entry = await run(
      request({
        tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
      }),
      { handle: () => throwError(() => new Error('boom')) },
    );

    expect(entry).toEqual(
      expect.objectContaining({
        organizationId: ORG_A,
        description: 'Usuario actualizado - FAILED: boom',
      }),
    );
  });
});

/**
 * Corrección P5 (cyber B1): la redacción es RECURSIVA (todos los niveles y
 * arrays) y cubre `qrCode` además de contraseñas, tokens, secrets y API
 * keys. `POST /visits` y `PATCH /visits/:id` capturan la respuesta (con el
 * QR) y el valor anterior.
 */
describe('AuditInterceptor — redacción de datos sensibles (corrección P5)', () => {
  const VISIT_CONFIG: AuditableOptions = {
    module: AuditModule.VISITS,
    action: AuditAction.CREATE,
    entityType: 'Visit',
    description: 'Visita registrada en el sistema',
    captureResponse: true,
    captureOldValue: true,
  };
  let auditService: { log: jest.Mock };
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(
      { get: () => VISIT_CONFIG } as unknown as Reflector,
      auditService as unknown as AuditService,
      {
        getOrganizationIdForUser: jest.fn().mockResolvedValue(ORG_A),
      } as unknown as OrganizationMembershipService,
    );
  });

  async function auditOf(
    method: string,
    response: unknown,
    oldValue?: unknown,
  ): Promise<Record<string, unknown>> {
    const req = {
      user: { id: 'conserje-1' },
      tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
      params: { id: 'visit-1' },
      headers: {},
      url: '/api/v1/visits',
      method,
      oldValue,
    };
    const context = {
      getHandler: () => () => undefined,
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as unknown as ExecutionContext;
    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of(response) }),
    );
    for (let i = 0; i < 5 && auditService.log.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const [[entry]] = auditService.log.mock.calls as Array<
      [Record<string, unknown>]
    >;
    return entry;
  }

  it('POST /visits: el qrCode de la respuesta no llega a audit_logs (ni anidado)', async () => {
    const createdAt = new Date('2026-10-09T10:00:00Z');
    const entry = await auditOf('POST', {
      id: 'visit-1',
      qrCode: 'qr-secreto',
      visitorName: 'Visitante',
      createdAt,
      host: { id: 'res-1', name: 'Residente', password: 'hash' },
      history: [{ qrCode: 'qr-viejo', note: 'ok' }],
    });

    // Fase 4 · P7.L: además, los nombres de personas se omiten.
    expect(entry.newValue).toEqual({
      id: 'visit-1',
      qrCode: '[REDACTED]',
      visitorName: '[REDACTED]',
      createdAt,
      host: { id: 'res-1', name: '[REDACTED]', password: '[REDACTED]' },
      history: [{ qrCode: '[REDACTED]', note: 'ok' }],
    });
  });

  it('PATCH /visits/:id: también el valor anterior (oldValue) va redactado', async () => {
    const entry = await auditOf(
      'PATCH',
      { id: 'visit-1', qrCode: 'qr-nuevo' },
      { id: 'visit-1', qrCode: 'qr-anterior', host: { secret: 's' } },
    );

    expect(entry.newValue).toEqual({ id: 'visit-1', qrCode: '[REDACTED]' });
    expect(entry.oldValue).toEqual({
      id: 'visit-1',
      qrCode: '[REDACTED]',
      host: { secret: '[REDACTED]' },
    });
  });

  it.each([
    'password',
    'newPassword',
    'token',
    'refreshToken',
    'secret',
    'apiKey',
    'x-api-key',
    'hubSecret',
    'secretHash',
    'sourceUrl',
    'qrCode',
  ])('redacta la clave %s en cualquier nivel', (key) => {
    expect(
      redactSensitiveData({ level1: [{ level2: { [key]: 'valor' } }] }),
    ).toEqual({ level1: [{ level2: { [key]: '[REDACTED]' } }] });
  });

  it('conserva null/undefined y los valores no sensibles; corta referencias circulares', () => {
    const circular: Record<string, unknown> = { id: 'x', qrCode: null };
    circular.self = circular;

    expect(redactSensitiveData(circular)).toEqual({
      id: 'x',
      qrCode: null,
      self: '[Circular]',
    });
    expect(redactSensitiveData('texto')).toBe('texto');
    expect(redactSensitiveData(null)).toBeNull();
  });
});

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): `oldValue` y
 * `newValue` con los campos personales redactados desde la captura. El `name`
 * de una entidad de catálogo (rol, permiso, cámara) se conserva.
 */
describe('AuditInterceptor — redacción de datos personales (Fase 4 · P7.L)', () => {
  async function auditWith(
    config: AuditableOptions,
    response: unknown,
    handler?: CallHandler,
  ): Promise<Record<string, unknown>> {
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };
    const interceptor = new AuditInterceptor(
      { get: () => config } as unknown as Reflector,
      auditService as unknown as AuditService,
      {
        getOrganizationIdForUser: jest.fn().mockResolvedValue(ORG_A),
      } as unknown as OrganizationMembershipService,
    );
    const req = {
      user: { id: 'admin-1' },
      tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
      params: { id: 'entity-1' },
      headers: {},
      url: '/api/v1/x',
      method: 'POST',
    };
    const context = {
      getHandler: () => () => undefined,
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as unknown as ExecutionContext;
    await lastValueFrom(
      interceptor.intercept(context, handler ?? { handle: () => of(response) }),
    ).catch(() => undefined);
    for (let i = 0; i < 5 && auditService.log.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const [[entry]] = auditService.log.mock.calls as Array<
      [Record<string, unknown>]
    >;
    return entry;
  }

  const capture = (
    entityType: string,
    module: AuditModule = AuditModule.VISITS,
  ): AuditableOptions => ({
    module,
    action: AuditAction.CREATE,
    entityType,
    description: 'Registro',
    captureResponse: true,
  });

  it('visita: RUT, teléfono y patente enmascarados; nombres y motivo omitidos', async () => {
    const entry = await auditWith(capture('Visit'), {
      id: 'visit-1',
      visitorName: 'Juan Pérez',
      visitorRut: '12.345.678-5',
      visitorPhone: '+56912345678',
      requestedPlate: 'ABCD12',
      reason: 'Visita a mi tía María',
      host: { id: 'res-1', name: 'Ana Soto', email: 'ana.soto@correo.cl' },
      family: { id: 'fam-1', name: 'Familia Soto' },
      vehicle: { id: 'veh-1', plate: 'AB1234', brand: 'Toyota' },
    });

    expect(entry.newValue).toEqual({
      id: 'visit-1',
      visitorName: '[REDACTED]',
      visitorRut: '***-5',
      visitorPhone: '***5678',
      requestedPlate: 'AB**12',
      reason: '[REDACTED]',
      host: { id: 'res-1', name: '[REDACTED]', email: 'a***@correo.cl' },
      family: { id: 'fam-1', name: '[REDACTED]' },
      vehicle: { id: 'veh-1', plate: 'AB**34', brand: 'Toyota' },
    });
  });

  it('usuario: nombre, email, RUT, teléfono, foto y edad redactados; conserva los nombres de sus roles', async () => {
    const entry = await auditWith(capture('User', AuditModule.USERS), {
      id: 'user-1',
      name: 'Ana Soto',
      email: 'ana.soto@correo.cl',
      rut: '9.876.543-K',
      phone: '987654321',
      age: 41,
      image: 'https://res.cloudinary.com/x/ana.jpg',
      profilePicture: 'https://res.cloudinary.com/x/ana.jpg',
      roles: [
        {
          id: 'role-1',
          name: 'Residente',
          permissions: [{ id: 'p-1', name: 'visits.create' }],
        },
      ],
      family: { id: 'fam-1', name: 'Familia Soto', unit: { identifier: '15' } },
    });

    expect(entry.newValue).toEqual({
      id: 'user-1',
      name: '[REDACTED]',
      email: 'a***@correo.cl',
      rut: '***-K',
      phone: '***4321',
      age: '[REDACTED]',
      image: '[REDACTED]',
      profilePicture: '[REDACTED]',
      roles: [
        {
          id: 'role-1',
          name: 'Residente',
          permissions: [{ id: 'p-1', name: 'visits.create' }],
        },
      ],
      family: {
        id: 'fam-1',
        name: '[REDACTED]',
        unit: { identifier: '15' },
      },
    });
  });

  it.each(['Role', 'Permission', 'Camera'])(
    'entidad de catálogo (%s): conserva su name, pero no el de los usuarios que cuelgan de ella',
    async (entityType) => {
      const entry = await auditWith(capture(entityType, AuditModule.ROLES), {
        id: 'cat-1',
        name: 'Conserje',
        location: 'Portón norte',
        users: [{ id: 'user-1', name: 'Ana Soto' }],
      });

      expect(entry.newValue).toEqual({
        id: 'cat-1',
        name: 'Conserje',
        location: 'Portón norte',
        users: [{ id: 'user-1', name: '[REDACTED]' }],
      });
    },
  );

  it('familia (no es catálogo): su name y el de sus miembros se omiten', async () => {
    const entry = await auditWith(capture('Family', AuditModule.FAMILIES), {
      id: 'fam-1',
      name: 'Familia Soto',
      members: [{ id: 'user-1', name: 'Ana Soto', phone: '+56 9 1111 2222' }],
    });

    expect(entry.newValue).toEqual({
      id: 'fam-1',
      name: '[REDACTED]',
      members: [{ id: 'user-1', name: '[REDACTED]', phone: '***2222' }],
    });
  });

  it('detección: patente parcial, imágenes y texto libre omitidos', async () => {
    const entry = await auditWith(
      capture('PlateDetection', AuditModule.DETECTIONS),
      {
        id: 'det-1',
        plate: 'BCDF34',
        plate_raw: 'BCDF-34',
        full_frame_path: 'https://res.cloudinary.com/frames/x.jpg',
        meta: {
          snapshot_jpeg_b64: '/9j/4AAQSkZJRgABAQ',
          thumb: 'data:image/jpeg;base64,' + 'A'.repeat(32),
          other: 'B'.repeat(600),
        },
        accessAttempts: [
          { id: 'att-1', reason: 'Salida registrada - Juan Pérez' },
        ],
      },
    );

    expect(entry.newValue).toEqual({
      id: 'det-1',
      plate: 'BC**34',
      plate_raw: 'BC**34',
      full_frame_path: '[REDACTED]',
      meta: {
        snapshot_jpeg_b64: '[REDACTED]',
        thumb: '[REDACTED]',
        other: '[REDACTED]',
      },
      accessAttempts: [{ id: 'att-1', reason: '[REDACTED]' }],
    });
  });

  it('sesión de conserjería: transcript y functionCalls se omiten; residentsNotified conserva los ids', async () => {
    const entry = await auditWith(
      capture('ConciergeSession', AuditModule.DIGITAL_CONCIERGE),
      {
        sessionId: 's-1',
        transcript: [{ role: 'user', text: 'soy Juan' }],
        functionCalls: [{ name: 'guardar_datos_visitante' }],
        residentsNotified: [{ id: 'res-1', name: 'Ana Soto' }],
      },
    );

    expect(entry.newValue).toEqual({
      sessionId: 's-1',
      transcript: '[REDACTED]',
      functionCalls: '[REDACTED]',
      residentsNotified: [{ id: 'res-1', name: '[REDACTED]' }],
    });
  });

  it('operación fallida: la descripción no guarda la patente ni el email del mensaje de error', async () => {
    const failing: CallHandler = {
      handle: () =>
        throwError(
          () =>
            new Error(
              'Ya existe un vehículo con patente ABCD12 (dueño ana@correo.cl)',
            ),
        ),
    };
    const entry = await auditWith(
      capture('Vehicle', AuditModule.VEHICLES),
      undefined,
      failing,
    );

    expect(entry.description).toBe(
      'Registro - FAILED: Ya existe un vehículo con patente AB**12 (dueño a***@correo.cl)',
    );
  });

  /** Corrección P7 (cyber B4). */
  function failingWith(message: string): CallHandler {
    return { handle: () => throwError(() => new Error(message)) };
  }

  it('familia: el nombre citado en el mensaje de error no llega a audit_logs', async () => {
    const entry = await auditWith(
      capture('Family', AuditModule.FAMILIES),
      undefined,
      failingWith(
        'La unidad 15 ya tiene asignada la familia activa "Familia Pérez". Desactívala primero.',
      ),
    );

    expect(entry.description).toBe(
      'Registro - FAILED: La unidad 15 ya tiene asignada la familia activa "[REDACTED]". Desactívala primero.',
    );
  });

  it('catálogo: lo citado (el nombre del rol) se conserva', async () => {
    const entry = await auditWith(
      capture('Role', AuditModule.ROLES),
      undefined,
      failingWith(
        'No se puede eliminar el rol "Conserje": todavía está en uso',
      ),
    );

    expect(entry.description).toBe(
      'Registro - FAILED: No se puede eliminar el rol "Conserje": todavía está en uso',
    );
  });

  it('patente en minúsculas o con separadores y RUT sin guion también se enmascaran', async () => {
    const entry = await auditWith(
      capture('Vehicle', AuditModule.VEHICLES),
      undefined,
      failingWith('Patentes bbcd12 y BB-CD-12 del RUT 123456785'),
    );

    expect(entry.description).toBe(
      'Registro - FAILED: Patentes BB**12 y BB**12 del RUT ***-5',
    );
  });

  it('family.description se omite; la de un rol se conserva', async () => {
    const family = await auditWith(capture('Family', AuditModule.FAMILIES), {
      id: 'fam-1',
      description: 'Familia de Juan Pérez',
    });
    const role = await auditWith(capture('Role', AuditModule.ROLES), {
      id: 'role-1',
      name: 'Conserje',
      description: 'Atiende el acceso',
    });

    expect(family.newValue).toEqual({ id: 'fam-1', description: '[REDACTED]' });
    expect(role.newValue).toEqual({
      id: 'role-1',
      name: 'Conserje',
      description: 'Atiende el acceso',
    });
  });

  it('corrección P7 (cyber A1): un mensaje o una URL de 1 MB se recorta y no bloquea', async () => {
    const start = process.hrtime.bigint();
    const entry = await auditWith(
      capture('Family', AuditModule.FAMILIES),
      undefined,
      failingWith('a'.repeat(1_000_000)),
    );
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    expect(elapsedMs).toBeLessThan(200);
    expect(String(entry.description).length).toBeLessThan(2_200);
  });
});
