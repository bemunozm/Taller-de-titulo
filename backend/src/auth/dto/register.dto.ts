import { Transform } from "class-transformer";
import { IsEmail, IsNumber, IsString, MinLength, Validate, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";

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

    @IsString()
    @MinLength(1)
    rut:string;

    @IsString()
    @MinLength(1)
    name: string;

    @IsEmail()
    email: string;

    @IsString()
    @MinLength(1)
    phone: string;

    @IsString()
    @MinLength(6)
    @Transform(({ value }) => value.trim())
    password: string;

    @IsString()
    @MinLength(6)
    @Validate(PasswordMatchConstraint)
    @Transform(({ value }) => value.trim())
    password_confirmation: string;

    @IsNumber()
    age: number;
}