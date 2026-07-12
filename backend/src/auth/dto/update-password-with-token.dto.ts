import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Tarea #18 (docs/modulos/auth-multitenant.md): reset-password ahora delega
// en `auth.api.resetPassword` de better-auth (token opaco de un solo uso, no
// un código de 6 dígitos) — ver AuthService.updatePasswordWithToken. El
// mínimo de la contraseña se alinea con el default de better-auth
// (`minPasswordLength: 8`) para no reportar un error distinto al de la propia
// librería.
export class UpdatePasswordWithTokenDto {
    @ApiProperty({
        description: 'Token de recuperación de contraseña (link de reset de better-auth)',
        example: 'a1b2c3d4e5f6...'
    })
    @IsString({ message: 'El token debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El token es requerido' })
    token: string;

    @ApiProperty({
        description: 'Nueva contraseña del usuario (mínimo 8 caracteres)',
        example: 'miNuevaPassword123',
        minLength: 8
    })
    @IsString({ message: 'La nueva contraseña debe ser una cadena de texto' })
    @MinLength(8, { message: 'La nueva contraseña debe tener al menos 8 caracteres' })
    password: string;
}