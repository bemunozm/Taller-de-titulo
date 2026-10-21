import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateUserDto } from './update-user.dto';

/**
 * Fase 4 · P7 (corrección cyber B1): `PATCH /users/:id` ya no acepta
 * `profilePicture`. Con una URL cualquiera en la foto de OTRO usuario, la
 * anonimización terminaba borrando ese archivo en Cloudinary. La foto solo
 * se sube por `POST /auth/upload-profile-picture`.
 */
describe('UpdateUserDto (Fase 4 · P7)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  function validate(body: Record<string, unknown>) {
    return pipe.transform(body, { type: 'body', metatype: UpdateUserDto });
  }

  it.each([
    'https://res.cloudinary.com/vigilia/image/upload/v1/profile-pictures/otro.jpg',
    'https://evil.example.com/x.jpg',
    null,
  ])('profilePicture=%p -> 400 (no está en el DTO)', async (value) => {
    await expect(
      validate({ name: 'Ana', profilePicture: value }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el resto del DTO sigue igual', async () => {
    await expect(validate({ name: 'Ana', age: 30 })).resolves.toMatchObject({
      name: 'Ana',
      age: 30,
    });
  });
});
