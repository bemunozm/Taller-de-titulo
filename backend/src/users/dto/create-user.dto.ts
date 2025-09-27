import { IsBoolean, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateUserDto {

    @IsString({ message: 'El RUT debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El RUT no puede exceder los 50 caracteres' })
    @IsNotEmpty({ message: 'El RUT es obligatorio' })
    rut: string;

    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    name: string;

    @IsEmail({}, { message: 'El correo electrónico no es válido' })
    @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
    email: string;

    @IsString({ message: 'La contraseña debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'La contraseña es obligatoria' })
    password: string;

    @IsNumber({}, { message: 'La edad debe ser un número' })
    @IsOptional()
    age?: number;

    @IsOptional()
    @IsBoolean({ message: 'El estado de confirmación debe ser un booleano' })
    confirmed?: boolean;
}
