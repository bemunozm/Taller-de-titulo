import { IsOptional, IsEnum, IsBoolean, IsUUID, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '../entities/notification.entity';

export class GetNotificationsDto {
  @ApiPropertyOptional({ 
    description: 'Filtrar por tipo de notificación', 
    enum: NotificationType 
  })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({ 
    description: 'Filtrar por estado de lectura', 
    example: false 
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  read?: boolean;

  @ApiPropertyOptional({ 
    description: 'Filtrar por usuario receptor', 
    example: 'uuid-del-usuario' 
  })
  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @ApiPropertyOptional({ 
    description: 'Número de página', 
    example: 1,
    minimum: 1 
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ 
    description: 'Elementos por página', 
    example: 20,
    minimum: 1 
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  limit?: number;
}
