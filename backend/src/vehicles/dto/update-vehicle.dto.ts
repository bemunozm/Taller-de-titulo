import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { CreateVehicleDto } from './create-vehicle.dto';

/** `''` (el "Seleccionar" del formulario) = sin cambio; `null` se mantiene (quita el propietario). */
function emptyStringToUndefined({ value }: { value: unknown }): unknown {
  return value === '' ? undefined : value;
}

/**
 * Body de `PUT /vehicles/:id`. Fase 4 · P5.B: antes el controller tipaba el
 * body como `Partial<CreateVehicleDto>`, que no lleva metadata de
 * class-validator, así que el `ValidationPipe` global no validaba NADA en la
 * edición (ni `vehicleType`/`accessLevel`, ni campos extra).
 *
 * Fase 4 · P5.C: sin `organizationId` (un vehículo no cambia de condominio;
 * con `forbidNonWhitelisted`, enviarlo responde 400).
 *
 * Corrección P5 (QA): `ownerId: null` QUITA el propietario (solo con
 * `condominium.view-all`); `''` o ausente no lo cambia.
 */
export class UpdateVehicleDto extends PartialType(
  OmitType(CreateVehicleDto, ['organizationId', 'ownerId'] as const),
) {
  @ApiPropertyOptional({
    description:
      'Propietario (miembro activo del condominio). null lo quita (solo con condominium.view-all); "" o ausente no lo cambia.',
    example: 'user-uuid-123',
    nullable: true,
  })
  @Transform(emptyStringToUndefined)
  @IsOptional()
  @IsString()
  ownerId?: string | null;
}
