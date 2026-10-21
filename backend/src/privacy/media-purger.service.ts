import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { isRemoteUrl, parseCloudinaryImageUrl } from './cloudinary-url';

export { cloudinaryPublicIdFromUrl } from './cloudinary-url';

/**
 * Qué pasó con el archivo de una imagen al purgarla:
 *  - `none`: no había archivo;
 *  - `local`: una ruta (no una URL), p. ej. del disco del LPR, que el propio
 *    LPR purga a los 7 días: no hay nada remoto que borrar y la referencia se
 *    puede quitar;
 *  - `deleted`: NUESTRO Cloudinary lo borró (o ya no existía);
 *  - `failed`: nuestro Cloudinary falló o no respondió a tiempo. Se conserva
 *    la referencia para reintentar en la próxima corrida (borrarla dejaría el
 *    archivo huérfano y sin forma de encontrarlo);
 *  - `foreign`: una URL que NO es de nuestro Cloudinary (otro *cloud name*,
 *    otro host, o `CLOUDINARY_CLOUD_NAME` sin configurar) o un `public_id`
 *    fuera de la carpeta de su categoría (`MEDIA_FOLDERS`). Nunca se llama a
 *    `destroy` (con nuestras credenciales podría borrar un archivo ajeno o
 *    confirmar uno que no existe) y la referencia se conserva para revisión.
 */
export type MediaPurgeOutcome =
  | 'none'
  | 'local'
  | 'deleted'
  | 'failed'
  | 'foreign';

/** Categoría de una imagen: decide en qué carpeta de Cloudinary puede estar. */
export type MediaCategory = 'lpr-frame' | 'profile-picture';

/**
 * Carpeta (prefijo del `public_id`) de cada categoría (Fase 4 · P7,
 * corrección cyber): solo se borra lo que está en la carpeta esperada. Una
 * URL de nuestro cloud que apunta a OTRA carpeta (p. ej. la foto de perfil de
 * otra persona puesta como frame) se trata como `foreign`.
 *  - `lpr-frames/`: frames que sube el LPR (`lpr/processor/worker.py`);
 *  - `profile-pictures/`: fotos de perfil (`CloudinaryService.uploadImage`).
 */
export const MEDIA_FOLDERS: Readonly<Record<MediaCategory, string>> =
  Object.freeze({
    'lpr-frame': 'lpr-frames/',
    'profile-picture': 'profile-pictures/',
  });

/** Resultado de purgar los archivos de un lote. */
export interface MediaBatchPurge {
  /** Ids cuya referencia ya se puede borrar (`none`/`local`/`deleted`). */
  clearableIds: string[];
  /** Ids cuya referencia se conserva (`failed` o `foreign`). */
  keptIds: string[];
  /** Archivos borrados en Cloudinary. */
  deleted: number;
  /** De `keptIds`, cuántos no son de nuestro Cloudinary (para revisión). */
  foreign: number;
}

/** Tope de espera por archivo: un Cloudinary colgado no frena el barrido. */
export const CLOUDINARY_DELETE_TIMEOUT_MS = 10_000;

/**
 * ¿Cloudinary confirmó el borrado? (`ok`, o `not found` si ya no estaba).
 * Solo se pregunta por archivos de NUESTRO cloud, así que `not found` es un
 * borrado previo y no un archivo ajeno.
 */
function isDestroyConfirmed(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  const status = (result as { result?: unknown }).result;
  return status === 'ok' || status === 'not found';
}

/**
 * Fase 4 · P7.R: borrado best-effort de las imágenes que la retención deja de
 * referenciar (frames del LPR y fotos de perfil). Solo borra en el Cloudinary
 * configurado (`CLOUDINARY_CLOUD_NAME`). Nunca lanza: un fallo solo se
 * cuenta. Los logs no llevan la URL ni el `public_id` (identifican a una
 * persona o a una patente).
 */
@Injectable()
export class MediaPurgerService {
  private readonly logger = new Logger(MediaPurgerService.name);
  private readonly ownCloudName: string | null;

  constructor(
    private readonly cloudinaryService: CloudinaryService,
    configService: ConfigService,
  ) {
    const configured = configService
      .get<string>('CLOUDINARY_CLOUD_NAME')
      ?.trim()
      .toLowerCase();
    this.ownCloudName = configured ? configured : null;
  }

  async purge(
    url: string | null | undefined,
    category: MediaCategory,
  ): Promise<MediaPurgeOutcome> {
    if (!url) {
      return 'none';
    }
    if (!isRemoteUrl(url)) {
      return 'local';
    }
    const image = parseCloudinaryImageUrl(url);
    if (!image || !this.ownCloudName || image.cloudName !== this.ownCloudName) {
      this.logger.warn(
        'Imagen fuera de nuestro Cloudinary: no se borra y su referencia queda para revisión manual',
      );
      return 'foreign';
    }
    if (!image.publicId.startsWith(MEDIA_FOLDERS[category])) {
      this.logger.warn(
        `Imagen de nuestro Cloudinary fuera de la carpeta esperada (${category}): no se borra y su referencia queda para revisión manual`,
      );
      return 'foreign';
    }
    try {
      const result = await this.withTimeout<unknown>(
        this.cloudinaryService.deleteImage(image.publicId),
      );
      if (isDestroyConfirmed(result)) {
        return 'deleted';
      }
      this.logger.warn(
        'Cloudinary no confirmó el borrado de una imagen; se reintenta en la próxima corrida',
      );
      return 'failed';
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar una imagen en Cloudinary (${error instanceof Error ? error.name : 'error'}); se reintenta en la próxima corrida`,
      );
      return 'failed';
    }
  }

  /** Purga el archivo de cada fila, en serie (sin ráfagas contra Cloudinary). */
  async purgeBatch(
    rows: ReadonlyArray<{ id: string; url: string | null }>,
    category: MediaCategory,
  ): Promise<MediaBatchPurge> {
    const outcome: MediaBatchPurge = {
      clearableIds: [],
      keptIds: [],
      deleted: 0,
      foreign: 0,
    };
    for (const row of rows) {
      const result = await this.purge(row.url, category);
      if (result === 'failed' || result === 'foreign') {
        outcome.keptIds.push(row.id);
        outcome.foreign += result === 'foreign' ? 1 : 0;
        continue;
      }
      if (result === 'deleted') {
        outcome.deleted += 1;
      }
      outcome.clearableIds.push(row.id);
    }
    return outcome;
  }

  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Cloudinary no respondió a tiempo')),
        CLOUDINARY_DELETE_TIMEOUT_MS,
      );
      // Fase 4 · P8: el guard de timeout no retiene el proceso por sí solo
      // (el request a Cloudinary sí, mientras esté vivo).
      timer.unref();
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
