import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAccountByAdminDto {
  @ApiProperty({
    description: 'RUT del usuario (identificador único chileno)',
    example: '12345678-9',
    maxLength: 50,
    type: 'string',
  })
  @IsString({ message: 'El RUT debe ser una cadena de texto' })
  @MaxLength(50, { message: 'El RUT no puede exceder los 50 caracteres' })
  @IsNotEmpty({ message: 'El RUT es obligatorio' })
  rut: string;

  @ApiProperty({
    description: 'Nombre completo del usuario',
    example: 'Juan Carlos Pérez González',
    maxLength: 100,
    type: 'string',
  })
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;

  @ApiProperty({
    description: 'Correo electrónico del usuario (debe ser único)',
    example: 'juan.perez@universidad.cl',
    format: 'email',
    type: 'string',
  })
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;

  @ApiProperty({
    description: 'Número de teléfono del usuario',
    example: '+56912345678',
    maxLength: 15,
    type: 'string',
    required: false,
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
    required: false,
  })
  @IsNumber({}, { message: 'La edad debe ser un número' })
  @IsOptional()
  age?: number;

  @ApiProperty({
    description: 'IDs de los roles a asignar al usuario',
    example: ['role-uuid-123', 'role-uuid-456'],
    type: [String],
    required: false,
  })
  @IsArray({ message: 'Los roles deben ser un array de IDs' })
  @IsUUID('all', { each: true, message: 'Cada rol debe ser un ID válido' })
  @IsOptional()
  roleIds?: string[];

  @ApiProperty({
    description:
      'ID de la familia a la que pertenece el usuario (opcional). Debe ser del condominio de la cuenta.',
    example: 'family-uuid-123',
    type: 'string',
    required: false,
  })
  @IsUUID('all', { message: 'El ID de familia debe ser un ID válido' })
  @IsOptional()
  familyId?: string;

  @ApiProperty({
    description:
      'Condominio (organization) donde se crea la membresía de la cuenta. SOLO lo acepta un super-admin ' +
      '(obligatorio para él, salvo cuentas de plataforma con el rol "Super Administrador"); cualquier otro ' +
      'actor que lo envíe recibe 403: su cuenta se crea siempre en su propio condominio.',
    example: '3f1c2b7e-0c1d-4c4e-9a52-6a0f0d6d1a11',
    type: 'string',
    format: 'uuid',
    required: false,
  })
  @IsUUID('all', { message: 'El condominio debe ser un ID válido' })
  @IsOptional()
  organizationId?: string;
}
