import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateAccessDto {
  @ApiProperty({ 
    description: 'Identificador de la visita (código QR o patente vehicular)', 
    example: 'abc123def456' 
  })
  @IsString()
  identifier: string;

  @ApiProperty({ 
    description: 'Tipo de identificador',
    enum: ['qr', 'plate'],
    example: 'qr'
  })
  @IsEnum(['qr', 'plate'])
  type: 'qr' | 'plate';
}
