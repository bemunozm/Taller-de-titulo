import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
    @ApiProperty({
        description: 'Correo electrónico del usuario que olvidó su contraseña',
        example: 'juan.perez@example.com',
        format: 'email'
    })
    @IsEmail()
    email: string;
}