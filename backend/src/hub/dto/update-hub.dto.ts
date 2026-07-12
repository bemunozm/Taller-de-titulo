import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateHubDto } from './create-hub.dto';

// `hubId` es inmutable tras el provisioning: identifica físicamente al hub
// (el instalador ya lo configuró en el .env de la Raspberry Pi vía HUB_ID) —
// cambiarlo acá lo desincronizaría del dispositivo real. Para reemplazar el
// secret existe un endpoint dedicado (`POST /hubs/:hubId/rotate-secret`), no
// este PATCH genérico.
export class UpdateHubDto extends PartialType(OmitType(CreateHubDto, ['hubId'] as const)) {
  @ApiPropertyOptional({ description: 'Habilitar/deshabilitar el hub (un hub inactivo no puede autenticarse)' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
