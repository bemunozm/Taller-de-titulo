import { IsBoolean, IsEmail, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateUserDto {
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    name: string;

    @IsEmail({}, { message: 'El correo electrónico no es válido' })
    email: string;

    @IsString({ message: 'La contraseña debe ser una cadena de texto' })
    password: string;

    @IsNumber({}, { message: 'La edad debe ser un número' })
    age: number;

    @IsOptional()
    @IsBoolean({ message: 'El estado de confirmación debe ser un booleano' })
    confirmed?: boolean;
}
