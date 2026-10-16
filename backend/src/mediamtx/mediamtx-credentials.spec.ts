import { timingSafeEqual } from 'crypto';
import {
  MEDIAMTX_AUTH_USER,
  mediamtxBasicAuthorization,
  readMediamtxAuthSecret,
  secretsMatch,
} from './mediamtx-credentials';
import {
  describeMediamtxErrorBody,
  isPathNotConfiguredError,
  MAX_MEDIAMTX_ERROR_SUMMARY_LENGTH,
  MAX_MEDIAMTX_REDACTION_INPUT_LENGTH,
  redactUrlCredentials,
} from './mediamtx-redaction.util';

// `timingSafeEqual` real, envuelto para poder ver con qué se llamó.
jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const SECRET = 'Hq4Vt8Zm2Lc7Rx1Nw5Kp9Bd3Fs6Gy0JaTe';

describe('mediamtx-credentials (Fase 4 · P6.M)', () => {
  beforeEach(() => {
    jest.mocked(timingSafeEqual).mockClear();
  });

  it('Basic = base64("vigilia-backend:<secreto>")', () => {
    const header = mediamtxBasicAuthorization(SECRET);

    expect(header.startsWith('Basic ')).toBe(true);
    expect(
      Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8'),
    ).toBe(`${MEDIAMTX_AUTH_USER}:${SECRET}`);
    expect(MEDIAMTX_AUTH_USER).toBe('vigilia-backend');
  });

  it('lee MEDIAMTX_AUTH_SECRET recortado; vacío o ausente -> null', () => {
    expect(
      readMediamtxAuthSecret({ MEDIAMTX_AUTH_SECRET: ` ${SECRET} ` }),
    ).toBe(SECRET);
    expect(readMediamtxAuthSecret({ MEDIAMTX_AUTH_SECRET: '   ' })).toBeNull();
    expect(readMediamtxAuthSecret({})).toBeNull();
  });

  it('secretsMatch: igual -> true; distinto, prefijo o vacío -> false', () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
    expect(secretsMatch(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretsMatch(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(secretsMatch('', SECRET)).toBe(false);
  });

  it('compara en tiempo constante: timingSafeEqual sobre 32 bytes aunque los largos difieran', () => {
    const spy = jest.mocked(timingSafeEqual);

    secretsMatch('x', SECRET);

    expect(spy).toHaveBeenCalledTimes(1);
    const [provided, expected] = spy.mock.calls[0] as unknown as [
      Buffer,
      Buffer,
    ];
    expect(provided).toHaveLength(32);
    expect(expected).toHaveLength(32);
  });
});

describe('mediamtx-redaction.util (Fase 4 · P6.M)', () => {
  it.each([
    'rtsp://admin:Sup3rSecreta@10.0.0.5:554/Streaming/Channels/101',
    'rtsp://admin:p@ss/w0rd@10.0.0.5:554/stream',
    'rtsps+ws://user:clave@cam.local/live',
  ])('no deja credenciales de %s', (url) => {
    const redacted = redactUrlCredentials(`invalid source: '${url}' (x)`);

    expect(redacted).not.toMatch(/admin|user|Sup3rSecreta|p@ss|w0rd|clave/);
    expect(redacted).toContain('[redacted]');
    expect(redacted).toContain('invalid source');
  });

  it('redacta credenciales en la ruta o en la query (cámaras que las llevan ahí)', () => {
    const redacted = redactUrlCredentials(
      'rtsp://10.0.0.5:554/user=admin_password=xyz_channel=1 y http://10.0.0.6/cgi?user=admin&password=xyz',
    );

    expect(redacted).not.toMatch(/admin|xyz/);
    expect(redacted).toContain('rtsp://10.0.0.5:554/***');
    expect(redacted).toContain('http://10.0.0.6/***?***');
  });

  it('describeMediamtxErrorBody: solo el campo error, redactado y acotado; nunca el cuerpo crudo', () => {
    expect(
      describeMediamtxErrorBody({
        error: 'path already exists',
        source: 'rtsp://admin:secreta@10.0.0.5/stream',
      }),
    ).toBe('path already exists');
    expect(
      describeMediamtxErrorBody({
        error: 'invalid source rtsp://admin:secreta@10.0.0.5/s',
      }),
    ).toBe('invalid source rtsp://[redacted]');
    expect(describeMediamtxErrorBody({ source: 'x' })).toBeUndefined();
    expect(describeMediamtxErrorBody(undefined)).toBeUndefined();
    expect(
      describeMediamtxErrorBody('e'.repeat(500))?.length,
    ).toBeLessThanOrEqual(MAX_MEDIAMTX_ERROR_SUMMARY_LENGTH + 1);
  });

  it('cuerpo real de v1.15.2 con una fuente que no es URL: redacta igual', () => {
    const summary = describeMediamtxErrorBody({
      error: "invalid source: 'rtsp//admin:secreta@x'",
    });

    expect(summary).toBe("invalid source: '[redacted]'");
    expect(redactUrlCredentials('user:clave@10.0.0.5 caído')).toBe(
      '[redacted] caído',
    );
  });

  it('cuerpo JSON como texto (respuesta WHEP con responseType text): solo el campo error', () => {
    expect(
      describeMediamtxErrorBody(
        JSON.stringify({ error: "path 'porton-a' is not configured" }),
      ),
    ).toBe("path 'porton-a' is not configured");
  });
});

describe('isPathNotConfiguredError (Fase 4 · P6.M)', () => {
  function axiosError(status: number, data: unknown): Error {
    return Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status, data },
    });
  }

  it('reconoce la respuesta de MediaMTX tras reiniciarse (objeto o texto)', () => {
    expect(
      isPathNotConfiguredError(
        axiosError(
          400,
          JSON.stringify({ error: "path 'porton-a' is not configured" }),
        ),
      ),
    ).toBe(true);
    expect(
      isPathNotConfiguredError(
        axiosError(400, { error: "path 'porton-a' is not configured" }),
      ),
    ).toBe(true);
  });

  it('otros errores no', () => {
    expect(
      isPathNotConfiguredError(
        axiosError(404, { error: "no stream is available on path 'x'" }),
      ),
    ).toBe(false);
    expect(isPathNotConfiguredError(new Error('is not configured'))).toBe(
      false,
    );
  });
});

