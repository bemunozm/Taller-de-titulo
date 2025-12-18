import { IsUUID, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkAsReadDto {
  @ApiProperty({ 
    description: 'IDs de las notificaciones a marcar como leídas',
    example: ['uuid-1', 'uuid-2'] 
  })
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];
}
