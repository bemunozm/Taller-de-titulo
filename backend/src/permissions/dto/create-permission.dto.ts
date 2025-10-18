import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePermissionDto {
    @ApiProperty({
        description: 'Nombre único del permiso (formato: modulo.accion)',
        example: 'users.create',
        maxLength: 100
    })
    @IsNotEmpty({ message: 'El nombre del permiso es obligatorio' })
    @IsString({ message: 'El nombre del permiso debe ser una cadena de texto' })
    @MaxLength(100, { message: 'El nombre del permiso no puede exceder los 100 caracteres' })
    name: string;

    @ApiProperty({
        description: 'Descripción detallada del permiso y lo que permite hacer',
        example: 'Permite crear nuevos usuarios en el sistema',
        maxLength: 255
    })
    @IsNotEmpty({ message: 'La descripción del permiso es obligatoria' })
    @IsString({ message: 'La descripción del permiso debe ser una cadena de texto' })
    @MaxLength(255, { message: 'La descripción del permiso no puede exceder los 255 caracteres' })
    description: string;

    @ApiProperty({
        description: 'Módulo del sistema al que pertenece el permiso',
        example: 'users',
        maxLength: 50
    })
    @IsNotEmpty({ message: 'El módulo es obligatorio' })
    @IsString({ message: 'El módulo debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El módulo no puede exceder los 50 caracteres' })
    module: string;

    @ApiProperty({
        description: 'Acción específica que permite el permiso',
        example: 'create',
        enum: ['create', 'read', 'update', 'delete', 'manage'],
        maxLength: 50
    })
    @IsNotEmpty({ message: 'La acción es obligatoria' })
    @IsString({ message: 'La acción debe ser una cadena de texto' })
    @MaxLength(50, { message: 'La acción no puede exceder los 50 caracteres' })
    action: string;
}