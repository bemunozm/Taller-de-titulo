import type { Repository } from 'typeorm';
import * as authUtil from '../auth/utils/auth.util';
import { Hub, HubType } from './entities/hub.entity';
import { verifyHubCredentials } from './hub-credentials';

/**
 * Fase 4 · P4: verificación compartida por `HubAuthGuard` y el middleware de
 * `/hub`. Siempre paga un bcrypt (también sin hub o sin secret) para que el
 * tiempo de respuesta no revele si el `hubId` existe.
 */
describe('verifyHubCredentials', () => {
  let secretHash: string;
  let findOne: jest.Mock;
  let checkPasswordSpy: jest.SpyInstance;

  const repository = (): Repository<Hub> =>
    ({ findOne }) as unknown as Repository<Hub>;

  function hub(overrides: Partial<Hub> = {}): Hub {
    return {
      hubId: 'hub-A',
      type: HubType.PHYSICAL_HUB,
      organizationId: 'condo-A',
      secretHash,
      active: true,
      ...overrides,
    } as Hub;
  }

  beforeAll(async () => {
    secretHash = await authUtil.hashPassword('secret-correcto');
  });

  beforeEach(() => {
    findOne = jest.fn();
    checkPasswordSpy = jest.spyOn(authUtil, 'checkPassword');
  });

  afterEach(() => {
    checkPasswordSpy.mockRestore();
  });

  it('acepta el secret propio del hub activo', async () => {
    findOne.mockResolvedValue(hub());

    const result = await verifyHubCredentials(
      repository(),
      'hub-A',
      'secret-correcto',
    );

    expect(result).toEqual({ ok: true, hub: hub() });
    expect(findOne).toHaveBeenCalledWith({
      where: { hubId: 'hub-A', active: true },
    });
  });

  it.each([
    ['hub desconocido o inactivo', null, 'unknown_or_inactive'],
    ['hub sin secret provisionado', 'sin-secret', 'no_secret'],
    ['secret inválido', 'con-secret', 'invalid_secret'],
  ] as const)(
    '%s: rechaza y igual ejecuta un bcrypt (tiempo constante)',
    async (_case, stored, reason) => {
      findOne.mockResolvedValue(
        stored === null
          ? null
          : hub({ secretHash: stored === 'sin-secret' ? null : secretHash }),
      );

      const result = await verifyHubCredentials(
        repository(),
        'hub-A',
        stored === null ? 'secret-correcto' : 'secret-incorrecto',
      );

      expect(result).toEqual({ ok: false, reason });
      expect(checkPasswordSpy).toHaveBeenCalledTimes(1);
      const [, hashUsed] = checkPasswordSpy.mock.calls[0] as [string, string];
      expect(hashUsed).toMatch(/^\$2[aby]\$10\$/);
    },
  );
});
