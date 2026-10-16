import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { MediaPurgerService } from './media-purger.service';

/** Resultado de anonimizar una cuenta deshabilitada. */
export interface DisabledUserAnonymization {
  /** La cuenta ya estaba anonimizada antes de esta llamada. */
  alreadyAnonymized: boolean;
  /** Fotos borradas en Cloudinary. */
  picturesDeleted: number;
  /**
   * Alguna foto quedó con su URL: Cloudinary falló, no es de nuestro cloud o
   * se difirió (`deferPictures`). La retención la reintenta en su próxima
   * corrida; el resto de la cuenta quedó anonimizada igual.
   */
  picturePending: boolean;
}

/** Opciones de una anonimización. */
export interface DisabledUserAnonymizationOptions {
  /**
   * No llamar a Cloudinary ahora: las fotos quedan encoladas para la próxima
   * corrida de retención (la supresión por HTTP no espera a la red;
   * corrección P7, cyber B7).
   */
  deferPictures?: boolean;
}

/**
 * Fase 4 · P7.R (docs/modulos/privacidad-ley-21719.md §3/§4): anonimiza una
 * cuenta deshabilitada. Primero intenta borrar sus fotos en Cloudinary
 * (best-effort, solo de nuestro cloud) y después delega en
 * `UsersService.anonymizeDisabledUser` la escritura en la BD; si alguna foto
 * no se borró, sus URLs se conservan para reintentar. Lo usan la retención (a
 * los RETENTION_DISABLED_USERS_DAYS de la baja) y la supresión inmediata por
 * la administración (con `deferPictures`).
 */
@Injectable()
export class DisabledUserAnonymizer {
  constructor(
    private readonly usersService: UsersService,
    private readonly mediaPurger: MediaPurgerService,
  ) {}

  /** 404 si no existe; 409 si la cuenta no está deshabilitada. */
  async anonymize(
    userId: string,
    options: DisabledUserAnonymizationOptions = {},
  ): Promise<DisabledUserAnonymization> {
    const target = await this.usersService.findAnonymizationTarget(userId);
    const pictures = [
      ...new Set(
        [target.profilePicture, target.image].filter(
          (url): url is string => typeof url === 'string' && url !== '',
        ),
      ),
    ];
    let picturesDeleted = 0;
    let picturePending = false;
    if (options.deferPictures) {
      picturePending = pictures.length > 0;
    } else if (target.disabled) {
      // Sin cuenta deshabilitada no se borra nada (ni en Cloudinary):
      // `anonymizeDisabledUser` responde 409 sin tocar la BD.
      for (const url of pictures) {
        const outcome = await this.mediaPurger.purge(url, 'profile-picture');
        if (outcome === 'deleted') {
          picturesDeleted += 1;
        } else if (outcome === 'failed' || outcome === 'foreign') {
          picturePending = true;
        }
      }
    }
    await this.usersService.anonymizeDisabledUser(userId, {
      keepPictures: picturePending,
    });
    return {
      alreadyAnonymized: target.anonymizedAt !== null,
      picturesDeleted,
      picturePending,
    };
  }
}
