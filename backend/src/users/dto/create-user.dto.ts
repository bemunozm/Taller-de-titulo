import { IsBoolean, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {

    @ApiProperty({
        description: 'RUT del usuario (identificador único chileno)',
        example: '12345678-9',
        maxLength: 50,
        type: 'string'
    })
    @IsString({ message: 'El RUT debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El RUT no puede exceder los 50 caracteres' })
    @IsNotEmpty({ message: 'El RUT es obligatorio' })
    rut: string;

    @ApiProperty({
        description: 'Nombre completo del usuario',
        example: 'Juan Carlos Pérez González',
        maxLength: 100,
        type: 'string'
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    name: string;

    @ApiProperty({
        description: 'Correo electrónico del usuario (debe ser único)',
        example: 'juan.perez@universidad.cl',
        format: 'email',
        type: 'string'
    })
    @IsEmail({}, { message: 'El correo electrónico no es válido' })
    @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
    email: string;

    @ApiProperty({
        description: 'Contraseña del usuario (será encriptada antes de almacenarse)',
        example: 'MiContraseñaSegura123!',
        minLength: 6,
        type: 'string',
        format: 'password'
    })
    @IsString({ message: 'La contraseña debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'La contraseña es obligatoria' })
    password: string;

    @ApiProperty({
        description: 'Edad del usuario en años',
        example: 22,
        minimum: 16,
        maximum: 100,
        type: 'integer',
        required: false
    })
    @IsNumber({}, { message: 'La edad debe ser un número' })
    @IsOptional()
    age?: number;

    @ApiProperty({
        description: 'Estado de confirmación del usuario (true si ha verificado su email)',
        example: false,
        default: false,
        type: 'boolean',
        required: false
    })
    @IsOptional()
    @IsBoolean({ message: 'El estado de confirmación debe ser un booleano' })
    confirmed?: boolean;
}
