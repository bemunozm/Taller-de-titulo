import { IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTokenDto {
    @ApiProperty({
        description: 'Token de 6 dígitos para verificación',
        example: '123456',
        minLength: 6,
        maxLength: 6
    })
    @IsString()
    @Length(6, 6)
    token: string;

    @ApiProperty({
        description: 'ID único del usuario propietario del token',
        example: 'user-uuid-123',
        format: 'uuid'
    })
    @IsString()
    @IsUUID()
    userId: string;
}
