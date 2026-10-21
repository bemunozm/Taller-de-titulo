/**
 * Fase 4 · P7.R: lectura de las URLs de entrega de Cloudinary. Sirve para
 * decidir si una imagen es NUESTRA (mismo *cloud name* que
 * `CLOUDINARY_CLOUD_NAME`) antes de pedir su borrado: una URL de otro cloud
 * (cargada por error o a propósito) nunca se borra con nuestras credenciales.
 *
 * Formas aceptadas (solo imágenes subidas, `image/upload`):
 *  - `https://res.cloudinary.com/<cloud>/image/upload/[<transf>/][v<n>/]<public_id>.<ext>`
 *    (también `res-1..5.cloudinary.com`);
 *  - `https://<cloud>-res.cloudinary.com/image/upload/...` (CDN privado).
 */

const CLOUDINARY_HOST_SUFFIX = 'cloudinary.com';
const PRIVATE_CDN_HOST = /^([a-z0-9_-]+)-res\.cloudinary\.com$/;

/** Imagen de Cloudinary: su cloud (en minúsculas) y su `public_id`. */
export interface CloudinaryImageRef {
  cloudName: string;
  publicId: string;
}

/** ¿Es una URL http(s)? (una ruta local no lo es). */
export function isRemoteUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Cloud y `public_id` de una URL de imagen de Cloudinary, o `null`. */
export function parseCloudinaryImageUrl(
  url: string,
): CloudinaryImageRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const isCloudinaryHost =
    host === CLOUDINARY_HOST_SUFFIX ||
    host.endsWith(`.${CLOUDINARY_HOST_SUFFIX}`);
  if (
    !isCloudinaryHost ||
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
  ) {
    return null;
  }
  let segments: string[];
  try {
    segments = parsed.pathname
      .split('/')
      .filter((segment) => segment !== '')
      .map((segment) => decodeURIComponent(segment));
  } catch {
    // Un `%` mal formado no es una URL que Cloudinary haya entregado.
    return null;
  }

  // CDN privado: el cloud va en el host y la ruta empieza en `image/upload`.
  const privateCdn = PRIVATE_CDN_HOST.exec(host);
  const cloudName = privateCdn ? privateCdn[1] : segments.shift();
  if (!cloudName || segments[0] !== 'image' || segments[1] !== 'upload') {
    return null;
  }
  const rest = segments.slice(2);
  const versionIndex = rest.findIndex((segment) => /^v\d+$/.test(segment));
  const idSegments = versionIndex === -1 ? rest : rest.slice(versionIndex + 1);
  if (idSegments.length === 0) {
    return null;
  }
  const last = idSegments[idSegments.length - 1];
  const dot = last.lastIndexOf('.');
  idSegments[idSegments.length - 1] = dot > 0 ? last.slice(0, dot) : last;
  const publicId = idSegments.join('/');
  return publicId === ''
    ? null
    : { cloudName: cloudName.toLowerCase(), publicId };
}

/** `public_id` de una URL de imagen de Cloudinary (de cualquier cloud), o `null`. */
export function cloudinaryPublicIdFromUrl(url: string): string | null {
  return parseCloudinaryImageUrl(url)?.publicId ?? null;
}
