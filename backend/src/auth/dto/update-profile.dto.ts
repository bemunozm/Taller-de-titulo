import { IsString, IsEmail, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
    @ApiProperty({
        description: 'Nuevo nombre completo del usuario',
        example: 'Juan Carlos Pérez González',
        minLength: 1
    })
    @IsString()
    @MinLength(1)
    name: string;

    @ApiProperty({
        description: 'Nuevo correo electrónico del usuario (debe ser único en el sistema)',
        example: 'juan.carlos@example.com',
        format: 'email'
    })
    @IsEmail()
    email: string;
}