describe('redacción de MediaMTX con textos enormes (Fase 4 · P7, cyber)', () => {
  it('recorta antes del scrub: 1 MB sin espacios ni @ no bloquea (antes, cuadrático)', () => {
    const hostile = ':'.repeat(1024 * 1024);
    const started = Date.now();

    const redacted = redactUrlCredentials(hostile);
    const summary = describeMediamtxErrorBody({ error: hostile });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(redacted.length).toBeLessThanOrEqual(
      MAX_MEDIAMTX_REDACTION_INPUT_LENGTH,
    );
    expect(summary?.length ?? 0).toBeLessThanOrEqual(
      MAX_MEDIAMTX_ERROR_SUMMARY_LENGTH + 1,
    );
  });

  it('una credencial partida por el corte no se filtra (se descarta la última palabra)', () => {
    const filler = 'x '.repeat((MAX_MEDIAMTX_REDACTION_INPUT_LENGTH - 20) / 2);
    const text = `${filler}rtsp://admin:12345678@10.0.0.5:554/stream`;

    const redacted = redactUrlCredentials(text);

    expect(redacted).not.toContain('admin');
    expect(redacted).not.toContain('1234');
    expect(redacted.endsWith('[…]')).toBe(true);
    expect(redacted.length).toBeLessThanOrEqual(
      MAX_MEDIAMTX_REDACTION_INPUT_LENGTH,
    );
  });

  it('un texto dentro del límite se redacta igual que antes', () => {
    expect(redactUrlCredentials('src rtsp://a:b@h/s')).toBe(
      'src rtsp://[redacted]',
    );
  });
});
