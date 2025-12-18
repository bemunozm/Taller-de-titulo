import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, IsBoolean } from 'class-validator';

export class CreateUnitDto {
  @ApiPropertyOptional({ 
    description: 'Bloque o torre (A, B, C, etc.). Dejar vacío para casas o condominios sin bloques',
    example: 'A'
  })
  @IsOptional()
  @IsString()
  block?: string;

  @ApiProperty({ 
    description: 'Número de la unidad (303, 101, Casa 5, etc.)',
    example: '303'
  })
  @IsString()
  number: string;

  @ApiPropertyOptional({ 
    description: 'Piso de la unidad',
    example: 3
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  floor?: number;

  @ApiPropertyOptional({ 
    description: 'Tipo de unidad',
    example: 'departamento',
    enum: ['departamento', 'casa', 'local comercial', 'oficina']
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ 
    description: 'Estado activo de la unidad',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
