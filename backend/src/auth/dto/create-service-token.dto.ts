import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateServiceTokenDto {
  @ApiProperty({
    description: 'Duración del token de servicio',
    example: '365d',
    required: false,
    default: '365d',
    enum: ['30d', '90d', '180d', '365d']
  })
  @IsOptional()
  @IsString()
  @IsIn(['30d', '90d', '180d', '365d'])
  duration?: string = '365d';

  @ApiProperty({
    description: 'Descripción o propósito del token',
    example: 'Token para LPR Worker Manager',
    required: false
  })
  @IsOptional()
  @IsString()
  description?: string;
}
