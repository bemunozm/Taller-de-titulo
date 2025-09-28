import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePermissionDto {
    @ApiProperty({
        description: 'Nombre único del permiso (formato: modulo.accion)',
        example: 'users.create',
        maxLength: 100
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(100)
    name: string;

    @ApiProperty({
        description: 'Descripción detallada del permiso y lo que permite hacer',
        example: 'Permite crear nuevos usuarios en el sistema',
        maxLength: 255
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(255)
    description: string;

    @ApiProperty({
        description: 'Módulo del sistema al que pertenece el permiso',
        example: 'users',
        maxLength: 50
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(50)
    module: string;

    @ApiProperty({
        description: 'Acción específica que permite el permiso',
        example: 'create',
        enum: ['create', 'read', 'update', 'delete', 'manage'],
        maxLength: 50
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(50)
    action: string;
}