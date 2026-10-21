import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCameraDto } from './create-camera.dto';

/**
 * Body de `PATCH /cameras/:id`. Fase 4 · P5.C: sin `organizationId` (una
 * cámara no cambia de condominio; `update` hace `Object.assign` del DTO).
 */
export class UpdateCameraDto extends PartialType(
  OmitType(CreateCameraDto, ['organizationId'] as const),
) {}
