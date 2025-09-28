import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePasswordWithTokenDto {
    @ApiProperty({
        description: 'Token de recuperación de contraseña de 6 dígitos',
        example: '789012',
        minLength: 6,
        maxLength: 6
    })
    @IsString()
    @MinLength(6)
    @MaxLength(6)
    token: string;

    @ApiProperty({
        description: 'Nueva contraseña del usuario (mínimo 6 caracteres)',
        example: 'miNuevaPassword123',
        minLength: 6
    })
    @IsString()
    @MinLength(6)
    password: string;
}