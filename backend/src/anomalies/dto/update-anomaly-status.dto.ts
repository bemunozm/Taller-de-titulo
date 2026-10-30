import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ANOMALY_STATUSES,
  MAX_RESOLUTION_NOTE_LENGTH,
  type AnomalyStatus,
} from '../anomaly-status';

/** Body de `PATCH /anomalies/:id/status`. */
export class UpdateAnomalyStatusDto {
  @ApiProperty({ enum: ANOMALY_STATUSES })
  @IsIn(ANOMALY_STATUSES, {
    message: `status debe ser uno de: ${ANOMALY_STATUSES.join(', ')}`,
  })
  status: AnomalyStatus;

  @ApiPropertyOptional({ maxLength: MAX_RESOLUTION_NOTE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESOLUTION_NOTE_LENGTH, {
    message: `note admite como máximo ${MAX_RESOLUTION_NOTE_LENGTH} caracteres`,
  })
  note?: string;
}
