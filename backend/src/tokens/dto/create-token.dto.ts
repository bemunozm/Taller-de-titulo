import { IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTokenDto {
    @ApiProperty({
        description: 'Token de 6 dígitos para verificación',
        example: '123456',
        minLength: 6,
        maxLength: 6
    })
    @IsString({ message: 'El token debe ser una cadena de texto' })
    @Length(6, 6, { message: 'El token debe tener exactamente 6 caracteres' })
    token: string;

    @ApiProperty({
        description: 'ID único del usuario propietario del token',
        example: 'user-uuid-123',
        format: 'uuid'
    })
    @IsString({ message: 'El ID de usuario debe ser una cadena de texto' })
    @IsUUID('4', { message: 'El ID de usuario debe ser un UUID válido' })
    userId: string;
}
