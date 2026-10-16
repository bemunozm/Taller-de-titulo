import {
  extractServiceApiKey,
  previousServiceApiKeyVerification,
  rememberServiceApiKeyVerification,
  SERVICE_API_KEY_VERIFICATION,
  type ServiceApiKeyVerification,
  type ServiceApiKeyVerificationCarrier,
  verifyServiceApiKey,
} from './service-api-key.verification';

/**
 * Fase 4 · P9: verificación compartida entre el parser del body (límite de
 * 10 MB de la ingesta) y `ServiceApiKeyGuard`.
 */
describe('verifyServiceApiKey', () => {
  const verifyApiKey = jest.fn();
  const betterAuth = { api: { verifyApiKey } } as never;

  beforeEach(() => verifyApiKey.mockReset());

  it('pide el permiso service:lpr y devuelve la key aceptada', async () => {
    const key = { id: 'key-1', referenceId: 'u', permissions: {} };
    verifyApiKey.mockResolvedValue({ valid: true, error: null, key });

    await expect(verifyServiceApiKey(betterAuth, 'good')).resolves.toEqual({
      status: 'valid',
      key,
    });
    expect(verifyApiKey).toHaveBeenCalledWith({
      body: { key: 'good', permissions: { service: ['lpr'] } },
    });
  });

  it.each([
    [
      { valid: false, key: null, error: { code: 'KEY_DISABLED' } },
      'KEY_DISABLED',
    ],
    [{ valid: true, key: null, error: null }, 'unknown'],
    [{ valid: false, key: null, error: null }, 'unknown'],
  ])('respuesta %p -> rejected (%s)', async (response, code) => {
    verifyApiKey.mockResolvedValue(response);

    await expect(verifyServiceApiKey(betterAuth, 'bad')).resolves.toEqual({
      status: 'rejected',
      code,
    });
  });

  it('si better-auth lanza, devuelve failed (nunca lanza)', async () => {
    verifyApiKey.mockRejectedValue(new Error('db down'));

    await expect(verifyServiceApiKey(betterAuth, 'k')).resolves.toEqual({
      status: 'failed',
      reason: 'db down',
    });
  });

  it('un throw que no es Error también queda como failed', async () => {
    verifyApiKey.mockRejectedValue('timeout');

    await expect(verifyServiceApiKey(betterAuth, 'k')).resolves.toEqual({
      status: 'failed',
      reason: 'timeout',
    });
  });
});

describe('extractServiceApiKey', () => {
  it.each([
    [{ 'x-api-key': 'k' }, 'k'],
    [{ 'x-api-key': '' }, undefined],
    [{ 'x-api-key': ['a', 'b'] }, undefined],
    [{}, undefined],
    [undefined, undefined],
  ])('%p -> %p', (headers, expected) => {
    expect(extractServiceApiKey(headers)).toBe(expected);
  });
});

describe('resultado guardado en la request', () => {
  const stored: ServiceApiKeyVerification = {
    status: 'rejected',
    code: 'INVALID_API_KEY',
  };

  it('se lee solo para la misma key', () => {
    const request: ServiceApiKeyVerificationCarrier = {};
    rememberServiceApiKeyVerification(request, 'k1', stored);

    expect(previousServiceApiKeyVerification(request, 'k1')).toBe(stored);
    expect(previousServiceApiKeyVerification(request, 'k2')).toBeUndefined();
    expect(previousServiceApiKeyVerification({}, 'k1')).toBeUndefined();
  });

  it('no es enumerable, no se puede pisar y la primera verificación gana', () => {
    const request: ServiceApiKeyVerificationCarrier = {};
    rememberServiceApiKeyVerification(request, 'k1', stored);
    rememberServiceApiKeyVerification(request, 'k1', {
      status: 'failed',
      reason: 'x',
    });

    expect(Object.keys(request)).toEqual([]);
    expect(JSON.stringify(request)).toBe('{}');
    expect(previousServiceApiKeyVerification(request, 'k1')).toBe(stored);
    expect(() => {
      (request as Record<symbol, unknown>)[SERVICE_API_KEY_VERIFICATION] = {
        apiKey: 'k1',
        result: { status: 'valid' },
      };
    }).toThrow(TypeError);
  });

  it('una clave de string con el mismo nombre (input HTTP) no cuenta', () => {
    const request = {
      'vigilia.serviceApiKeyVerification': {
        apiKey: 'k1',
        result: { status: 'valid', key: {} },
      },
    } as ServiceApiKeyVerificationCarrier;

    expect(previousServiceApiKeyVerification(request, 'k1')).toBeUndefined();
  });
});
