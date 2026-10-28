import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * Body de `POST /concierge/qr/redeem`. El código del QR de una visita es
 * alfanumérico; se acota a 8-64 caracteres sin espacios para descartar basura
 * antes de tocar la BD.
 */
export class RedeemQrDto {
  @ApiProperty({
    description: 'Código leído del QR de la visita (alfanumérico, 8 a 64)',
    minLength: 8,
    maxLength: 64,
  })
  @IsString()
  @Matches(/^[A-Za-z0-9]{8,64}$/, {
    message: 'qrCode debe ser alfanumérico de 8 a 64 caracteres',
  })
  qrCode: string;
}

/** Motivo por el que el kiosko NO abre (sin PII: solo la categoría). */
export type RedeemQrDenialReason =
  | 'invalid'
  | 'not_yet_valid'
  | 'expired'
  | 'already_inside'
  | 'no_uses_left'
  | 'host_inactive';

/** Respuesta 200 de `POST /concierge/qr/redeem`. */
export type RedeemQrResponse =
  | {
      status: 'granted';
      access: 'pedestrian' | 'vehicular';
      doorOpened: boolean;
    }
  | { status: 'denied'; reason: RedeemQrDenialReason };

/** Documentación Swagger de `RedeemQrResponse` (la unión no se infiere). */
export class RedeemQrResponseDto {
  @ApiProperty({ enum: ['granted', 'denied'] })
  status: 'granted' | 'denied';

  @ApiProperty({ enum: ['pedestrian', 'vehicular'], required: false })
  access?: 'pedestrian' | 'vehicular';

  @ApiProperty({
    required: false,
    description:
      'false si ningún hub físico recibió la orden (se alertó a conserjería)',
  })
  doorOpened?: boolean;

  @ApiProperty({
    required: false,
    enum: [
      'invalid',
      'not_yet_valid',
      'expired',
      'already_inside',
      'no_uses_left',
      'host_inactive',
    ],
  })
  reason?: RedeemQrDenialReason;
}
