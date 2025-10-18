import { IsNotEmpty, IsString, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
    @ApiProperty({
        description: 'Nombre único del rol en el sistema',
        example: 'Administrador',
        maxLength: 100
    })
    @IsNotEmpty({ message: 'El nombre del rol es obligatorio' })
    @IsString({ message: 'El nombre del rol debe ser una cadena de texto' })
    @MaxLength(100, { message: 'El nombre del rol no puede exceder los 100 caracteres' })
    name: string;

    @ApiProperty({
        description: 'Descripción detallada del rol y sus responsabilidades',
        example: 'Administrador del sistema con acceso completo a todas las funcionalidades',
        required: false,
        maxLength: 255
    })
    @IsOptional()
    @IsString({ message: 'La descripción debe ser una cadena de texto' })
    @MaxLength(255, { message: 'La descripción no puede exceder los 255 caracteres' })
    description?: string;

    @ApiProperty({
        description: 'Array de IDs de permisos que se asignarán al rol',
        example: ['perm-uuid-1', 'perm-uuid-2', 'perm-uuid-3'],
        required: false,
        type: [String]
    })
    @IsOptional()
    permissionIds?: string[];
}
