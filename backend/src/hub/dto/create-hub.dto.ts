import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, MaxLength, Matches } from 'class-validator';

// Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — H1): antes no
// existía ningún CRUD para provisionar hubs (la columna `Hub.organizationId`
// existía pero nunca se poblaba, y todos los hubs compartían un único
// `HUB_SECRET` global). Este DTO es el body de `POST /hubs`
// (HubsController.provision → HubsService.provision), que genera el secret
// EN EL SERVIDOR (nunca lo recibe del cliente) y lo devuelve UNA SOLA VEZ en
// la respuesta — mismo patrón que `CreateServiceApiKeyDto`/`createApiKey` de
// better-auth (auth.service.ts).
export class CreateHubDto {
  @ApiProperty({
    description: 'Identificador único y estable del hub físico (lo configura el instalador en el .env de la Raspberry Pi vía HUB_ID)',
    example: 'hub-001',
  })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9-_]+$/, {
    message: 'hubId solo puede contener letras, números, guiones y guiones bajos',
  })
  hubId: string;

  @ApiProperty({
    description: 'Ubicación física del hub (edificio/panel)',
    example: 'Edificio A - Panel de Calle',
  })
  @IsString()
  @MaxLength(256)
  location: string;

  @ApiPropertyOptional({
    description: 'Descripción u observaciones adicionales del hub',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  description?: string;

  @ApiProperty({
    description:
      'UUID del condominio (organización) al que sirve este hub. "Un hub sirve a UN condominio" (decisión de la tarea) — se resuelve el tenant de la sesión del conserje digital a partir de este campo (ver HubAuthGuard/ConciergeAuthGuard).',
  })
  @IsUUID()
  organizationId: string;
}
