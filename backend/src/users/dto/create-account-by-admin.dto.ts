import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, IsArray, MaxLength } from "class-validator";
import { ApiProperty } from '@nestjs/swagger';

export class CreateAccountByAdminDto {

    @ApiProperty({
        description: 'RUT del usuario (identificador único chileno)',
        example: '12345678-9',
        maxLength: 50,
        type: 'string'
    })
    @IsString({ message: 'El RUT debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El RUT no puede exceder los 50 caracteres' })
    @IsNotEmpty({ message: 'El RUT es obligatorio' })
    rut: string;

    @ApiProperty({
        description: 'Nombre completo del usuario',
        example: 'Juan Carlos Pérez González',
        maxLength: 100,
        type: 'string'
    })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    name: string;

    @ApiProperty({
        description: 'Correo electrónico del usuario (debe ser único)',
        example: 'juan.perez@universidad.cl',
        format: 'email',
        type: 'string'
    })
    @IsEmail({}, { message: 'El correo electrónico no es válido' })
    @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
    email: string;

    @ApiProperty({
        description: 'Número de teléfono del usuario',
        example: '+56912345678',
        maxLength: 15,
        type: 'string',
        required: false
    })
    @IsString({ message: 'El teléfono debe ser una cadena de texto' })
    @MaxLength(15, { message: 'El teléfono no puede exceder los 15 caracteres' })
    @IsOptional()
    phone?: string;

    @ApiProperty({
        description: 'Edad del usuario en años',
        example: 22,
        minimum: 16,
        maximum: 100,
        type: 'integer',
        required: false
    })
    @IsNumber({}, { message: 'La edad debe ser un número' })
    @IsOptional()
    age?: number;

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
    familyId?: string;
}
