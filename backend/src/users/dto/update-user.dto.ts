import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';
import { IsArray, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Omitir password del DTO de actualización por seguridad. Corrección P5
// (cyber B2): tampoco `emailVerified` — un actor no marca como verificado un
// email que no verificó el dueño (con `forbidNonWhitelisted`, enviarlo -> 400).
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'emailVerified'] as const),
) {
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
      'ID de la familia a la que pertenece el usuario (opcional; null o "" la quita). Debe ser del condominio del usuario.',
    example: 'family-uuid-123',
    type: 'string',
    required: false,
  })
  @ValidateIf((_dto: unknown, value: unknown) => value !== '')
  @IsUUID('all', { message: 'El ID de familia debe ser un ID válido' })
  @IsOptional()
  familyId?: string | null;

  // Fase 4 · P7 (corrección cyber B1): sin `profilePicture`. La foto se sube
  // por `POST /auth/upload-profile-picture` (URL de NUESTRO Cloudinary); una
  // URL arbitraria en la foto de otro usuario terminaba borrándose al
  // anonimizarlo. Con `forbidNonWhitelisted`, enviarla responde 400.
}
