import { IsString, IsOptional, IsInt, IsBoolean, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBulkUnitsDto {
  @ApiPropertyOptional({ 
    description: 'Bloque común para todas las unidades (ej: A, B, Torre 1)',
    example: 'A',
    maxLength: 16
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  block?: string;

  @ApiProperty({ 
    description: 'Número inicial del rango',
    example: 101,
    minimum: 1
  })
  @IsInt()
  @Min(1)
  numberFrom: number;

  @ApiProperty({ 
    description: 'Número final del rango',
    example: 110,
    minimum: 1
  })
  @IsInt()
  @Min(1)
  numberTo: number;

  @ApiPropertyOptional({ 
    description: 'Piso común para todas las unidades',
    example: 3
  })
  @IsOptional()
  @IsInt()
  floor?: number;

  @ApiPropertyOptional({ 
    description: 'Tipo común para todas las unidades (ej: Departamento, Casa)',
    example: 'Departamento',
    maxLength: 32
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  type?: string;

  @ApiPropertyOptional({ 
    description: 'Estado activo/inactivo para todas las unidades',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
