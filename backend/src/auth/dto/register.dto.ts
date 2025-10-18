import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty, IsNumber, IsString, MinLength, Validate, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

@ValidatorConstraint({ name: 'PasswordMatch', async: false })
export class PasswordMatchConstraint implements ValidatorConstraintInterface {
  validate(password_confirmation: string, args: ValidationArguments) {
    const object = args.object as RegisterDto;
    return object.password === password_confirmation;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Las contraseñas no coinciden';
  }
}

export class RegisterDto {

    @ApiProperty({
        description: 'RUT del usuario (con guión y dígito verificador)',
        example: '12345678-9'
    })
    @IsString({ message: 'El RUT debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El RUT es obligatorio' })
    rut:string;

    @ApiProperty({
        description: 'Nombre completo del usuario',
        example: 'Juan Pérez González'
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    name: string;

    @ApiProperty({
        description: 'Correo electrónico del usuario (debe ser único)',
        example: 'juan.perez@example.com',
        format: 'email'
    })
    @IsEmail({}, { message: 'El correo electrónico debe tener un formato válido' })
    email: string;

    @ApiProperty({
        description: 'Número de teléfono del usuario',
        example: '+56912345678'
    })
    @IsString({ message: 'El número de teléfono debe ser una cadena de texto' })
    @IsNotEmpty({ message: 'El número de teléfono es obligatorio' })
    phone: string;

    @ApiProperty({
        description: 'Contraseña del usuario (mínimo 6 caracteres)',
        example: 'miPassword123',
        minLength: 6
    })
    @IsString({ message: 'La contraseña debe ser una cadena de texto' })
    @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
    @Transform(({ value }) => value.trim())
    password: string;

    @ApiProperty({
        description: 'Confirmación de la contraseña (debe coincidir con password)',
        example: 'miPassword123',
        minLength: 6
    })
    @IsString({ message: 'La confirmación de la contraseña debe ser una cadena de texto' })
    @MinLength(6, { message: 'La confirmación de la contraseña debe tener al menos 6 caracteres' })
    @Validate(PasswordMatchConstraint)
    @Transform(({ value }) => value.trim())
    password_confirmation: string;

    @ApiProperty({
        description: 'Edad del usuario',
        example: 25,
        minimum: 1,
        maximum: 120
    })
    @IsNumber({}, { message: 'La edad debe ser un número' })
    @IsNotEmpty({ message: 'La edad es obligatoria' })
    age: number;
}