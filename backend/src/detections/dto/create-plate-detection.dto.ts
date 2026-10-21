import { IsString, IsOptional, IsNumber, IsArray, IsIn, IsInt, IsObject, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

import {
  PASSAGE_DIRECTION_SOURCES,
  PASSAGE_DIRECTIONS,
  type PassageDirection,
  type PassageDirectionSource,
} from '../vehicle-passage-direction';

export const PLATE_DIRECTIONS = PASSAGE_DIRECTIONS;
export type PlateDirection = PassageDirection;

/** Resumen del seguimiento + voto que confirmó la lectura (worker LPR). */
export class MetaTrackDto {
  @IsInt()
  @Min(0)
  @Max(2147483647)
  @ApiProperty({ description: 'Id del track dentro del worker', example: 3 })
  id: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  @ApiProperty({ description: 'Lecturas válidas acumuladas por el track', example: 5 })
  reads: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  @ApiProperty({ description: 'Votos del texto ganador', example: 4 })
  votes: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  @ApiProperty({ description: 'Fracción de votos del texto ganador (0-1)', example: 0.8 })
  winner_share: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  @ApiPropertyOptional({ description: 'Id del track del vehículo (ByteTrack) en el worker', example: 7 })
  vehicle_id?: number;
}

class MetaPlateDto {
  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({ description: 'Bounding box [x1,y1,x2,y2]', example: [10, 20, 100, 60] })
  bbox?: number[];

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Snapshot en base64 (JPEG)', example: 'data:image/jpeg;base64,/9j/4AAQSk...' })
  snapshot_jpeg_b64?: string;

  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({ description: 'Confianzas por caracter', example: [0.9, 0.8, 0.95] })
  char_confidences?: any;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ description: 'Confianza mínima por caracter', example: 0.45 })
  char_conf_min?: number | null;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ description: 'Media de confianza por caracter', example: 0.85 })
  char_conf_mean?: number | null;

  // timestamp removido - se genera automáticamente en backend con @CreateDateColumn

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Como se realizo la confirmación por frames o segundos en imagen', example: 'frames' })
  confirmed_by?: string;

  @IsOptional()
  @IsIn(PLATE_DIRECTIONS)
  @ApiPropertyOptional({ description: 'Sentido inferido por el worker', enum: PLATE_DIRECTIONS })
  direction?: PlateDirection;

  @IsOptional()
  @IsIn(PASSAGE_DIRECTION_SOURCES)
  @ApiPropertyOptional({
    description: 'De dónde salió la dirección (prioridad: camera > line > motion > width > none)',
    enum: PASSAGE_DIRECTION_SOURCES,
  })
  direction_source?: PassageDirectionSource;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MetaTrackDto)
  @ApiPropertyOptional({ description: 'Seguimiento + voto que confirmó la lectura', type: MetaTrackDto })
  track?: MetaTrackDto;
}


export class CreatePlateDetectionDto {
  @IsString()
  @ApiProperty({ description: 'ID de la cámara que generó la detección', example: 'cam-prueba-1' })
  cameraId: string;

  @IsString()
  @MaxLength(16)
  @ApiProperty({ description: 'Patente detectada (normalizada)', example: 'ABC123' })
  plate: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiPropertyOptional({ description: 'Texto de la patente tal como salió del OCR', example: 'A8C123' })
  plate_raw?: string;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ description: 'Confianza del detector (0.0-1.0)', example: 0.92 })
  det_confidence?: number;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ description: 'Confianza del OCR (0.0-1.0)', example: 0.95 })
  ocr_confidence?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Ruta al frame anotado en disco', example: '/data/lpr/detecciones/cam-frame.jpg' })
  full_frame_path?: string;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ 
    description: 'Timestamp de detección desde el LPR en milisegundos desde epoch (para cálculo preciso de tiempo de respuesta)', 
    example: 1733850000000 
  })
  detectionTimestamp?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MetaPlateDto)
  @ApiPropertyOptional({ description: 'Campo libre para meta/información adicional', type: MetaPlateDto })
  meta?: MetaPlateDto;
}
