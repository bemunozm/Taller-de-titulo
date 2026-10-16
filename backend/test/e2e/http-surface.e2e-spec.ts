import { API, E2eScenario, SIGN_IN_PATH } from './support/scenario';
import { uniqueEmail } from './support/test-data';

/**
 * Superficie HTTP (Fase 4 · P8):
 *  - better-auth solo responde su lista blanca (P4.B); el resto de sus
 *    endpoints nativos da 404, con o sin sesión;
 *  - el body de las rutas públicas tiene un tope de 100 kb (P7): más grande,
 *    413 antes de parsear o validar nada.
 */
describe('Superficie HTTP (e2e)', () => {
  let scenario: E2eScenario;

  beforeAll(async () => {
    scenario = await E2eScenario.start();
  });

  describe('lista blanca de better-auth', () => {
    const NATIVE_ENDPOINTS = [
      '/api/auth/organization/delete',
      '/api/auth/organization/create',
      '/api/auth/sign-up/email',
      '/api/auth/api-key/create',
      '/api/auth/change-password',
    ];

    it.each(NATIVE_ENDPOINTS)(
      'POST %s responde 404 aunque haya sesión de super-admin',
      async (path) => {
        const response = await scenario.superAdmin.http.post(path, {
          organizationId: '00000000-0000-4000-8000-000000000000',
        });

        expect(response.status).toBe(404);
      },
    );

    it.each(NATIVE_ENDPOINTS)(
      'POST %s responde 404 sin sesión',
      async (path) => {
        const response = await scenario.newClient().post(path, {});

        expect(response.status).toBe(404);
      },
    );

    it('control: el login (en la lista blanca) responde, con 401 ante una clave incorrecta', async () => {
      const response = await scenario.newClient().post(SIGN_IN_PATH, {
        email: scenario.state.superAdmin.email,
        password: 'clave-incorrecta-e2e',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('límite de tamaño del body', () => {
    const PUBLIC_ROUTE = `${API}/auth/forgot-password`;

    it('más de 100 kb en una ruta pública responde 413', async () => {
      const oversized = JSON.stringify({
        email: uniqueEmail('limite'),
        padding: 'a'.repeat(150 * 1024),
      });

      const response = await scenario.newClient().request({
        method: 'POST',
        path: PUBLIC_ROUTE,
        rawBody: oversized,
      });

      expect(response.status).toBe(413);
    });

    it('control: un body chico en la misma ruta se procesa', async () => {
      const response = await scenario
        .newClient()
        .post(PUBLIC_ROUTE, { email: uniqueEmail('limite') });

      expect(response.status).not.toBe(413);
      expect(response.status).toBe(201);
    });
  });

  /**
   * Fase 4 · P9 (cyber BAJO): los 10 MB de la ingesta del LPR exigen una API
   * key VERIFICADA. Antes bastaba cualquier `x-api-key` para que un cliente
   * sin credenciales hiciera parsear 10 MB antes del 401.
   */
  describe('límite grande de la ingesta del LPR', () => {
    const INGESTION_ROUTE = `${API}/detections/plates`;
    const TWO_MB = 2 * 1024 * 1024;
    let validKey: string;

    beforeAll(async () => {
      const condominium = await scenario.createCondominium('Ingesta');
      validKey = await scenario.createServiceApiKey(condominium.admin);
    });

    function oversized(bytes: number): string {
      return JSON.stringify({ padding: 'A'.repeat(bytes) });
    }

    it('x-api-key inválida y 2 MB: 401 del guard, sin parsear el body', async () => {
      const response = await scenario.newClient({ 'x-api-key': 'a' }).request({
        method: 'POST',
        path: INGESTION_ROUTE,
        rawBody: oversized(TWO_MB),
      });

      expect(response.status).toBe(401);
    });

    it('sin x-api-key: el límite general (150 kb -> 413)', async () => {
      const response = await scenario.newClient().request({
        method: 'POST',
        path: INGESTION_ROUTE,
        rawBody: oversized(150 * 1024),
      });

      expect(response.status).toBe(413);
    });

    it('key válida y 2 MB: el parser grande lo acepta y responde la validación (400, no 413)', async () => {
      const response = await scenario.lprClient(validKey).request({
        method: 'POST',
        path: INGESTION_ROUTE,
        rawBody: oversized(TWO_MB),
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.json)).toContain(
        'property padding should not exist',
      );
    });
  });
});
