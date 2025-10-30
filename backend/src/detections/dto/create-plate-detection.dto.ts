import { IsString, IsOptional, IsNumber, IsArray, IsObject, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Timestamp de la detección', example: '2024-06-01T12:34:56Z' })
  timestamp?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Como se realizo la confirmación por frames o segundos en imagen', example: 'frames' })
  confirmed_by?: string;
}


export class CreatePlateDetectionDto {
  @IsString()
  @ApiProperty({ description: 'ID de la cámara que generó la detección', example: 'cam-prueba-1' })
  cameraId: string;

  @IsString()
  @ApiProperty({ description: 'Patente detectada (normalizada)', example: 'ABC123' })
  plate: string;

  @IsOptional()
  @IsString()
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
  @ValidateNested()
  @Type(() => MetaPlateDto)
  @ApiPropertyOptional({ description: 'Campo libre para meta/información adicional', type: MetaPlateDto })
  meta?: MetaPlateDto;
}
