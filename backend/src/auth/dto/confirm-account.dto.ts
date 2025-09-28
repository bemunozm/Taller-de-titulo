import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmAccountDto {
    @ApiProperty({
        description: 'Token de confirmación de 6 dígitos enviado por email',
        example: '123456',
        minLength: 6,
        maxLength: 6
    })
    @IsString()
    @MinLength(6)
    @MaxLength(6)
    token: string;
}