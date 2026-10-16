import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  cloudinaryPublicIdFromUrl,
  isRemoteUrl,
  parseCloudinaryImageUrl,
} from './cloudinary-url';
import {
  CLOUDINARY_DELETE_TIMEOUT_MS,
  MEDIA_FOLDERS,
  MediaPurgerService,
} from './media-purger.service';

describe('parseCloudinaryImageUrl (Fase 4 · P7.R)', () => {
  it.each([
    [
      'https://res.cloudinary.com/demo/image/upload/v1712345678/profile-pictures/abc123.jpg',
      { cloudName: 'demo', publicId: 'profile-pictures/abc123' },
    ],
    [
      'https://res.cloudinary.com/Demo/image/upload/v1/lpr/frames/2026/10/09/cam-1_frame.png',
      { cloudName: 'demo', publicId: 'lpr/frames/2026/10/09/cam-1_frame' },
    ],
    [
      'https://res.cloudinary.com/demo/image/upload/c_fill,w_500/v99/folder/photo.webp',
      { cloudName: 'demo', publicId: 'folder/photo' },
    ],
    [
      'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      { cloudName: 'demo', publicId: 'sample' },
    ],
    [
      'https://res-3.cloudinary.com/demo/image/upload/v2/a%20b/foto.jpg',
      { cloudName: 'demo', publicId: 'a b/foto' },
    ],
    // CDN privado: el cloud va en el host.
    [
      'https://demo-res.cloudinary.com/image/upload/v2/lpr/x.jpg',
      { cloudName: 'demo', publicId: 'lpr/x' },
    ],
  ])('%s', (url, expected) => {
    expect(parseCloudinaryImageUrl(url)).toEqual(expected);
    expect(cloudinaryPublicIdFromUrl(url)).toBe(expected.publicId);
  });

  it.each([
    '/var/lpr/frames/2026-10-09/frame.jpg',
    'frames/frame.jpg',
    'https://evil.example.com/demo/image/upload/v1/x.jpg',
    'https://cloudinary.com.evil.test/demo/image/upload/v1/x.jpg',
    'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
    'https://res.cloudinary.com/demo/image/upload/',
    'ftp://res.cloudinary.com/demo/image/upload/v1/x.jpg',
    'https://res.cloudinary.com/demo/image/upload/v1/%E0%A4%A.jpg',
    '',
  ])('%p no es una imagen de Cloudinary -> null', (url) => {
    expect(parseCloudinaryImageUrl(url)).toBeNull();
  });

  it('isRemoteUrl: solo http(s)', () => {
    expect(isRemoteUrl('https://x.test/a.jpg')).toBe(true);
    expect(isRemoteUrl('http://x.test/a.jpg')).toBe(true);
    expect(isRemoteUrl('/var/lpr/a.jpg')).toBe(false);
    expect(isRemoteUrl('C:\\lpr\\a.jpg')).toBe(false);
    expect(isRemoteUrl('ftp://x.test/a.jpg')).toBe(false);
  });
});

