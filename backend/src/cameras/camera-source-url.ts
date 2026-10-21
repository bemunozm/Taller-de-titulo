import { ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * Fase 4 · P6.M (cyber, corrección): esquemas aceptados para la URL de origen
 * de una cámara. MediaMTX acepta muchas fuentes (`udp+mpegts://0.0.0.0:...`
 * abre un listener en todas las interfaces, `unix+rtp://`, `whep://`,
 * `publisher`, ...); una cámara de Vigilia es siempre RTSP(S).
 */
export const ALLOWED_CAMERA_SOURCE_PROTOCOLS: readonly string[] = [
  'rtsp:',
  'rtsps:',
];

/**
 * Patrón: `rtsp://` o `rtsps://` + algo, sin espacios ni `"`, `'`, `<`, `>`
 * sin codificar.
 *
 * Fase 4 · P7.L (pendiente de P6.M): la redacción de la URL en los logs (y en
 * los errores que MediaMTX repite) corta en esos caracteres; una clave con
 * `"` o `>` dejaba su cola en el log. Una clave que los necesite se escribe
 * con codificación de URL (`%22`, `%27`, `%3C`, `%3E`, `%20`).
 */
export const CAMERA_SOURCE_URL_PATTERN = /^rtsps?:\/\/[^\s"'<>]+$/i;

/** ¿`value` es una URL `rtsp://` o `rtsps://` con host? */
export function isAllowedCameraSourceUrl(value: string): boolean {
  if (!CAMERA_SOURCE_URL_PATTERN.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      ALLOWED_CAMERA_SOURCE_PROTOCOLS.includes(url.protocol.toLowerCase()) &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

/** Decorador de class-validator: la URL de la fuente debe ser `rtsp://` o `rtsps://`. */
export function IsCameraSourceUrl(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCameraSourceUrl',
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === 'string' && isAllowedCameraSourceUrl(value),
        defaultMessage: (): string =>
          'La URL de la fuente debe ser rtsp:// o rtsps:// con un host',
      },
    },
    options,
  );
}
