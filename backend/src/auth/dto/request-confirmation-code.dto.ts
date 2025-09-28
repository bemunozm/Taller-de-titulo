import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestConfirmationCodeDto {
    @ApiProperty({
        description: 'Correo electrónico del usuario para reenviar código de confirmación',
        example: 'juan.perez@example.com',
        format: 'email'
    })
    @IsEmail()
    email: string;
}