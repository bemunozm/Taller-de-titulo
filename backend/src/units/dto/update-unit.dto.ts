import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUnitDto } from './create-unit.dto';

/**
 * Body de `PATCH /units/:id`. Fase 4 · P5.C: sin `organizationId` (una
 * unidad no cambia de condominio; `update` hace `Object.assign` del DTO).
 */
export class UpdateUnitDto extends PartialType(
  OmitType(CreateUnitDto, ['organizationId'] as const),
) {}
