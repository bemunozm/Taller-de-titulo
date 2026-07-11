import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Tarea #18: valida contra la tabla `verification` de better-auth
// (identifier `reset-password:<token>`) en vez de la tabla `Token` propia.
export class ValidateTokenDto {
    @ApiProperty({
        description: 'Token de recuperación de contraseña (link de reset de better-auth)',
        example: 'a1b2c3d4e5f6...'
    })
    @IsString({ message: 'El token debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El token es requerido' })
    token: string;
}