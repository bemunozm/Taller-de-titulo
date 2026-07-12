import {
  AuthorizedContextFactory,
  type AuthorizedContextRequest,
} from './authorized-context.factory';

/**
 * Fase 1, Bloque A2t — cobertura de `AuthorizedContextFactory`
 * (docs/modulos/agente-cerebro.md §5/§7/§11). Sin dependencias que mockear:
 * es una función pura sobre la forma del `request` ya autenticado por
 * `ConciergeAuthGuard`/`HubAuthGuard`/`AuthGuard`.
 */
describe('AuthorizedContextFactory', () => {
  let factory: AuthorizedContextFactory;

  beforeEach(() => {
    factory = new AuthorizedContextFactory();
  });

  describe('sesión de hub físico', () => {
    it('usa el baseline fijo digital-concierge.access como scopes, sin importar tenantContext', () => {
      const request: AuthorizedContextRequest = {
        hub: { hubId: 'hub-A', organizationId: 'condo-A' },
        tenantContext: { organizationId: 'condo-A', isSuperAdmin: false },
      };

      const ctx = factory.fromRequest(request);

      expect(ctx.scopes).toEqual(['digital-concierge.access']);
      expect(ctx.role).toBe('hub');
      expect(ctx.userId).toBeUndefined();
      expect(ctx.isSuperAdmin).toBe(false);
    });

    it('deriva tenantId de tenantContext.organizationId (el mismo que pobló HubAuthGuard)', () => {
      const request: AuthorizedContextRequest = {
        hub: { hubId: 'hub-A', organizationId: 'condo-A' },
        tenantContext: { organizationId: 'condo-A', isSuperAdmin: false },
      };

      const ctx = factory.fromRequest(request);

      expect(ctx.tenantId).toBe('condo-A');
    });

    it('cae en el "cajón nulo" si el hub no tiene tenantContext (hub sin organización asociada)', () => {
      const request: AuthorizedContextRequest = {
        hub: { hubId: 'hub-huerfano', organizationId: null },
      };

      const ctx = factory.fromRequest(request);

      expect(ctx.tenantId).toBeNull();
      expect(ctx.scopes).toEqual(['digital-concierge.access']);
    });

    it('prioriza la rama de hub aunque request.user también esté presente', () => {
      const request: AuthorizedContextRequest = {
        hub: { hubId: 'hub-A', organizationId: 'condo-A' },
        tenantContext: { organizationId: 'condo-A', isSuperAdmin: false },
        user: {
          id: 'user-1',
          roles: [
            {
              name: 'Admin',
              permissions: [{ name: 'digital-concierge.access' }],
            },
          ],
        },
      };

      const ctx = factory.fromRequest(request);

      expect(ctx.role).toBe('hub');
      expect(ctx.userId).toBeUndefined();
    });
  });

  describe('sesión humana', () => {
    it('usa los permisos REALES del usuario (aplanados de roles[].permissions[]) como scopes', () => {
      const request: AuthorizedContextRequest = {
        tenantContext: { organizationId: 'condo-A', isSuperAdmin: false },
        user: {
          id: 'user-1',
          roles: [
            {
              name: 'Conserje',
              permissions: [
                { name: 'digital-concierge.access' },
                { name: 'visits.read' },
              ],
            },
          ],
        },
      };

      const ctx = factory.fromRequest(request);

      expect(ctx.scopes).toEqual(['digital-concierge.access', 'visits.read']);
      expect(ctx.userId).toBe('user-1');
      expect(ctx.role).toBe('Conserje');
    });

    it('deriva tenantId/isSuperAdmin de tenantContext, no del usuario', () => {
      const request: AuthorizedContextRequest = {
        tenantContext: { organizationId: 'condo-B', isSuperAdmin: true },
        user: {
          id: 'user-2',
          roles: [{ name: 'Super Administrador', permissions: [] }],
        },
      };

      const ctx = factory.fromRequest(request);

      expect(ctx.tenantId).toBe('condo-B');
      expect(ctx.isSuperAdmin).toBe(true);
    });

    it('usa "user" como role sentinel si el usuario no tiene roles asignados, y scopes vacío', () => {
      const request: AuthorizedContextRequest = {
        tenantContext: { organizationId: 'condo-A', isSuperAdmin: false },
        user: { id: 'user-3', roles: [] },
      };

      const ctx = factory.fromRequest(request);

      expect(ctx.role).toBe('user');
      expect(ctx.scopes).toEqual([]);
    });
  });

  describe('sin hub ni usuario (bug de guard, no caso de negocio válido)', () => {
    it('devuelve un contexto que deniega todo (scopes vacío) EN VEZ de lanzar', () => {
      const request: AuthorizedContextRequest = {
        tenantContext: { organizationId: 'condo-A', isSuperAdmin: false },
      };

      expect(() => factory.fromRequest(request)).not.toThrow();

      const ctx = factory.fromRequest(request);
      expect(ctx.scopes).toEqual([]);
      expect(ctx.role).toBe('unknown');
      expect(ctx.userId).toBeUndefined();
      expect(ctx.tenantId).toBeNull();
    });

    it('devuelve tenantId null incluso sin tenantContext en absoluto', () => {
      const ctx = factory.fromRequest({});

      expect(ctx.tenantId).toBeNull();
      expect(ctx.isSuperAdmin).toBe(false);
      expect(ctx.scopes).toEqual([]);
    });
  });

  describe('requestId', () => {
    it('genera un requestId distinto en cada llamada (correlación por turno, no reutilizable)', () => {
      const request: AuthorizedContextRequest = {
        hub: { hubId: 'hub-A', organizationId: 'condo-A' },
        tenantContext: { organizationId: 'condo-A', isSuperAdmin: false },
      };

      const ctx1 = factory.fromRequest(request);
      const ctx2 = factory.fromRequest(request);

      expect(ctx1.requestId).toEqual(expect.any(String));
      expect(ctx1.requestId).not.toBe(ctx2.requestId);
    });
  });
});
