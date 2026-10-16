import { buildHttpCorsOptions } from './http-cors.options';

describe('buildHttpCorsOptions', () => {
  const options = buildHttpCorsOptions('https://vigilia.example');

  it('un solo origen (el del frontend) con credenciales', () => {
    expect(options.origin).toBe('https://vigilia.example');
    expect(options.credentials).toBe(true);
  });

  it('Fase 4 · P7: expone Content-Disposition (nombre del archivo de data-export)', () => {
    expect(options.exposedHeaders).toEqual(['Content-Disposition']);
  });

  it('permite la credencial del kiosko, pero no Authorization ni x-api-key', () => {
    expect(options.allowedHeaders).toEqual(
      expect.arrayContaining(['Content-Type', 'X-Hub-Id', 'X-Hub-Secret']),
    );
    expect(options.allowedHeaders).not.toContain('Authorization');
    expect(options.allowedHeaders).not.toContain('x-api-key');
  });
});
