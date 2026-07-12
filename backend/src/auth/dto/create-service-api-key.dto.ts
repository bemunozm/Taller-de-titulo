import { IsOptional, IsString, IsIn, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Tarea #18 (docs/modulos/auth-multitenant.md §10.3): credenciales de máquina
// (worker LPR) vía el plugin `apiKey` de better-auth, en reemplazo del
// `create-service-token` legacy (JWT largo, ver AuthService.createServiceToken
// — @deprecated).
export class CreateServiceApiKeyDto {
  @ApiProperty({
    description: 'Nombre identificador de la API key (para reconocerla en el panel/listado)',
    example: 'LPR Worker Manager',
  })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Descripción o propósito de la key (se guarda en su metadata)',
    example: 'Credencial de máquina para el worker de reconocimiento de patentes',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Duración de la key antes de expirar',
    example: '365d',
    required: false,
    default: '365d',
    enum: ['30d', '90d', '180d', '365d', 'never'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['30d', '90d', '180d', '365d', 'never'])
  duration?: string = '365d';

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
