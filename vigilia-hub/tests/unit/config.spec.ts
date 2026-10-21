import { HubConfigError, loadHubConfig } from '../../src/config';

const HUB_SECRET = 'a3f9c2e17b6d4058a9e2c7f1d3b5a8e0c4f6d2b9a7e1c3f5d8b0a2e4c6f8d1b3';

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    BACKEND_URL: 'https://api.vigilia.test',
    HUB_ID: 'hub-porton-1',
    HUB_SECRET,
    ...overrides,
  };
}

/** Mensaje del error de configuración (falla el test si no lanza). */
function configError(values: NodeJS.ProcessEnv): string {
  try {
    loadHubConfig(values);
  } catch (error) {
    expect(error).toBeInstanceOf(HubConfigError);
    return (error as Error).message;
  }
  throw new Error('se esperaba que la configuración fuera rechazada');
}

/**
 * Fase 4 · P6.M: configuración central del hub, validada una vez al arrancar.
 */
describe('loadHubConfig', () => {
  describe('producción', () => {
    it('acepta https y deriva wss', () => {
      expect(loadHubConfig(env())).toEqual({
        environment: 'production',
        backendUrl: 'https://api.vigilia.test',
        backendSocketUrl: 'wss://api.vigilia.test',
        hubId: 'hub-porton-1',
        hubSecret: HUB_SECRET,
        debugOpenAiKey: null,
      });
    });

    it('conserva el puerto y quita la barra final', () => {
      const config = loadHubConfig(env({ BACKEND_URL: 'https://api.vigilia.test:8443/' }));
      expect(config.backendUrl).toBe('https://api.vigilia.test:8443');
      expect(config.backendSocketUrl).toBe('wss://api.vigilia.test:8443');
    });

    it('rechaza http:// (sin imprimir la URL)', () => {
      const message = configError(env({ BACKEND_URL: 'http://192.168.1.100:3000' }));
      expect(message).toMatch(/BACKEND_URL debe usar https:\/\/ en producción/);
      expect(message).not.toContain('192.168.1.100');
    });

    it('rechaza http:// también en el alias BACKEND_API_URL', () => {
      expect(
        configError(env({ BACKEND_URL: undefined, BACKEND_API_URL: 'http://backend:3000' })),
      ).toMatch(/BACKEND_API_URL debe usar https:\/\//);
    });

    it.each([
      ['NODE_ENV ausente', undefined],
      ['NODE_ENV vacío', ''],
      ['NODE_ENV staging', 'staging'],
    ])('%s -> reglas de producción', (_case, nodeEnv) => {
      expect(
        configError(env({ NODE_ENV: nodeEnv, BACKEND_URL: 'http://backend:3000' })),
      ).toMatch(/https:\/\/ en producción/);
    });

    it('prohíbe DEBUG_OPENAI_KEY (sin imprimirla)', () => {
      const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz';
      const message = configError(env({ DEBUG_OPENAI_KEY: key }));
      expect(message).toMatch(/DEBUG_OPENAI_KEY está prohibida en producción/);
      expect(message).not.toContain(key);
    });
  });

  describe('HUB_ID / HUB_SECRET (todo entorno)', () => {
    it.each(['production', 'development'])('sin HUB_ID -> error, nunca un id aleatorio (%s)', (nodeEnv) => {
      expect(configError(env({ NODE_ENV: nodeEnv, HUB_ID: undefined }))).toMatch(
        /HUB_ID es obligatorio/,
      );
    });

    it.each(['production', 'development'])('sin HUB_SECRET -> error (%s)', (nodeEnv) => {
      expect(configError(env({ NODE_ENV: nodeEnv, HUB_SECRET: '  ' }))).toMatch(
        /HUB_SECRET es obligatorio/,
      );
    });

    it('rechaza el placeholder del .env.example y secretos cortos (sin imprimirlos)', () => {
      expect(
        configError(env({ HUB_SECRET: '<secret devuelto por POST /hubs al provisionar este hub>' })),
      ).toMatch(/HUB_SECRET tiene un valor de ejemplo/);
      const message = configError(env({ HUB_SECRET: 'corto-123' }));
      expect(message).toMatch(/HUB_SECRET debe tener al menos 32 caracteres/);
      expect(message).not.toContain('corto-123');
    });

    it('rechaza un HUB_ID con un formato que el backend no acepta', () => {
      expect(configError(env({ HUB_ID: 'hub 1; drop' }))).toMatch(/HUB_ID debe tener solo letras/);
    });
  });

  describe('BACKEND_URL / BACKEND_API_URL', () => {
    it('BACKEND_URL obligatoria', () => {
      expect(configError(env({ BACKEND_URL: undefined }))).toMatch(/BACKEND_URL es obligatoria/);
    });

    it('solo BACKEND_API_URL (nombre viejo): se acepta con aviso', () => {
      const warnings: string[] = [];
      const config = loadHubConfig(
        env({ BACKEND_URL: undefined, BACKEND_API_URL: 'https://api.vigilia.test' }),
        (warning) => warnings.push(warning),
      );
      expect(config.backendUrl).toBe('https://api.vigilia.test');
      expect(warnings.join('\n')).toMatch(/BACKEND_API_URL está obsoleta/);
    });

    it('las dos iguales: redundante, se usa una sola', () => {
      const warnings: string[] = [];
      const config = loadHubConfig(
        env({ BACKEND_API_URL: 'https://api.vigilia.test/' }),
        (warning) => warnings.push(warning),
      );
      expect(config.backendUrl).toBe('https://api.vigilia.test');
      expect(warnings.join('\n')).toMatch(/redundante/);
    });

    it('las dos distintas -> error', () => {
      expect(configError(env({ BACKEND_API_URL: 'https://otro.vigilia.test' }))).toMatch(
        /BACKEND_API_URL no coincide con BACKEND_URL/,
      );
    });

    it.each([
      ['con ruta', 'https://api.vigilia.test/api/v1', /solo el origen/],
      ['con credenciales', 'https://user:pass@api.vigilia.test', /usuario ni contraseña/],
      ['ws://', 'ws://api.vigilia.test', /debe usar https:\/\//],
      ['no es URL', 'api.vigilia.test', /no es una URL válida|debe usar https/],
    ])('rechaza BACKEND_URL %s', (_case, url, expected) => {
      expect(configError(env({ BACKEND_URL: url }))).toMatch(expected);
    });

    it('junta todos los problemas en un solo error', () => {
      const message = configError(
        env({ BACKEND_URL: 'http://backend', HUB_ID: undefined, HUB_SECRET: undefined }),
      );
      expect(message).toMatch(/BACKEND_URL/);
      expect(message).toMatch(/HUB_ID/);
      expect(message).toMatch(/HUB_SECRET/);
    });
  });

  describe('desarrollo', () => {
    it('acepta http:// con aviso y deriva ws://', () => {
      const warnings: string[] = [];
      const config = loadHubConfig(
        env({ NODE_ENV: 'development', BACKEND_URL: 'http://localhost:3000' }),
        (warning) => warnings.push(warning),
      );
      expect(config.environment).toBe('development');
      expect(config.backendUrl).toBe('http://localhost:3000');
      expect(config.backendSocketUrl).toBe('ws://localhost:3000');
      expect(warnings.join('\n')).toMatch(/BACKEND_URL usa http:\/\//);
    });

    it('acepta DEBUG_OPENAI_KEY con aviso', () => {
      const warnings: string[] = [];
      const config = loadHubConfig(
        env({ NODE_ENV: 'development', DEBUG_OPENAI_KEY: 'sk-dev-1234567890abcdef' }),
        (warning) => warnings.push(warning),
      );
      expect(config.debugOpenAiKey).toBe('sk-dev-1234567890abcdef');
      expect(warnings.join('\n')).toMatch(/DEBUG_OPENAI_KEY definida/);
      expect(warnings.join('\n')).not.toContain('sk-dev-1234567890abcdef');
    });
  });

  it('la config es inmutable', () => {
    const config = loadHubConfig(env());
    expect(Object.isFrozen(config)).toBe(true);
  });
});
