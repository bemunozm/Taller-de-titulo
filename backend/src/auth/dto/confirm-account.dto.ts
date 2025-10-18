import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmAccountDto {
    @ApiProperty({
        description: 'Token de confirmación de 6 dígitos enviado por email',
        example: '123456',
        minLength: 6,
        maxLength: 6
    })
    @IsString({ message: 'El token debe ser una cadena de texto' })
    @MinLength(6, { message: 'El token debe tener al menos 6 caracteres' })
    @MaxLength(6, { message: 'El token debe tener exactamente 6 caracteres' })
    token: string;
}