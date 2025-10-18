import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ArrayUnique } from 'class-validator';

export class CreateCameraDto {
	@ApiProperty({ description: 'Nombre descriptivo de la cámara', example: 'Cámara Entrada Torre A' })
	@IsString({ message: 'El nombre debe ser una cadena de texto' })
	@IsNotEmpty({ message: 'El nombre es obligatorio' })
	@MaxLength(150, { message: 'El nombre no puede exceder los 150 caracteres' })
	name: string;

	@ApiProperty({ description: 'Ubicación física o nota sobre la cámara', example: 'Recepción - Piso 1', required: false })
	@IsString({ message: 'La ubicación debe ser una cadena de texto' })
	@IsOptional()
	@MaxLength(200, { message: 'La ubicación no puede exceder los 200 caracteres' })
	location?: string;

	@ApiProperty({ description: 'Ruta de montaje única para la cámara (autogenerada si no se proporciona)', example: 'camara-entrada-torre-a', required: false })
	@IsString({ message: 'La ruta de montaje debe ser una cadena de texto' })
	@IsOptional()
	@MaxLength(100, { message: 'La ruta de montaje no puede exceder los 100 caracteres' })
	mountPath?: string;

	@ApiProperty({ description: 'URL o identificador de la fuente (RTSP, etc.)', example: 'rtsp://user:pass@192.168.1.100:554/stream' })
	@IsString({ message: 'La URL de la fuente debe ser una cadena de texto' })
	@IsNotEmpty({ message: 'La URL de la fuente es obligatoria' })
	@MaxLength(500, { message: 'La URL de la fuente no puede exceder los 500 caracteres' })
	sourceUrl: string;

	@ApiProperty({ description: 'Indica si la cámara está activa', required: false, example: true })
	@IsBoolean({ message: 'El estado de la cámara debe ser un valor verdadero o falso' })
	@IsOptional()
	active?: boolean;

	@ApiProperty({ description: 'IDs de roles que tendrán acceso a esta cámara', example: ['role-uuid-1', 'role-uuid-2'], required: false })
	@IsArray({ message: 'Los IDs de roles deben ser un arreglo' })
	@ArrayUnique({ message: 'Los IDs de roles deben ser únicos' })
	@IsOptional()
	roleIds?: string[];
}
