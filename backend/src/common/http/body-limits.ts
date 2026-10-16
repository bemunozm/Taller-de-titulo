import { json, urlencoded } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { finished } from 'node:stream';
import {
  extractServiceApiKey,
  rememberServiceApiKeyVerification,
  type ServiceApiKeyVerification,
  type ServiceApiKeyVerifier,
} from '../../auth/service-api-key.verification';

/**
 * Fase 4 · P7 (corrección cyber ALTO, preexistente): límites del body.
 *
 * Antes TODAS las rutas aceptaban 10 MB de JSON. class-transformer (la
 * `ValidationPipe`) es cuadrático en la cantidad de claves: 2,3 MB con 200k
 * claves tardaban ~17 s, y una ruta PÚBLICA (`forgot-password`) bastaba para
 * dejar el backend sin servicio. Ahora:
 *  - 100 kb para todo (JSON y `urlencoded`); más grande responde 413;
 *  - 10 MB SOLO en la ingesta del LPR, que trae fotos en base64
 *    (`POST /api/v1/detections/plates` y `POST /api/v1/anomalies`), y solo
 *    con una API key de servicio VERIFICADA.
 *
 * Fase 4 · P9 (corrección cyber BAJO): antes bastaba con que la request
 * trajera cualquier `x-api-key` no vacía (`x-api-key: a`) para que un
 * cliente sin credenciales hiciera parsear 10 MB (JSON o `urlencoded`
 * extendido) antes del 401 del guard: CPU y memoria del proceso que abre el
 * portón. Ahora, en las rutas de ingesta con `x-api-key`, el middleware
 * verifica la key con el mismo mecanismo que `ServiceApiKeyGuard`
 * (auth/service-api-key.verification.ts) ANTES de leer el body:
 *  - key válida -> parser de 10 MB;
 *  - key inválida o error al verificar (fail-closed) -> NO se parsea el body
 *    (se lee y descarta sin acumularlo, para que el 401 llegue limpio): la
 *    request sigue sin `req.body` y el guard responde 401;
 *  - sin key -> parser general de 100 kb (y el guard responde 401).
 * El resultado queda en la request y el guard lo reutiliza: la key se
 * verifica UNA vez por request (verificar escribe en la fila `apikey`). El
 * guard sigue siendo la autoridad (también revalida el condominio).
 *
 * Las fotos de perfil van por multipart (multer, por ruta): no pasan por
 * acá.
 */

/** Límite general (JSON y `urlencoded`). */
export const DEFAULT_BODY_LIMIT = '100kb';

/** Límite de la ingesta del LPR (snapshot y frame en base64). */
export const INGESTION_BODY_LIMIT = '10mb';

/** Ruta con el límite grande: método y path completo (con el prefijo global). */
export interface LargeBodyRoute {
  method: 'POST';
  path: string;
}

/**
 * Únicas rutas con el límite grande. `POST /detections/plates/attempts` no
 * está: no lleva imágenes.
 */
export const LARGE_BODY_ROUTES: readonly LargeBodyRoute[] = Object.freeze([
  { method: 'POST', path: '/api/v1/detections/plates' },
  { method: 'POST', path: '/api/v1/anomalies' },
]);

/**
 * Path normalizado como lo enruta Express (sin query, sin `/` final y sin
 * distinguir mayúsculas), para no negarle el límite grande a la ingesta por
 * una diferencia que el router igual aceptaría.
 */
function routePath(originalUrl: string): string {
  const [path = ''] = originalUrl.split('?');
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return trimmed.toLowerCase();
}

/** ¿La request va a una ruta de ingesta (método y path)? */
export function isLargeBodyRoute(
  req: Pick<Request, 'method' | 'originalUrl'>,
): boolean {
  const method = req.method.toUpperCase();
  const path = routePath(req.originalUrl);
  return LARGE_BODY_ROUTES.some(
    (route) => route.method === method && route.path === path,
  );
}

/**
 * API key de servicio que decide el límite grande: solo en una ruta de
 * ingesta y con el mismo criterio que el guard (string no vacío).
 */
export function largeBodyApiKey(
  req: Pick<Request, 'method' | 'originalUrl' | 'headers'>,
): string | undefined {
  return isLargeBodyRoute(req) ? extractServiceApiKey(req.headers) : undefined;
}

/** Respuesta de un error del parser (sin repetir el contenido recibido). */
interface BodyErrorResponse {
  statusCode: number;
  message: string;
  error: string;
}

