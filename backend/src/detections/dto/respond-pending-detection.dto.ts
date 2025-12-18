import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RespondPendingDetectionDto {
  @ApiProperty({
    description: 'Decisión del conserje',
    enum: ['approved', 'denied'],
    example: 'approved',
  })
  @IsEnum(['approved', 'denied'])
  decision: 'approved' | 'denied';

  @ApiProperty({
    description: 'Comentario opcional del conserje',
    required: false,
    example: 'Visitante esperado por el departamento 101',
  })
  @IsOptional()
  @IsString()
  response?: string;
}
