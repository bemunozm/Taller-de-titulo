import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsUUID } from 'class-validator';

/**
 * Body de `POST /concierge/session/:sessionId/respond` (Fase 4 · P4, D5).
 *
 * - `approved`: booleano estricto (`"false"` como string responde 400; el
 *   `ValidationPipe` global no hace conversión implícita).
 * - `visitId`: la solicitud que vio el residente (viene en
 *   `notification.data.visitId`). Si no es la vigente de la sesión → 409.
 *
 * No hay `residentId`: quien responde es SIEMPRE el usuario de la sesión
 * humana (`req.user.id`). Con `forbidNonWhitelisted`, mandarlo responde 400.
 */
export class RespondToVisitorDto {
  @ApiProperty({ description: 'true aprueba la visita, false la rechaza' })
  @IsBoolean()
  approved: boolean;

  @ApiProperty({
    description: 'ID de la solicitud de visita que se está respondiendo',
    format: 'uuid',
  })
  @IsUUID()
  visitId: string;
}

/** Respuesta de `/respond`. */
export class RespondToVisitorResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty({
    description:
      'true solo si el acceso se abrió automáticamente (esta respuesta registró el ingreso y un hub físico recibió la orden de apertura); false si se rechazó o si el acceso no se abrió automáticamente (se avisó a conserjería)',
  })
  entryRegistered: boolean;
}
