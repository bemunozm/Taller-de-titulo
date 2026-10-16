import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateFamilyDto } from './create-family.dto';

/**
 * Body de `PATCH /families/:id` (corrección P5, cyber B7 / QA). Antes el
 * controller tipaba el body como `Partial<CreateFamilyDto>`, sin metadata de
 * class-validator: no se validaba nada. Sin `organizationId` (una familia no
 * cambia de condominio; con `forbidNonWhitelisted`, enviarlo -> 400).
 *
 * `digitalConciergeEnabled` (QA A3): activa el Conserje Digital (IA del
 * citófono) para la unidad de la familia; antes ninguna API lo podía
 * cambiar. Como toda la ruta, exige `families.update`.
 */
export class UpdateFamilyDto extends PartialType(
  OmitType(CreateFamilyDto, ['organizationId'] as const),
) {
  @ApiPropertyOptional({
    description:
      'Conserje Digital (IA del citófono) habilitado para la familia. Requiere families.update.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  digitalConciergeEnabled?: boolean;
}
