import { IsEnum, IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LogLevel, LogType, ServiceName } from '../entities/system-log.entity';

export class GetLogsQueryDto {
  @ApiPropertyOptional({ 
    description: 'Nivel de log',
    enum: LogLevel,
    example: LogLevel.ERROR
  })
  @IsOptional()
  @IsEnum(LogLevel)
  level?: LogLevel;

  @ApiPropertyOptional({ 
    description: 'Tipo de log',
    enum: LogType,
    example: LogType.HTTP_REQUEST
  })
  @IsOptional()
  @IsEnum(LogType)
  type?: LogType;

  @ApiPropertyOptional({ 
    description: 'Servicio origen',
    enum: ServiceName,
    example: ServiceName.MEDIAMTX
  })
  @IsOptional()
  @IsEnum(ServiceName)
  service?: ServiceName;

  @ApiPropertyOptional({ 
    description: 'Búsqueda en mensaje o URL',
    example: 'error connection'
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ 
    description: 'Código de estado HTTP',
    example: 500
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusCode?: number;

  @ApiPropertyOptional({ 
    description: 'ID de correlación para rastreo',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiPropertyOptional({ 
    description: 'Fecha inicio (ISO 8601)',
    example: '2024-01-01T00:00:00Z'
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ 
    description: 'Fecha fin (ISO 8601)',
    example: '2024-12-31T23:59:59Z'
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ 
    description: 'Página actual',
    example: 1,
    default: 1
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ 
    description: 'Registros por página',
    example: 50,
    default: 50
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number = 50;
}
