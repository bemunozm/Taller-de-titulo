import { IsNotEmpty, IsString, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
    @ApiProperty({
        description: 'Nombre único del rol en el sistema',
        example: 'Administrador',
        maxLength: 100
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(100)
    name: string;

    @ApiProperty({
        description: 'Descripción detallada del rol y sus responsabilidades',
        example: 'Administrador del sistema con acceso completo a todas las funcionalidades',
        required: false,
        maxLength: 255
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
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
