import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ServiceApiKeyGuard,
  ServiceKeyRequest,
  requireServiceKeyOrganizationId,
} from './service-api-key.guard';
import {
  rememberServiceApiKeyVerification,
  type ServiceApiKeyVerification,
} from '../service-api-key.verification';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('ServiceApiKeyGuard', () => {
  const verifyApiKey = jest.fn();
  const query = jest.fn();
  const guard = new ServiceApiKeyGuard(
    { api: { verifyApiKey } } as never,
    { query } as unknown as DataSource,
  );

  function contextFor(request: ServiceKeyRequest): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function verifiedKey(overrides: Record<string, unknown> = {}) {
    return {
      valid: true,
      error: null,
      key: {
        id: 'key-1',
        referenceId: OWNER,
        permissions: { service: ['lpr'], org: [ORG_A] },
        metadata: { createdBy: 'u' },
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    verifyApiKey.mockReset();
    query.mockReset();
    // Por defecto el dueño es miembro activo del condominio.
    query.mockResolvedValue([{ ok: 1 }]);
  });

  describe('header x-api-key', () => {
    it('rechaza sin header x-api-key', async () => {
      await expect(
        guard.canActivate(contextFor({ headers: {} })),
      ).rejects.toThrow(UnauthorizedException);
      expect(verifyApiKey).not.toHaveBeenCalled();
    });

    it('rechaza un header vacío', async () => {
      await expect(
        guard.canActivate(contextFor({ headers: { 'x-api-key': '' } })),
      ).rejects.toThrow(UnauthorizedException);
      expect(verifyApiKey).not.toHaveBeenCalled();
    });

    it('rechaza un header repetido (string[])', async () => {
      await expect(
        guard.canActivate(
          contextFor({ headers: { 'x-api-key': ['k1', 'k2'] } }),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(verifyApiKey).not.toHaveBeenCalled();
    });

    it('un Bearer JWT no reemplaza a la API key', async () => {
      await expect(
        guard.canActivate(
          contextFor({ headers: { authorization: 'Bearer a.b.c' } }),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(verifyApiKey).not.toHaveBeenCalled();
    });
  });

  describe('verificación con better-auth', () => {
    it('exige el permiso service:lpr al verificar', async () => {
      verifyApiKey.mockResolvedValue(verifiedKey());

      await guard.canActivate(contextFor({ headers: { 'x-api-key': 'good' } }));

      expect(verifyApiKey).toHaveBeenCalledWith({
        body: { key: 'good', permissions: { service: ['lpr'] } },
      });
    });

    it('rechaza una key inválida', async () => {
      verifyApiKey.mockResolvedValue({
        valid: false,
        key: null,
        error: { code: 'INVALID_API_KEY' },
      });
      const request: ServiceKeyRequest = { headers: { 'x-api-key': 'bad' } };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(request.serviceKey).toBeUndefined();
    });

    it('una key revocada (enabled=false) -> 401 sin consultar membresía', async () => {
      // AuthService.revokeServiceApiKey deja `enabled: false`; el plugin
      // responde KEY_DISABLED (validateApiKey en @better-auth/api-key).
      verifyApiKey.mockResolvedValue({
        valid: false,
        key: null,
        error: { code: 'KEY_DISABLED', message: 'API Key is disabled' },
      });
      const request: ServiceKeyRequest = {
        headers: { 'x-api-key': 'revoked' },
      };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        new UnauthorizedException('API key de servicio inválida o expirada'),
      );
      expect(query).not.toHaveBeenCalled();
      expect(request.serviceKey).toBeUndefined();
    });

    it('una key creada desde el cliente (sin permissions) no pasa la verificación -> 401', async () => {
      // better-auth responde KEY_NOT_FOUND cuando la key no tiene los
      // permisos pedidos (validateApiKey, `permissions` null).
      verifyApiKey.mockResolvedValue({
        valid: false,
        key: null,
        error: { code: 'KEY_NOT_FOUND' },
      });

      await expect(
        guard.canActivate(contextFor({ headers: { 'x-api-key': 'client' } })),
      ).rejects.toThrow(UnauthorizedException);
      expect(query).not.toHaveBeenCalled();
    });

    it('si verifyApiKey lanza -> 401 (sin filtrar el error)', async () => {
      verifyApiKey.mockRejectedValue(new Error('db down'));
      const request: ServiceKeyRequest = { headers: { 'x-api-key': 'good' } };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        new UnauthorizedException('API key de servicio inválida'),
      );
      expect(request.serviceKey).toBeUndefined();
    });
  });

  /**
   * Fase 4 · P9: en la ingesta, el parser del body ya verificó la key y dejó
   * el resultado en la request. Verificar escribe en la fila `apikey`
   * (`lastRequest`, `requestCount`, `remaining`): el guard no verifica dos
   * veces, pero sigue decidiendo (401/403) con ese resultado.
   */
  describe('resultado previo del parser del body', () => {
    function requestWith(
      apiKey: string,
      previousKey: string,
      result: ServiceApiKeyVerification,
    ): ServiceKeyRequest {
      const request: ServiceKeyRequest = { headers: { 'x-api-key': apiKey } };
      rememberServiceApiKeyVerification(request, previousKey, result);
      return request;
    }

    it('key válida ya verificada: no llama a verifyApiKey y revalida el condominio', async () => {
      const request = requestWith('good', 'good', {
        status: 'valid',
        key: verifiedKey().key as never,
      });

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(verifyApiKey).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(1);
      expect(request.serviceKey).toEqual({
        keyId: 'key-1',
        organizationId: ORG_A,
        ownerUserId: OWNER,
      });
    });

    it('resultado previo rechazado: 401 sin verificar de nuevo', async () => {
      const request = requestWith('bad', 'bad', {
        status: 'rejected',
        code: 'INVALID_API_KEY',
      });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        new UnauthorizedException('API key de servicio inválida o expirada'),
      );
      expect(verifyApiKey).not.toHaveBeenCalled();
      expect(request.serviceKey).toBeUndefined();
    });

    it('resultado previo fallido (BD caída): 401 sin reintentar (fail-closed)', async () => {
      const request = requestWith('good', 'good', {
        status: 'failed',
        reason: 'db down',
      });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        new UnauthorizedException('API key de servicio inválida'),
      );
      expect(verifyApiKey).not.toHaveBeenCalled();
    });

    it('un resultado de OTRA key no sirve: el guard verifica la key de la request', async () => {
      verifyApiKey.mockResolvedValue({
        valid: false,
        key: null,
        error: { code: 'INVALID_API_KEY' },
      });
      const request = requestWith('otra', 'good', {
        status: 'valid',
        key: verifiedKey().key as never,
      });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(verifyApiKey).toHaveBeenCalledWith({
        body: { key: 'otra', permissions: { service: ['lpr'] } },
      });
    });

    it('la falta del header manda aunque haya un resultado previo válido', async () => {
      const request: ServiceKeyRequest = { headers: {} };
      rememberServiceApiKeyVerification(request, 'good', {
        status: 'valid',
        key: verifiedKey().key as never,
      });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(verifyApiKey).not.toHaveBeenCalled();
    });
  });

  describe('vínculo key ↔ condominio', () => {
    it('expone request.serviceKey con el condominio de permissions.org', async () => {
      verifyApiKey.mockResolvedValue(verifiedKey());
      const request: ServiceKeyRequest = { headers: { 'x-api-key': 'good' } };

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(request.serviceKey).toEqual({
        keyId: 'key-1',
        organizationId: ORG_A,
        ownerUserId: OWNER,
      });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FROM member'),
        [OWNER, ORG_A],
      );
    });

    it('ignora un organizationId en metadata (la metadata la escribe el cliente)', async () => {
      verifyApiKey.mockResolvedValue(
        verifiedKey({
          permissions: { service: ['lpr'] },
          metadata: { organizationId: ORG_A },
        }),
      );
      const request: ServiceKeyRequest = { headers: { 'x-api-key': 'good' } };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        ForbiddenException,
      );
      expect(request.serviceKey).toBeUndefined();
    });

    it.each([
      ['sin permissions', null],
      ['sin org', { service: ['lpr'] }],
      ['org vacío', { service: ['lpr'], org: [] }],
      ['org con string vacío', { service: ['lpr'], org: [''] }],
      ['más de un condominio', { service: ['lpr'], org: [ORG_A, 'otro'] }],
      ['org no string', { service: ['lpr'], org: [42] }],
    ])('key %s -> 403 (fail-closed)', async (_label, permissions) => {
      verifyApiKey.mockResolvedValue(verifiedKey({ permissions }));
      const request: ServiceKeyRequest = { headers: { 'x-api-key': 'good' } };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        ForbiddenException,
      );
      expect(request.serviceKey).toBeUndefined();
    });

    it('el dueño ya no es miembro activo del condominio (o está deshabilitado) -> 403', async () => {
      verifyApiKey.mockResolvedValue(verifiedKey());
      query.mockResolvedValue([]);
      const request: ServiceKeyRequest = { headers: { 'x-api-key': 'good' } };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        ForbiddenException,
      );
      expect(request.serviceKey).toBeUndefined();
    });

    it('la consulta de membresía exige usuario no borrado (soft-delete)', async () => {
      verifyApiKey.mockResolvedValue(verifiedKey());

      await guard.canActivate(contextFor({ headers: { 'x-api-key': 'good' } }));

      const [sql] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('"deletedAt" IS NULL');
    });

    it('si la consulta de membresía falla -> 403 (fail-closed, no 500)', async () => {
      verifyApiKey.mockResolvedValue(verifiedKey());
      query.mockRejectedValue(new Error('db down'));

      await expect(
        guard.canActivate(contextFor({ headers: { 'x-api-key': 'good' } })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('key sin dueño (referenceId vacío) -> 403 sin consultar membresía', async () => {
      verifyApiKey.mockResolvedValue(verifiedKey({ referenceId: '' }));

      await expect(
        guard.canActivate(contextFor({ headers: { 'x-api-key': 'good' } })),
      ).rejects.toThrow(ForbiddenException);
      expect(query).not.toHaveBeenCalled();
    });
  });
});

describe('requireServiceKeyOrganizationId', () => {
  it('devuelve el condominio de la service key', () => {
    expect(
      requireServiceKeyOrganizationId({
        serviceKey: { keyId: 'k', organizationId: ORG_A, ownerUserId: OWNER },
      }),
    ).toBe(ORG_A);
  });

  it.each([
    ['sin serviceKey (handler sin guard)', {}],
    [
      'condominio vacío',
      { serviceKey: { keyId: 'k', organizationId: '', ownerUserId: OWNER } },
    ],
  ])('%s -> 403', (_label, request: ServiceKeyRequest) => {
    expect(() => requireServiceKeyOrganizationId(request)).toThrow(
      ForbiddenException,
    );
  });
});
