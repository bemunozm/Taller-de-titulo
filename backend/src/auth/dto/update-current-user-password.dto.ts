import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCurrentUserPasswordDto {
    @ApiProperty({
        description: 'Contraseña actual del usuario (requerida para verificación)',
        example: 'miPasswordActual123',
        minLength: 6
    })
    @IsString()
    @MinLength(6)
    current_password: string;

    @ApiProperty({
        description: 'Nueva contraseña del usuario (mínimo 6 caracteres)',
        example: 'miNuevaPassword456',
        minLength: 6
    })
    @IsString()
    @MinLength(6)
    password: string;
}