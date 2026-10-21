import { ConflictException } from '@nestjs/common';
import type { AnonymizationTarget, UsersService } from '../users/users.service';
import { DisabledUserAnonymizer } from './disabled-user-anonymizer.service';
import type {
  MediaPurgeOutcome,
  MediaPurgerService,
} from './media-purger.service';

const USER_ID = '2d7f8f57-4b8c-4b75-9f38-7dab5a5e2c03';
const PHOTO =
  'https://res.cloudinary.com/demo/image/upload/v1/profile-pictures/a.jpg';
const AVATAR =
  'https://res.cloudinary.com/demo/image/upload/v1/profile-pictures/b.jpg';

function target(overrides: Partial<AnonymizationTarget> = {}) {
  return {
    id: USER_ID,
    disabled: true,
    anonymizedAt: null,
    profilePicture: PHOTO,
    image: null,
    ...overrides,
  } satisfies AnonymizationTarget;
}

describe('DisabledUserAnonymizer (Fase 4 · P7.R)', () => {
  let findAnonymizationTarget: jest.Mock;
  let anonymizeDisabledUser: jest.Mock;
  let purge: jest.Mock<Promise<MediaPurgeOutcome>, [string, string]>;
  let anonymizer: DisabledUserAnonymizer;

  beforeEach(() => {
    findAnonymizationTarget = jest.fn().mockResolvedValue(target());
    anonymizeDisabledUser = jest.fn().mockResolvedValue(undefined);
    purge = jest
      .fn<Promise<MediaPurgeOutcome>, [string, string]>()
      .mockResolvedValue('deleted');
    anonymizer = new DisabledUserAnonymizer(
      {
        findAnonymizationTarget,
        anonymizeDisabledUser,
      } as unknown as UsersService,
      { purge } as unknown as MediaPurgerService,
    );
  });

  it('borra las fotos en Cloudinary y después anonimiza sin conservarlas', async () => {
    findAnonymizationTarget.mockResolvedValueOnce(target({ image: AVATAR }));

    await expect(anonymizer.anonymize(USER_ID)).resolves.toEqual({
      alreadyAnonymized: false,
      picturesDeleted: 2,
      picturePending: false,
    });
    expect(purge.mock.calls).toEqual([
      [PHOTO, 'profile-picture'],
      [AVATAR, 'profile-picture'],
    ]);
    expect(anonymizeDisabledUser).toHaveBeenCalledWith(USER_ID, {
      keepPictures: false,
    });
    expect(purge.mock.invocationCallOrder[1]).toBeLessThan(
      anonymizeDisabledUser.mock.invocationCallOrder[0],
    );
  });

  it('Cloudinary falla: anonimiza igual pero conserva la URL para reintentar', async () => {
    purge.mockResolvedValueOnce('failed');

    await expect(anonymizer.anonymize(USER_ID)).resolves.toEqual({
      alreadyAnonymized: false,
      picturesDeleted: 0,
      picturePending: true,
    });
    expect(anonymizeDisabledUser).toHaveBeenCalledWith(USER_ID, {
      keepPictures: true,
    });
  });

  it('la misma URL en las dos columnas se borra una vez', async () => {
    findAnonymizationTarget.mockResolvedValueOnce(target({ image: PHOTO }));

    await anonymizer.anonymize(USER_ID);

    expect(purge).toHaveBeenCalledTimes(1);
  });

  it('cuenta activa: no toca Cloudinary y el 409 de UsersService se propaga', async () => {
    findAnonymizationTarget.mockResolvedValueOnce(target({ disabled: false }));
    anonymizeDisabledUser.mockRejectedValueOnce(
      new ConflictException('deshabilitada'),
    );

    await expect(anonymizer.anonymize(USER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(purge).not.toHaveBeenCalled();
  });

  it('cuenta ya anonimizada (reintento de la foto): lo informa', async () => {
    findAnonymizationTarget.mockResolvedValueOnce(
      target({ anonymizedAt: new Date('2026-09-01T00:00:00Z') }),
    );

    await expect(anonymizer.anonymize(USER_ID)).resolves.toMatchObject({
      alreadyAnonymized: true,
      picturesDeleted: 1,
    });
  });

  it('imagen fuera de nuestro Cloudinary: no se borra y la URL se conserva (revisión)', async () => {
    purge.mockResolvedValueOnce('foreign');

    await expect(anonymizer.anonymize(USER_ID)).resolves.toMatchObject({
      picturesDeleted: 0,
      picturePending: true,
    });
    expect(anonymizeDisabledUser).toHaveBeenCalledWith(USER_ID, {
      keepPictures: true,
    });
  });

  it('deferPictures (supresión por HTTP): no llama a Cloudinary y deja las fotos encoladas', async () => {
    await expect(
      anonymizer.anonymize(USER_ID, { deferPictures: true }),
    ).resolves.toEqual({
      alreadyAnonymized: false,
      picturesDeleted: 0,
      picturePending: true,
    });
    expect(purge).not.toHaveBeenCalled();
    expect(anonymizeDisabledUser).toHaveBeenCalledWith(USER_ID, {
      keepPictures: true,
    });
  });

  it('deferPictures sin fotos: nada pendiente', async () => {
    findAnonymizationTarget.mockResolvedValueOnce(
      target({ profilePicture: null }),
    );

    await expect(
      anonymizer.anonymize(USER_ID, { deferPictures: true }),
    ).resolves.toMatchObject({ picturePending: false });
    expect(anonymizeDisabledUser).toHaveBeenCalledWith(USER_ID, {
      keepPictures: false,
    });
  });
});
