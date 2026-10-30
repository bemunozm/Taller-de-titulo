import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ANOMALY_STATUSES, type AnomalyStatus } from '../anomaly-status';

export const DEFAULT_ANOMALIES_LIMIT = 50;
export const MAX_ANOMALIES_LIMIT = 100;
export const MAX_ANOMALIES_OFFSET = 100000;

/** Query de `GET /anomalies` (todos los filtros son opcionales). */
export class ListAnomaliesQueryDto {
  @ApiPropertyOptional({ enum: ANOMALY_STATUSES })
  @IsOptional()
  @IsIn(ANOMALY_STATUSES, {
    message: `status debe ser uno de: ${ANOMALY_STATUSES.join(', ')}`,
  })
  status?: AnomalyStatus;

  @ApiPropertyOptional({
    description: 'Tipo de anomalía (p. ej. intrusion, loitering)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @ApiPropertyOptional({ description: 'Id de la cámara' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cameraId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_ANOMALIES_LIMIT,
    default: DEFAULT_ANOMALIES_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ANOMALIES_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ANOMALIES_OFFSET)
  offset?: number;
}
