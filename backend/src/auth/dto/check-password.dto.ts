import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckPasswordDto {
    @ApiProperty({
        description: 'Contraseña actual del usuario para verificación',
        example: 'miPasswordActual123',
        minLength: 6
    })
    @IsString({ message: 'La contraseña debe ser una cadena de texto' })
    @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
    password: string;
}