import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Omitir password del DTO de actualización por seguridad
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {
    @ApiProperty({
        description: 'IDs de los roles a asignar al usuario',
        example: ['role-uuid-123', 'role-uuid-456'],
        type: [String],
        required: false
    })
    @IsArray({ message: 'Los roles deben ser un array de IDs' })
    @IsString({ each: true, message: 'Cada rol debe ser un ID válido' })
    @IsOptional()
    roleIds?: string[];

    @ApiProperty({
        description: 'ID de la familia a la que pertenece el usuario (opcional)',
        example: 'family-uuid-123',
        type: 'string',
        required: false
    })
    @IsString({ message: 'El ID de familia debe ser una cadena de texto' })
    @IsOptional()
    familyId?: string | null;

    @ApiProperty({
        description: 'URL de la foto de perfil del usuario',
        example: 'https://res.cloudinary.com/...',
        type: 'string',
        required: false
    })
    @IsString({ message: 'La URL de la foto de perfil debe ser una cadena de texto' })
    @IsOptional()
    profilePicture?: string | null;
}
