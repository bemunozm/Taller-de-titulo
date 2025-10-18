import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCurrentUserPasswordDto {
    @ApiProperty({
        description: 'Contraseña actual del usuario (requerida para verificación)',
        example: 'miPasswordActual123',
        minLength: 6
    })
    @IsString({ message: 'La contraseña actual debe ser una cadena de texto' })
    @MinLength(6, { message: 'La contraseña actual debe tener al menos 6 caracteres' })
    current_password: string;

    @ApiProperty({
        description: 'Nueva contraseña del usuario (mínimo 6 caracteres)',
        example: 'miNuevaPassword456',
        minLength: 6
    })
    @IsString({ message: 'La nueva contraseña debe ser una cadena de texto' })
    @MinLength(6, { message: 'La nueva contraseña debe tener al menos 6 caracteres' })
    password: string;
}