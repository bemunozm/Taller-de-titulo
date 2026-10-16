import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { TenantContextService } from './tenant-context.service';
import type { TenantContext } from './tenant-context.types';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

/**
 * Fase 4 · P5.C: `resolveCreationOrganizationId`, la regla única de la
 * creación estricta de recursos del condominio (cámaras, unidades, familias,
 * vehículos).
 */
describe('TenantContextService.resolveCreationOrganizationId (P5.C)', () => {
  let query: jest.Mock;

  function serviceFor(tenantContext: TenantContext): TenantContextService {
    return new TenantContextService({ tenantContext }, {
      query,
    } as unknown as DataSource);
  }

  beforeEach(() => {
    query = jest.fn((_sql: string, params: string[]) =>
      Promise.resolve(params[0] === ORG_B ? [{ ok: 1 }] : []),
    );
  });

  it('actor con condominio: el suyo, sin consultar la BD', async () => {
    const service = serviceFor({ organizationId: ORG_A, isSuperAdmin: false });

    await expect(service.resolveCreationOrganizationId()).resolves.toBe(ORG_A);
    expect(query).not.toHaveBeenCalled();
  });

  it('actor sin condominio -> 403', async () => {
    const service = serviceFor({ organizationId: null, isSuperAdmin: false });

    await expect(service.resolveCreationOrganizationId()).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('actor que no es super-admin y envía organizationId -> 403', async () => {
    const service = serviceFor({ organizationId: ORG_A, isSuperAdmin: false });

    await expect(service.resolveCreationOrganizationId(ORG_B)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('super-admin: sin organizationId -> 400; inexistente -> 400; existente -> ese', async () => {
    const service = serviceFor({ organizationId: null, isSuperAdmin: true });

    await expect(service.resolveCreationOrganizationId()).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.resolveCreationOrganizationId(ORG_A)).rejects.toThrow(
      'El condominio indicado no existe',
    );
    await expect(service.resolveCreationOrganizationId(ORG_B)).resolves.toBe(
      ORG_B,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM organization WHERE id = $1'),
      [ORG_B],
    );
  });
});
