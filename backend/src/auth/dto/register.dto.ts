import { Transform } from "class-transformer";
import { IsEmail, IsNumber, IsString, MinLength, Validate, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";
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
        example: '12345678-9',
        minLength: 1
    })
    @IsString()
    @MinLength(1)
    rut:string;

    @ApiProperty({
        description: 'Nombre completo del usuario',
        example: 'Juan Pérez González',
        minLength: 1
    })
    @IsString()
    @MinLength(1)
    name: string;

    @ApiProperty({
        description: 'Correo electrónico del usuario (debe ser único)',
        example: 'juan.perez@example.com',
        format: 'email'
    })
    @IsEmail()
    email: string;

    @ApiProperty({
        description: 'Número de teléfono del usuario',
        example: '+56912345678',
        minLength: 1
    })
    @IsString()
    @MinLength(1)
    phone: string;

    @ApiProperty({
        description: 'Contraseña del usuario (mínimo 6 caracteres)',
        example: 'miPassword123',
        minLength: 6
    })
    @IsString()
    @MinLength(6)
    @Transform(({ value }) => value.trim())
    password: string;

    @ApiProperty({
        description: 'Confirmación de la contraseña (debe coincidir con password)',
        example: 'miPassword123',
        minLength: 6
    })
    @IsString()
    @MinLength(6)
    @Validate(PasswordMatchConstraint)
    @Transform(({ value }) => value.trim())
    password_confirmation: string;

    @ApiProperty({
        description: 'Edad del usuario',
        example: 25,
        minimum: 1,
        maximum: 120
    })
    @IsNumber()
    age: number;
}