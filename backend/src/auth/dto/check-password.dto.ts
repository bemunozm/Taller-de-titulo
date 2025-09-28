import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckPasswordDto {
    @ApiProperty({
        description: 'Contraseña actual del usuario para verificación',
        example: 'miPasswordActual123',
        minLength: 6
    })
    @IsString()
    @MinLength(6)
    password: string;
}