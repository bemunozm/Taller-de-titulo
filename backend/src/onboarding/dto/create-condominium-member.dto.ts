import { IsArray, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body de `POST /onboarding/members` — el Administrador de UN condominio
 * crea/da de alta usuarios (residentes, conserjes) DENTRO de SU propia
 * organización (docs/modulos/auth-multitenant.md §7b). El `organizationId`
 * NO viaja en el body: se resuelve desde la membresía del caller
 * (TenantContextService — ver OnboardingService.createCondominiumMember),
 * así un admin nunca puede dar de alta usuarios en un condominio ajeno.
 */
export class CreateCondominiumMemberDto {
  @ApiProperty({ description: 'RUT del usuario', example: '11222333-4' })
  @IsString()
  @MaxLength(50)
  @IsNotEmpty()
  rut: string;

  @ApiProperty({ description: 'Nombre completo del usuario', example: 'Pedro Ramírez' })
  @IsString()
  @MaxLength(100)
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Correo del usuario (recibirá el link de activación)', example: 'pedro.ramirez@correo.cl' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Teléfono del usuario (formato chileno, máx 15 caracteres)', example: '+56987654321' })
  @IsString()
  @MaxLength(15)
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: 'Edad del usuario', example: 40, required: false })
  @IsNumber()
  @IsOptional()
  age?: number;

  @ApiProperty({
    description: 'IDs de los roles app-side a asignar (RBAC fino) — p.ej. Residente o Conserje',
    example: ['role-uuid-residente'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  roleIds: string[];

  @ApiProperty({ description: 'ID de la familia a la que pertenece (opcional)', required: false })
  @IsString()
  @IsOptional()
  familyId?: string;
}
