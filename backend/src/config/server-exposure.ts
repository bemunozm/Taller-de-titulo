import { isLoopbackHost, parseBooleanFlag } from './env.validation';

/**
 * Exposición del servidor HTTP al arrancar (Fase 4 · P9): interfaz de escucha
 * frente a TRUST_PROXY y Swagger UI. Funciones puras: main.ts las aplica y
 * loguea.
 */

/**
 * Advertencia si se confía en `X-Forwarded-For` (TRUST_PROXY > 0) y el
 * servidor escucha en una interfaz NO loopback: si el puerto se alcanza sin
 * pasar por el proxy, cualquiera falsifica `X-Forwarded-For`, elige su IP y
 * anula el límite de login por IP (la barrera contra fuerza bruta). `null`
 * si no aplica.
 */
export function trustProxyExposureWarning(
  trustProxy: false | number,
  host: string,
): string | null {
  if (trustProxy === false || trustProxy <= 0 || isLoopbackHost(host)) {
    return null;
  }
  return (
    `TRUST_PROXY=${trustProxy} y HOST=${host}: con TRUST_PROXY activo el puerto debe ser accesible solo desde el proxy (firewall) o usar HOST=127.0.0.1. ` +
    'Si se llega directo al puerto, X-Forwarded-For se puede falsificar y el límite de login por IP deja de proteger.'
  );
}

/**
 * ¿Se monta Swagger UI (`/api`)? En producción, solo con
 * `SWAGGER_ENABLED=true` (la documentación lista toda la superficie de la
 * API). Fuera de producción, sí salvo `SWAGGER_ENABLED=false`. Lee
 * `NODE_ENV` y `SWAGGER_ENABLED`. Un valor que no sea true/false lanza
 * (fail-closed; `validateEnv` ya lo rechaza).
 */
export function isSwaggerEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return parseBooleanFlag(
    'SWAGGER_ENABLED',
    env.SWAGGER_ENABLED,
    env.NODE_ENV !== 'production',
  );
}
