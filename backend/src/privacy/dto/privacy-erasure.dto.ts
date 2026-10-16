import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * `POST /privacy/erasure` (Fase 4 · P7.R, Ley 21.719 §4): EXACTAMENTE uno de
 * `rut`, `plate` o `userId` (si no, 400). `organizationId` solo lo envía el
 * super-admin, y solo con `rut` o `plate`.
 */
export class PrivacyErasureDto {
  @ApiPropertyOptional({
    description:
      'RUT (o pasaporte) del titular. Se compara sin puntos, guion ni ceros a la izquierda.',
    example: '12.345.678-5',
    maxLength: 32,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  rut?: string;

  @ApiPropertyOptional({
    description:
      'Patente del vehículo. Se compara en mayúsculas y sin guiones ni espacios.',
    example: 'BBCD12',
    maxLength: 16,
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  plate?: string;

  @ApiPropertyOptional({
    description:
      'Usuario a anonimizar de inmediato. Debe estar deshabilitado (si no, 409).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('all')
  userId?: string;

  @ApiPropertyOptional({
    description:
      'Condominio donde se suprime (solo el super-admin; obligatorio para él con rut o plate).',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('all')
  organizationId?: string;
}