describe('MediaPurgerService (Fase 4 · P7.R)', () => {
  const FRAME_URL =
    'https://res.cloudinary.com/vigilia/image/upload/v1/lpr-frames/cam-1_det_1.jpg';
  const PHOTO_URL =
    'https://res.cloudinary.com/vigilia/image/upload/v1/profile-pictures/ana.jpg';
  const FOREIGN_CLOUD_URL =
    'https://res.cloudinary.com/otro-cloud/image/upload/v1/lpr-frames/cam-1_det_1.jpg';
  let deleteImage: jest.Mock<Promise<unknown>, [string]>;
  let warn: jest.SpyInstance;

  function build(cloudName: string | null = 'Vigilia') {
    return new MediaPurgerService(
      { deleteImage } as unknown as CloudinaryService,
      {
        get: (name: string) =>
          name === 'CLOUDINARY_CLOUD_NAME'
            ? (cloudName ?? undefined)
            : undefined,
      } as unknown as ConfigService,
    );
  }

  function warned(): string {
    return (warn.mock.calls as unknown[][])
      .map((call) => String(call[0]))
      .join('\n');
  }

  beforeEach(() => {
    deleteImage = jest.fn<Promise<unknown>, [string]>();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('las carpetas por categoría son las del LPR y las de las fotos de perfil', () => {
    expect(MEDIA_FOLDERS).toEqual({
      'lpr-frame': 'lpr-frames/',
      'profile-picture': 'profile-pictures/',
    });
  });

  it('sin URL -> none; ruta local -> local (sin llamar a Cloudinary)', async () => {
    const service = build();
    await expect(service.purge(null, 'lpr-frame')).resolves.toBe('none');
    await expect(service.purge('', 'lpr-frame')).resolves.toBe('none');
    await expect(
      service.purge('/var/lpr/frames/x.jpg', 'lpr-frame'),
    ).resolves.toBe('local');
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it.each([{ result: 'ok' }, { result: 'not found' }])(
    'nuestro cloud y la carpeta de la categoría, Cloudinary responde %p -> deleted',
    async (response) => {
      deleteImage.mockResolvedValueOnce(response);

      await expect(build().purge(FRAME_URL, 'lpr-frame')).resolves.toBe(
        'deleted',
      );
      expect(deleteImage).toHaveBeenCalledWith('lpr-frames/cam-1_det_1');
    },
  );

  it('foto de perfil en profile-pictures/ -> deleted', async () => {
    deleteImage.mockResolvedValueOnce({ result: 'ok' });

    await expect(build().purge(PHOTO_URL, 'profile-picture')).resolves.toBe(
      'deleted',
    );
    expect(deleteImage).toHaveBeenCalledWith('profile-pictures/ana');
  });

  it.each([
    ['otro cloud name', FOREIGN_CLOUD_URL, 'vigilia', 'lpr-frame'],
    [
      'otro host',
      'https://imgs.example.com/lpr-frames/frame-1.jpg',
      'vigilia',
      'lpr-frame',
    ],
    ['CLOUDINARY_CLOUD_NAME sin configurar', FRAME_URL, null, 'lpr-frame'],
    // Misma cuenta, otra carpeta: p. ej. la foto de perfil de OTRA persona
    // puesta como frame, o un frame puesto como foto de perfil.
    ['foto de perfil como frame', PHOTO_URL, 'vigilia', 'lpr-frame'],
    ['frame como foto de perfil', FRAME_URL, 'vigilia', 'profile-picture'],
    [
      'carpeta con el mismo comienzo',
      'https://res.cloudinary.com/vigilia/image/upload/v1/lpr-frames-otros/x.jpg',
      'vigilia',
      'lpr-frame',
    ],
    [
      'frame antiguo sin carpeta',
      'https://res.cloudinary.com/vigilia/image/upload/v1/cam-1_det_1.jpg',
      'vigilia',
      'lpr-frame',
    ],
  ] as const)(
    '%s -> foreign: no llama a destroy y conserva la referencia',
    async (_case, url, cloudName, category) => {
      await expect(build(cloudName).purge(url, category)).resolves.toBe(
        'foreign',
      );
      expect(deleteImage).not.toHaveBeenCalled();
      expect(warned()).toMatch(/fuera de (nuestro Cloudinary|la carpeta)/);
      expect(warned()).not.toContain('cam-1_det');
      expect(warned()).not.toContain('pictures/ana');
      expect(warned()).not.toContain('otro-cloud');
    },
  );

  it('Cloudinary no confirma -> failed (sin lanzar)', async () => {
    deleteImage.mockResolvedValueOnce({ result: 'error' });

    await expect(build().purge(FRAME_URL, 'lpr-frame')).resolves.toBe('failed');
  });

  it('Cloudinary lanza -> failed, y el log no lleva la URL ni el public_id', async () => {
    deleteImage.mockRejectedValueOnce(
      new Error('Resource lpr-frames/cam-1_det_1 cannot be deleted'),
    );

    await expect(build().purge(FRAME_URL, 'lpr-frame')).resolves.toBe('failed');
    expect(warned()).not.toContain('cam-1_det_1');
    expect(warned()).not.toContain('cloudinary.com');
  });

  it('Cloudinary colgado -> failed al vencer el tope de espera', async () => {
    jest.useFakeTimers();
    deleteImage.mockReturnValueOnce(new Promise(() => undefined));

    const outcome = build().purge(FRAME_URL, 'lpr-frame');
    await jest.advanceTimersByTimeAsync(CLOUDINARY_DELETE_TIMEOUT_MS);

    await expect(outcome).resolves.toBe('failed');
  });

  it('purgeBatch: separa lo que se puede limpiar de lo que se conserva', async () => {
    deleteImage
      .mockResolvedValueOnce({ result: 'ok' })
      .mockRejectedValueOnce(new Error('503'));

    const outcome = await build().purgeBatch(
      [
        { id: 'local', url: '/frames/a.jpg' },
        { id: 'ok', url: FRAME_URL },
        {
          id: 'ko',
          url: 'https://res.cloudinary.com/vigilia/image/upload/v1/lpr-frames/cam-1_det_2.jpg',
        },
        { id: 'foreign', url: FOREIGN_CLOUD_URL },
        { id: 'wrong-folder', url: PHOTO_URL },
        { id: 'none', url: null },
      ],
      'lpr-frame',
    );

    expect(outcome).toEqual({
      clearableIds: ['local', 'ok', 'none'],
      keptIds: ['ko', 'foreign', 'wrong-folder'],
      deleted: 1,
      foreign: 2,
    });
    expect(deleteImage).toHaveBeenCalledTimes(2);
  });
});
