import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Datos del Administrador del condominio a crear (owner de la organización).
 * Mismos campos requeridos que `CreateAccountByAdminDto`
 * (src/users/dto/create-account-by-admin.dto.ts) — `rut`/`phone` son
 * additionalFields OBLIGATORIOS del `user` de better-auth (docs/modulos/
 * auth-multitenant.md §12), así que el onboarding debe proveerlos.
 */
export class CondominiumAdminDto {
  @ApiProperty({ description: 'RUT del administrador del condominio', example: '12345678-9' })
  @IsString()
  @MaxLength(50)
  @IsNotEmpty()
  rut: string;

  @ApiProperty({ description: 'Nombre completo del administrador', example: 'María Soto Pérez' })
  @IsString()
  @MaxLength(100)
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Correo del administrador (recibirá el link de activación)', example: 'maria.soto@condominio.cl' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Teléfono del administrador (formato chileno, máx 15 caracteres)', example: '+56912345678' })
  @IsString()
  @MaxLength(15)
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: 'Edad del administrador', example: 35, required: false })
  @IsNumber()
  @IsOptional()
  age?: number;
}

/**
 * Body de `POST /onboarding/condominiums` — endpoint EXCLUSIVO de la
 * plataforma (permiso `platform.manage-organizations`, solo el rol Super
 * Administrador lo tiene). Crea el condominio (organization de better-auth) +
 * su Administrador (owner de la organización), en cascada, tal como describe
 * docs/modulos/auth-multitenant.md §7b.
 */
export class CreateCondominiumDto {
  @ApiProperty({ description: 'Nombre del condominio', example: 'Condominio Los Alerces' })
  @IsString()
  @MaxLength(150)
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Slug único del condominio (se genera automáticamente desde el nombre si se omite)',
    example: 'condominio-los-alerces',
    required: false,
  })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiProperty({ description: 'Datos del Administrador del condominio (owner de la organización)', type: CondominiumAdminDto })
  @ValidateNested()
  @Type(() => CondominiumAdminDto)
  admin: CondominiumAdminDto;
}
