import { IsString, IsOptional, IsUUID, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAccessAttemptDto {
  @IsUUID()
  @ApiProperty({ description: 'ID de la detección asociada', example: 'detection-uuid-123' })
  detectionId: string;

  @IsString()
  @ApiProperty({ description: 'Decisión tomada (allow/deny)', example: 'allow' })
  decision: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Motivo o comentario asociado a la decisión', example: 'Visitante autorizado' })
  reason?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Método del intento (patente, facial, visitante, app)', example: 'patente' })
  method?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'ID del residente/usuario asociado (si aplica)', example: 'user-uuid-123' })
  residenteId?: string;
}
