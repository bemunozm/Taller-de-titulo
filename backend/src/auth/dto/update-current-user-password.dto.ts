import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Cambio de contraseña con sesión activa. Lo aplica better-auth
 * (`auth.api.changePassword`), así que la nueva contraseña sigue sus límites
 * por defecto (8 a 128 caracteres), igual que `UpdatePasswordWithTokenDto`.
 */
export class UpdateCurrentUserPasswordDto {
  @ApiProperty({
    description: 'Contraseña actual del usuario (requerida para verificación)',
    example: 'miPasswordActual123',
    minLength: 6,
  })
  @IsString({ message: 'La contraseña actual debe ser una cadena de texto' })
  @MinLength(6, {
    message: 'La contraseña actual debe tener al menos 6 caracteres',
  })
  current_password: string;

  @ApiProperty({
    description: 'Nueva contraseña del usuario (8 a 128 caracteres)',
    example: 'miNuevaPassword456',
    minLength: 8,
    maxLength: 128,
  })
  @IsString({ message: 'La nueva contraseña debe ser una cadena de texto' })
  @MinLength(8, {
    message: 'La nueva contraseña debe tener al menos 8 caracteres',
  })
  @MaxLength(128, {
    message: 'La nueva contraseña no puede superar los 128 caracteres',
  })
  password: string;
}
