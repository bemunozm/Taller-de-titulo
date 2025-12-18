import { IsString, IsEmail, IsOptional, IsInt, Min, Max, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
    @ApiPropertyOptional({
        description: 'Nuevo nombre completo del usuario',
        example: 'Juan Carlos Pérez González',
        minLength: 2
    })
    @IsOptional()
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
    name?: string;

    @ApiPropertyOptional({
        description: 'Nuevo correo electrónico del usuario (debe ser único en el sistema)',
        example: 'juan.carlos@example.com',
        format: 'email'
    })
    @IsOptional()
    @IsEmail({}, { message: 'El correo electrónico debe tener un formato válido' })
    email?: string;

    @ApiPropertyOptional({
        description: 'Número de teléfono del usuario',
        example: '+56912345678'
    })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({
        description: 'Edad del usuario',
        example: 25,
        minimum: 1,
        maximum: 150
    })
    @IsOptional()
    @IsInt({ message: 'La edad debe ser un número entero' })
    @Min(1, { message: 'La edad debe ser mayor a 0' })
    @Max(150, { message: 'La edad debe ser menor a 150' })
    age?: number;
}