import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Tarea #18 (docs/modulos/auth-multitenant.md): confirmAccount ahora delega en
// la verificación nativa de better-auth (JWT firmado, no un código de 6
// dígitos) — ver AuthService.confirmAccount / better-auth.ts
// `emailVerification`. El token ya no tiene longitud fija.
export class ConfirmAccountDto {
    @ApiProperty({
        description: 'Token de verificación enviado por email (link de confirmación de better-auth)',
        example: 'eyJhbGciOiJIUzI1NiJ9...'
    })
    @IsString({ message: 'El token debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El token es requerido' })
    token: string;
}