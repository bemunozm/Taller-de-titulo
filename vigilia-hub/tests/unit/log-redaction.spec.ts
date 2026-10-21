import {
  callerMetadata,
  REDACTED,
  redactLogInfo,
  redactSensitive,
  scrubSecrets,
  type LogInfo,
} from '../../src/utils/log-redaction';

/**
 * Fase 4 · P6.M: el formato de winston redacta transcripciones, argumentos de
 * tools, contexto, prompt, sessionId y tokens antes de escribir el log.
 */
describe('log-redaction', () => {
  it('redacta las claves sensibles a cualquier profundidad (evento de OpenAI)', () => {
    const event = {
      type: 'response.done',
      event_id: 'evt_1',
      response: {
        id: 'resp_1',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_audio', transcript: 'Encantada Pedro Soto' }],
          },
          {
            type: 'function_call',
            name: 'guardar_datos_visitante',
            call_id: 'call_1',
            arguments: '{"rut":"12.345.678-5"}',
          },
        ],
      },
    };

    const redacted = JSON.stringify(redactSensitive(event));

    expect(redacted).not.toMatch(/Pedro|Soto|12\.345\.678/);
    // La estructura y los metadatos se conservan.
    expect(redacted).toContain('guardar_datos_visitante');
    expect(redacted).toContain('"status":"completed"');
    expect(redacted).toContain('"type":"function_call"');
    expect(redacted).toContain(REDACTED);
  });

  it('session.update: redacta el prompt (instructions); conserva la config técnica', () => {
    const redacted = redactSensitive({
      sessionUpdate: {
        type: 'session.update',
        session: {
          instructions: 'Eres Sofía... casa 504',
          audio: { input: { format: { type: 'audio/pcm', rate: 24000 } } },
        },
      },
    }) as { sessionUpdate: { session: { instructions: string; audio: unknown } } };

    expect(redacted.sessionUpdate.session.instructions).toBe(REDACTED);
    expect(JSON.stringify(redacted)).toContain('"rate":24000');
  });

  it.each([
    ['transcript', 'Mi RUT es 12.345.678-5'],
    ['args', { nombre: 'Pedro' }],
    ['toolArgs', { telefono: '+56911111111' }],
    ['context', 'Visitas esperadas: Juan P.'],
    ['expectedVisitors', ['Juan P.']],
    ['prompt', 'Eres Sofía'],
    ['sessionId', 'sess-123'],
    ['ephemeralToken', 'ek_123'],
    ['hubSecret', 's3cr3t'],
    ['X-Hub-Secret', 's3cr3t'],
    ['Authorization', 'Bearer abc'],
    ['text', 'mensaje inyectado'],
    ['delta', 'base64audio'],
    ['audio', 'UklGRiQAAABXQVZF'],
  ])('clave %s -> [REDACTED]', (key, value) => {
    expect(redactSensitive({ nested: { [key]: value } })).toEqual({
      nested: { [key]: REDACTED },
    });
  });

  it('output: redacta el string (resultado de una tool) pero recorre la lista', () => {
    expect(redactSensitive({ output: '{"residentes":[{"nombre":"Ana"}]}' })).toEqual({
      output: REDACTED,
    });
    expect(redactSensitive({ output: [{ type: 'message' }] })).toEqual({
      output: [{ type: 'message' }],
    });
  });

  it('scrubSecrets: borra Bearer, claves de OpenAI y secretos con forma clave=valor', () => {
    const scrubbed = scrubSecrets(
      'Authorization: Bearer ek_68af1234567890abcdef token=abc123 hubSecret: s3cr3tValue sk-proj-abcdefghij1234',
    );

    expect(scrubbed).not.toMatch(/ek_68af|abc123|s3cr3tValue|sk-proj-abcdefghij1234/);
    expect(scrubbed).toContain(`Bearer ${REDACTED}`);
  });

  it('no confunde texto común con secretos', () => {
    expect(scrubSecrets('✅ Token efímero y sesión obtenidos del backend')).toBe(
      '✅ Token efímero y sesión obtenidos del backend',
    );
  });

  it('redactLogInfo: mensaje, stack y metadatos; no toca level/service ni las claves simbólicas', () => {
    const splat = Symbol.for('splat');
    const info: LogInfo = {
      level: 'debug',
      message: 'Conectando con Bearer abc.def.ghi',
      service: 'ConciergeClientService',
      stack: 'Error: x token=zzz\n    at foo',
      event: { type: 'conversation.item.input_audio_transcription.completed', transcript: 'Hola soy Ana' },
      sessionId: 'sess-1',
      [splat]: ['crudo'],
    };

    redactLogInfo(info);

    expect(info.level).toBe('debug');
    expect(info.service).toBe('ConciergeClientService');
    expect(info.message).toBe(`Conectando con Bearer ${REDACTED}`);
    expect(info.stack).not.toContain('zzz');
    expect(info.sessionId).toBe(REDACTED);
    expect(JSON.stringify(info.event)).not.toContain('Ana');
    expect(info[splat]).toEqual(['crudo']);
  });

  it('callerMetadata: solo los metadatos del llamador', () => {
    expect(
      callerMetadata({ level: 'info', message: 'm', service: 's', timestamp: 't', count: 2 }),
    ).toEqual({ count: 2 });
    expect(callerMetadata({ level: 'info', message: 'm', service: 's' })).toBeNull();
  });

  it('referencias circulares y errores anidados no rompen', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const redacted = redactSensitive({ circular, error: new Error('falló con token=xyz') });

    expect(JSON.stringify(redacted)).toContain('[Circular]');
    expect(JSON.stringify(redacted)).not.toContain('xyz');
  });
});
