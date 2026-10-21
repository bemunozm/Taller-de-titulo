import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

/** Body de `PUT /roles/:id/permissions` (reemplaza todos los permisos del rol). */
export class UpdateRolePermissionsDto {
  @ApiProperty({
    description:
      'IDs de los permisos que tendrá el rol (reemplaza los actuales)',
    example: ['perm-uuid-1', 'perm-uuid-2'],
    type: [String],
  })
  @IsArray({ message: 'Los permisos deben ser un array de IDs' })
  @IsUUID('all', { each: true, message: 'Cada permiso debe ser un ID válido' })
  permissionIds: string[];
}
