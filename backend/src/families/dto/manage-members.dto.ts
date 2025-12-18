import { IsUUID, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddMemberDto {
  @ApiProperty({ description: 'ID del usuario a agregar a la familia', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  userId: string;
}

export class RemoveMemberDto {
  @ApiProperty({ description: 'ID del usuario a remover de la familia', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  userId: string;
}

export class AddMembersDto {
  @ApiProperty({ 
    description: 'IDs de los usuarios a agregar a la familia',
    example: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43f7-8b9c-123456789abc'],
    type: [String]
  })
  @IsArray()
  @IsUUID('4', { each: true })
  userIds: string[];
}
