import { Logger } from '@nestjs/common';
import type { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { DataSource } from 'typeorm';
import { OrganizationMembershipService } from './organization-membership.service';
import type { auth } from '../auth/better-auth';

/**
 * Fase 4 · P5 (D11): la puerta única a las membresías y el aviso al arrancar.
 */
describe('OrganizationMembershipService', () => {
  let dataSource: { query: jest.Mock };
  let api: { addMember: jest.Mock; createOrganization: jest.Mock };
  let service: OrganizationMembershipService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    dataSource = { query: jest.fn() };
    api = {
      addMember: jest.fn().mockResolvedValue({ id: 'member-1' }),
      createOrganization: jest.fn().mockResolvedValue({ id: 'org-1' }),
    };
    service = new OrganizationMembershipService(
      { api } as unknown as BetterAuthService<typeof auth>,
      dataSource as unknown as DataSource,
    );
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('aviso al arrancar', () => {
    it('con usuarios (no super-admin) sin membresía: avisa con el conteo', async () => {
      dataSource.query.mockResolvedValue([{ count: 3 }]);

      await service.onApplicationBootstrap();

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS (SELECT 1 FROM member m'),
        ['Super Administrador'],
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('3 usuario(s)'),
      );
    });

    it('sin usuarios huérfanos: no avisa', async () => {
      dataSource.query.mockResolvedValue([{ count: 0 }]);

      await expect(service.warnAboutUsersWithoutMembership()).resolves.toBe(0);
      expect(warn).not.toHaveBeenCalled();
    });

    it('si la consulta falla, no rompe el arranque', async () => {
      dataSource.query.mockRejectedValue(
        new Error('relation "member" does not exist'),
      );

      await expect(
        service.warnAboutUsersWithoutMembership(),
      ).resolves.toBeNull();
    });
  });

  it('addMember: llamada server-side a better-auth con rol member', async () => {
    await service.addMember('user-1', 'org-1');

    expect(api.addMember).toHaveBeenCalledWith({
      body: { userId: 'user-1', organizationId: 'org-1', role: 'member' },
    });
  });

  it('createOrganization: el usuario indicado queda como owner', async () => {
    await service.createOrganization({
      name: 'Condominio',
      slug: 'condominio',
      ownerUserId: 'admin-1',
    });

    expect(api.createOrganization).toHaveBeenCalledWith({
      body: { name: 'Condominio', slug: 'condominio', userId: 'admin-1' },
    });
  });

  it('isMemberOfOrganization: fail-closed ante un error de BD', async () => {
    dataSource.query.mockRejectedValue(
      new Error('invalid input syntax for type uuid'),
    );

    await expect(
      service.isMemberOfOrganization('no-uuid', 'org-1'),
    ).resolves.toBe(false);
  });

  it('isMemberOfOrganization / organizationExists / isSlugTaken: true solo si hay fila', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ ok: 1 }])
      .mockResolvedValueOnce([]);

    await expect(service.isMemberOfOrganization('u', 'o')).resolves.toBe(true);
    await expect(service.organizationExists('o')).resolves.toBe(false);
  });

  it('P5.C: listOrganizations devuelve { id, name, slug } ordenados por nombre (propaga errores)', async () => {
    const rows = [{ id: 'org-1', name: 'Alfa', slug: 'alfa' }];
    dataSource.query.mockResolvedValueOnce(rows);

    await expect(service.listOrganizations()).resolves.toEqual(rows);
    expect(dataSource.query).toHaveBeenCalledWith(
      'SELECT id, name, slug FROM organization ORDER BY name ASC, id ASC',
    );

    dataSource.query.mockRejectedValueOnce(new Error('db down'));
    await expect(service.listOrganizations()).rejects.toThrow('db down');
  });
});
