import { IsEnum, IsString, IsOptional, IsInt, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LogLevel, LogType, ServiceName } from '../entities/system-log.entity';

export class CreateSystemLogDto {
  @ApiProperty({ 
    description: 'Nivel de severidad del log',
    enum: LogLevel,
    example: LogLevel.INFO
  })
  @IsEnum(LogLevel)
  level: LogLevel;

  @ApiProperty({ 
    description: 'Tipo de log',
    enum: LogType,
    example: LogType.HTTP_REQUEST
  })
  @IsEnum(LogType)
  type: LogType;

  @ApiProperty({ 
    description: 'Servicio que genera el log',
    enum: ServiceName,
    example: ServiceName.BACKEND
  })
  @IsEnum(ServiceName)
  service: ServiceName;

  @ApiProperty({ 
    description: 'Mensaje descriptivo del log',
    example: 'Solicitud HTTP a MediaMTX API'
  })
  @IsString()
  message: string;

  @ApiPropertyOptional({ 
    description: 'Método HTTP',
    example: 'POST'
  })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ 
    description: 'URL de la petición',
    example: 'http://localhost:9997/v3/paths/add'
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ 
    description: 'Código de estado HTTP',
    example: 200
  })
  @IsOptional()
  @IsInt()
  statusCode?: number;

  @ApiPropertyOptional({ 
    description: 'Tiempo de respuesta en milisegundos',
    example: 150
  })
  @IsOptional()
  @IsInt()
  responseTime?: number;

  @ApiPropertyOptional({ 
    description: 'Datos de la petición (sanitizados)',
    example: { cameraId: '123', streamUrl: 'rtsp://...' }
  })
  @IsOptional()
  @IsObject()
  requestData?: any;

  @ApiPropertyOptional({ 
    description: 'Datos de la respuesta (sanitizados)',
    example: { success: true, data: {} }
  })
  @IsOptional()
  @IsObject()
  responseData?: any;

  @ApiPropertyOptional({ 
    description: 'Mensaje de error si aplica',
    example: 'Connection timeout'
  })
  @IsOptional()
  @IsString()
  errorMessage?: string;

  @ApiPropertyOptional({ 
    description: 'Stack trace del error',
    example: 'Error: Connection timeout\n  at ...'
  })
  @IsOptional()
  @IsString()
  stackTrace?: string;

  @ApiPropertyOptional({ 
    description: 'Metadatos adicionales',
    example: { cameraId: '123', userId: 'abc' }
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ 
    description: 'ID de correlación para rastreo',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiPropertyOptional({ 
    description: 'Dirección IP del cliente',
    example: '192.168.1.100'
  })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional({ 
    description: 'User agent del cliente',
    example: 'Mozilla/5.0 ...'
  })
  @IsOptional()
  @IsString()
  userAgent?: string;
}
