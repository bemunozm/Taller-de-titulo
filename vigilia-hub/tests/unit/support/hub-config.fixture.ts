import type { HubConfig } from '../../../src/config';

/** Configuración de prueba (como la que devolvería `loadHubConfig` en desarrollo). */
export function testHubConfig(overrides: Partial<HubConfig> = {}): HubConfig {
  return {
    environment: 'test',
    backendUrl: 'http://backend.test',
    backendSocketUrl: 'ws://backend.test',
    hubId: 'hub-test',
    hubSecret: 'secret-test-0123456789abcdef0123456789',
    debugOpenAiKey: null,
    ...overrides,
  };
}
