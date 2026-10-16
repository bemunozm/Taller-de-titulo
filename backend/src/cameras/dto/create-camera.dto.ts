import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ArrayUnique,
  IsUUID,
} from 'class-validator';
import { IsCameraSourceUrl } from '../camera-source-url';

export class CreateCameraDto {
  @ApiProperty({
    description: 'Nombre descriptivo de la cámara',
    example: 'Cámara Entrada Torre A',
  })
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(150, { message: 'El nombre no puede exceder los 150 caracteres' })
  name: string;

  @ApiProperty({
    description: 'Ubicación física o nota sobre la cámara',
    example: 'Recepción - Piso 1',
    required: false,
  })
  @IsString({ message: 'La ubicación debe ser una cadena de texto' })
  @IsOptional()
  @MaxLength(200, {
    message: 'La ubicación no puede exceder los 200 caracteres',
  })
  location?: string;

  @ApiProperty({
    description:
      'Ruta de montaje única para la cámara (autogenerada si no se proporciona)',
    example: 'camara-entrada-torre-a',
    required: false,
  })
  @IsString({ message: 'La ruta de montaje debe ser una cadena de texto' })
  @IsOptional()
  @MaxLength(100, {
    message: 'La ruta de montaje no puede exceder los 100 caracteres',
  })
  mountPath?: string;

  // Fase 4 · P6.M (corrección cyber): solo `rtsp://` y `rtsps://`. MediaMTX
  // acepta otras fuentes (`udp+mpegts://0.0.0.0:...` abriría un listener en
  // todas las interfaces del host). Aplica también a `PATCH` (UpdateCameraDto).
  @ApiProperty({
    description: 'URL RTSP de la cámara (solo rtsp:// o rtsps://)',
    example: 'rtsp://user:pass@192.168.1.100:554/stream',
  })
  @IsString({ message: 'La URL de la fuente debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La URL de la fuente es obligatoria' })
  @MaxLength(500, {
    message: 'La URL de la fuente no puede exceder los 500 caracteres',
  })
  @IsCameraSourceUrl()
  sourceUrl: string;

  @ApiProperty({
    description: 'Indica si la cámara está activa',
    required: false,
    example: true,
  })
  @IsBoolean({
    message: 'El estado de la cámara debe ser un valor verdadero o falso',
  })
  @IsOptional()
  active?: boolean;

  @ApiProperty({
    description:
      'Habilitar análisis LPR (reconocimiento de patentes) para esta cámara',
    required: false,
    example: false,
  })
  @IsBoolean({ message: 'enableLpr debe ser booleano' })
  @IsOptional()
  enableLpr?: boolean;

  @ApiProperty({
    description: 'IDs de roles que tendrán acceso a esta cámara',
    example: ['role-uuid-1', 'role-uuid-2'],
    required: false,
  })
  @IsArray({ message: 'Los IDs de roles deben ser un arreglo' })
  @ArrayUnique({ message: 'Los IDs de roles deben ser únicos' })
  @IsOptional()
  roleIds?: string[];

  @ApiProperty({
    description: 'Habilitar Guardián Visual (Intrusión) para esta cámara',
    required: false,
    example: false,
  })
  @IsBoolean({ message: 'enableGuardian debe ser booleano' })
  @IsOptional()
  enableGuardian?: boolean;

  // Fase 4 · P5.C (creación estricta): solo el super-admin lo envía (y es
  // obligatorio para él); cualquier otro actor que lo envíe → 403.
  @ApiProperty({
    description:
      'Condominio de la cámara. Solo super-admin (obligatorio para él); otro actor → 403',
    required: false,
    format: 'uuid',
  })
  @IsUUID('all', { message: 'organizationId debe ser un UUID' })
  @IsOptional()
  organizationId?: string;
}
