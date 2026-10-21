import { hubAuthHeaders } from '../../src/utils/hub-auth-headers';

describe('hub-auth-headers (Fase 4 · P5)', () => {
  it('arma X-Hub-Id + X-Hub-Secret', () => {
    expect(hubAuthHeaders({ hubId: 'hub-1', hubSecret: 's3cr3t' })).toEqual({
      'X-Hub-Id': 'hub-1',
      'X-Hub-Secret': 's3cr3t',
    });
  });

  // Fase 4 · P6.M: la credencial ya no se lee del entorno acá; la exige
  // `loadHubConfig` al arrancar (ver config.spec.ts).
});
