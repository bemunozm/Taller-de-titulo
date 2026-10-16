import { IsOptional, IsString, IsIn, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Duraciones permitidas para una API key de servicio. Toda key expira (Fase 4
 * · P2): sin `'never'`, una key filtrada deja de servir sola aunque nadie la
 * revoque. Los segundos de cada opción viven en `AuthService`.
 */
export const SERVICE_API_KEY_DURATION_OPTIONS = [
  '30d',
  '90d',
  '180d',
  '365d',
] as const;

export type ServiceApiKeyDuration =
  (typeof SERVICE_API_KEY_DURATION_OPTIONS)[number];

export const DEFAULT_SERVICE_API_KEY_DURATION: ServiceApiKeyDuration = '365d';

// Credencial de máquina (worker LPR) vía el plugin `apiKey` de better-auth. La
// key queda vinculada a UN condominio en sus `permissions` (server-only, ver
// service-api-key.permissions.ts y AuthService.createServiceApiKey).
export class CreateServiceApiKeyDto {
  @ApiProperty({
    description:
      'Nombre identificador de la API key (para reconocerla en el panel/listado)',
    example: 'LPR Worker Manager',
  })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Descripción o propósito de la key (se guarda en su metadata)',
    example:
      'Credencial de máquina para el worker de reconocimiento de patentes',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Duración de la key antes de expirar (toda key expira)',
    example: DEFAULT_SERVICE_API_KEY_DURATION,
    required: false,
    default: DEFAULT_SERVICE_API_KEY_DURATION,
    enum: [...SERVICE_API_KEY_DURATION_OPTIONS],
  })
  @IsOptional()
  @IsString()
  @IsIn(SERVICE_API_KEY_DURATION_OPTIONS)
  duration?: ServiceApiKeyDuration = DEFAULT_SERVICE_API_KEY_DURATION;

  @ApiProperty({
    description:
      'UUID del usuario (cuenta) dueño de la key. Si se omite, se asigna al admin que la crea. ' +
      'Para un worker en producción se recomienda una cuenta de servicio dedicada (pendiente de #19, onboarding/organization).',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  targetUserId?: string;
}
