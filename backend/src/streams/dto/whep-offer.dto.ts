import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';

export class WhepOfferDto {
  @ApiProperty({
    description: "Identificador o ruta de la cámara (mountPath) o su UUID. Ej: 'live/cam1' o '56cf34a5-...'.",
    example: 'live/cam1'
  })
  @IsString({ message: 'El mountPath debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El mountPath es obligatorio' })
  @MaxLength(256, { message: 'El mountPath no puede exceder los 256 caracteres' })
  cameraMount: string;
  @ApiProperty({
    description: 'Oferta SDP como cadena (application/sdp)',
  })
  @IsString({ message: 'La oferta SDP debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La oferta SDP es obligatoria' })
  // SDP puede ser grande; pero limitamos a 200_000 chars por seguridad
  @MaxLength(200000, { message: 'La oferta SDP no puede exceder los 200,000 caracteres' })
  offer: string;
}
