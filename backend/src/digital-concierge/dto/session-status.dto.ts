import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HubType } from '../../hub/entities/hub.entity';

/**
 * Respuesta de `POST /concierge/session/:sessionId/status` (Fase 4 · P4). Es
 * el respaldo por polling del kiosko cuando no recibe `visitor:response:*`.
 * No expone el QR ni datos del visitante.
 */
export class SessionStatusResponseDto {
  @ApiProperty({
    description: 'La sesión sigue activa y puede recibir la respuesta',
  })
  active: boolean;

  @ApiPropertyOptional({ description: 'Motivo cuando active = false' })
  reason?: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Solicitud de visita vigente de la sesión',
  })
  visitId: string | null;

  @ApiProperty({
    nullable: true,
    enum: ['approved', 'denied', 'pending'],
    description:
      'Respuesta del residente (la del claim de la visita si existe)',
  })
  residentResponse: 'approved' | 'denied' | 'pending' | null;

  @ApiProperty({
    nullable: true,
    type: Boolean,
    description:
      'true: aprobada y el acceso se abrió automáticamente; false: aprobada pero el acceso no se abrió automáticamente (se avisó a conserjería); null: sin respuesta aprobada o aún procesándose',
  })
  entryRegistered: boolean | null;
}

/** Respuesta de `GET /concierge/device`: identidad del dispositivo autenticado. */
export class ConciergeDeviceResponseDto {
  @ApiProperty()
  hubId: string;

  @ApiProperty({ enum: HubType })
  type: HubType;

  @ApiProperty({ nullable: true, type: String })
  organizationId: string | null;
}
