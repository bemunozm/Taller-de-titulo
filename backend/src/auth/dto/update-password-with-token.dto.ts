import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePasswordWithTokenDto {
    @ApiProperty({
        description: 'Token de recuperación de contraseña de 6 dígitos',
        example: '789012',
        minLength: 6,
        maxLength: 6
    })
    @IsString({ message: 'El token debe ser una cadena de texto' })
    @MinLength(6, { message: 'El token debe tener al menos 6 caracteres' })
    @MaxLength(6, { message: 'El token debe tener exactamente 6 caracteres' })
    token: string;

    @ApiProperty({
        description: 'Nueva contraseña del usuario (mínimo 6 caracteres)',
        example: 'miNuevaPassword123',
        minLength: 6
    })
    @IsString({ message: 'La nueva contraseña debe ser una cadena de texto' })
    @MinLength(6, { message: 'La nueva contraseña debe tener al menos 6 caracteres' })
    password: string;
}