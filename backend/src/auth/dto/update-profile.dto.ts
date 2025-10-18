import { IsString, IsEmail, MinLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
    @ApiProperty({
        description: 'Nuevo nombre completo del usuario',
        example: 'Juan Carlos Pérez González',
        minLength: 1
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    name: string;

    @ApiProperty({
        description: 'Nuevo correo electrónico del usuario (debe ser único en el sistema)',
        example: 'juan.carlos@example.com',
        format: 'email'
    })
    @IsEmail({}, { message: 'El correo electrónico debe tener un formato válido' })
    email: string;
}