/**
 * Error de body-parser (`http-errors` con `type`, p. ej. `entity.too.large` o
 * `entity.parse.failed`) → respuesta JSON. Cualquier otro error sigue su
 * curso.
 */
export function bodyErrorResponse(error: unknown): BodyErrorResponse | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const { status, type } = error as { status?: unknown; type?: unknown };
  if (
    typeof status !== 'number' ||
    typeof type !== 'string' ||
    status < 400 ||
    status >= 500
  ) {
    return null;
  }
  if (status === 413) {
    return {
      statusCode: 413,
      message: 'El cuerpo de la solicitud supera el tamaño permitido',
      error: 'Payload Too Large',
    };
  }
  if (status === 415) {
    return {
      statusCode: 415,
      message: 'Codificación del cuerpo no soportada',
      error: 'Unsupported Media Type',
    };
  }
  return {
    statusCode: 400,
    message: 'El cuerpo de la solicitud no es válido',
    error: 'Bad Request',
  };
}

function respondOrForward(
  error: unknown,
  res: Response,
  next: NextFunction,
): void {
  const response = bodyErrorResponse(error);
  if (!response) {
    next(error);
    return;
  }
  res.status(response.statusCode).json(response);
}

/** Opciones del parser. */
export interface BodyParserMiddlewareOptions {
  /**
   * Prefijo que NO se parsea: better-auth (`/api/auth`) lee su propio stream
   * (`bodyParser: false` en `NestFactory.create`).
   */
  skipPathPrefix: string;
  /**
   * Verifica la API key de servicio de las rutas de ingesta, con el mismo
   * mecanismo que `ServiceApiKeyGuard` (`verifyServiceApiKey`, ver main.ts).
   */
  verifyServiceApiKey: ServiceApiKeyVerifier;
}

/** Par de parsers (JSON y `urlencoded`) con un mismo límite. */
interface BodyParsers {
  json: ReturnType<typeof json>;
  form: ReturnType<typeof urlencoded>;
}

function parsersWithLimit(limit: string): BodyParsers {
  return {
    json: json({ limit }),
    form: urlencoded({ extended: true, limit }),
  };
}

function parseBody(
  parsers: BodyParsers,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  parsers.json(req, res, (jsonError?: unknown) => {
    if (jsonError) {
      respondOrForward(jsonError, res, next);
      return;
    }
    parsers.form(req, res, (formError?: unknown) => {
      if (formError) {
        respondOrForward(formError, res, next);
        return;
      }
      next();
    });
  });
}

/**
 * Lee y DESCARTA el body sin acumularlo ni parsearlo (mismo criterio que
 * body-parser antes de su 413). Sin esto, el 401 del guard sale mientras el
 * cliente sigue subiendo y Node puede cortar la conexión (ECONNRESET) en vez
 * de entregar el 401. Resuelve también si el cliente aborta.
 */
function discardBody(req: Request): Promise<void> {
  return new Promise((resolve) => {
    finished(req, () => resolve());
    req.resume();
  });
}

/** Verifica sin lanzar: un error del verificador cuenta como `failed`. */
async function verifyFailClosed(
  verify: ServiceApiKeyVerifier,
  apiKey: string,
): Promise<ServiceApiKeyVerification> {
  try {
    return await verify(apiKey);
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parser de JSON y `urlencoded` de la app (main.ts), con el límite que
 * corresponde a cada ruta (ver arriba).
 */
export function createBodyParserMiddleware(
  options: BodyParserMiddlewareOptions,
): RequestHandler {
  const general = parsersWithLimit(DEFAULT_BODY_LIMIT);
  const ingestion = parsersWithLimit(INGESTION_BODY_LIMIT);

  async function parseIngestion(
    req: Request,
    res: Response,
    next: NextFunction,
    apiKey: string,
  ): Promise<void> {
    const verification = await verifyFailClosed(
      options.verifyServiceApiKey,
      apiKey,
    );
    rememberServiceApiKeyVerification(req, apiKey, verification);
    if (verification.status !== 'valid') {
      // Sin parsear (`req.body` queda sin definir): el guard reutiliza este
      // resultado y responde 401.
      await discardBody(req);
      next();
      return;
    }
    parseBody(ingestion, req, res, next);
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.originalUrl.startsWith(options.skipPathPrefix)) {
      next();
      return;
    }
    const apiKey = largeBodyApiKey(req);
    if (apiKey === undefined) {
      parseBody(general, req, res, next);
      return;
    }
    parseIngestion(req, res, next, apiKey).catch((error: unknown) => {
      next(error);
    });
  };
}
