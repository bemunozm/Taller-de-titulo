import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsString } from 'class-validator';

export class WhepAnswerDto {
  @ApiProperty({ description: 'Respuesta SDP enviada por el gateway de medios (MediaMTX)' })
  @Expose()
  @IsString({ message: 'La respuesta debe ser una cadena de texto' })
  answer: string;
}
