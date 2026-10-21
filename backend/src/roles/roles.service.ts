import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { isSystemRoleName } from '../common/constants/default-roles.constant';
import { assertPlatformSuperAdmin } from '../common/tenant/tenant-context.util';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../common/utils/unique-violation.util';

/** Quién muta roles: solo importa si es super-admin (chequeo explícito, P5 · D10). */
export type RoleEditor = Pick<TenantContext, 'isSuperAdmin'>;

/**
 * Roles (Fase 4 · P5, D10):
 *  - Los roles de sistema (`DEFAULT_ROLES`, por nombre) son inmutables por la
 *    API: no se renombran, no se borran y no cambian sus permisos (403). Su
 *    definición vive en el código (DataInitializationService los sincroniza).
 *  - Crear, editar o borrar roles personalizados y cambiar sus permisos es
 *    solo del super-admin, con chequeo EXPLÍCITO (no basta el permiso
 *    `roles.*` de la ruta).
 *  - Borrar un rol asignado a usuarios → 409.
 *  - La lectura (`roles.read`) no expone los usuarios de un rol.
 */
@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  async create(createRoleDto: CreateRoleDto, editor: RoleEditor) {
    assertPlatformSuperAdmin(
      editor,
      'Solo la plataforma (super-admin) puede crear roles',
    );
    this.assertNameNotReserved(createRoleDto.name);
    try {
      const newRole = this.roleRepository.create({
        name: createRoleDto.name,
        description: createRoleDto.description,
      });
      return await this.roleRepository.save(newRole);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException('El rol ya existe');
      }
      throw new InternalServerErrorException('Error al crear el rol');
    }
  }

  /**
   * `GET /roles`. Fase 4 · P5.C: cada rol incluye `isSystem` (rol de sistema,
   * `DEFAULT_ROLES`: inmutable por la API), para que la UI no ofrezca
   * editarlo ni borrarlo.
   */
  async findAll(): Promise<Array<Role & { isSystem: boolean }>> {
    try {
      const roles = await this.roleRepository.find({
        relations: ['permissions'],
        order: { name: 'ASC' },
      });
      return roles.map((role) =>
        Object.assign(role, { isSystem: isSystemRoleName(role.name) }),
      );
    } catch {
      throw new InternalServerErrorException(
        'Error al obtener todos los roles',
      );
    }
  }

  /** Rol con sus permisos. Sin `users` (PII de otros condominios, P5). */
  async findOne(id: string) {
    try {
      const role = await this.roleRepository.findOne({
        where: { id },
        relations: ['permissions'],
      });
      if (!role) {
        throw new NotFoundException(`Rol con ID ${id} no encontrado`);
      }
      return role;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al buscar el rol');
    }
  }

  /** Nombre y descripción de un rol personalizado. Devuelve el rol actualizado. */
  async update(id: string, updateRoleDto: UpdateRoleDto, editor: RoleEditor) {
    assertPlatformSuperAdmin(
      editor,
      'Solo la plataforma (super-admin) puede editar roles',
    );
    const role = await this.findOne(id);
    this.assertCustomRole(role, 'editar');

    const changes: Partial<Pick<Role, 'name' | 'description'>> = {};
    if (updateRoleDto.name !== undefined && updateRoleDto.name !== role.name) {
      this.assertNameNotReserved(updateRoleDto.name);
      changes.name = updateRoleDto.name;
    }
    if (updateRoleDto.description !== undefined) {
      changes.description = updateRoleDto.description;
    }
    if (Object.keys(changes).length === 0) {
      return role;
    }

    try {
      await this.roleRepository.update(id, changes);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException('El rol ya existe');
      }
      throw new InternalServerErrorException('Error al actualizar el rol');
    }
    return this.findOne(id);
  }

  async remove(id: string, editor: RoleEditor) {
    assertPlatformSuperAdmin(
      editor,
      'Solo la plataforma (super-admin) puede eliminar roles',
    );
    const role = await this.findOne(id);
    this.assertCustomRole(role, 'eliminar');

    const assignedUsers = await this.countUsersWithRole(id);
    if (assignedUsers > 0) {
      throw new ConflictException(
        `No se puede eliminar el rol "${role.name}": está asignado a ${assignedUsers} usuario(s)`,
      );
    }

    try {
      const result = await this.roleRepository.delete(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Rol con ID ${id} no encontrado`);
      }
      return { message: 'Rol eliminado exitosamente', deleted: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // FK sin cascada (p. ej. `camera_roles`) o un usuario asignado entre el
      // conteo y el borrado.
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          `No se puede eliminar el rol "${role.name}": todavía está en uso`,
        );
      }
      throw new InternalServerErrorException('Error al eliminar el rol');
    }
  }

  // Métodos específicos para gestión de permisos
  async getAllPermissions() {
    try {
      return await this.permissionRepository.find({
        order: { module: 'ASC', action: 'ASC' },
      });
    } catch {
      throw new InternalServerErrorException('Error al obtener los permisos');
    }
  }

  async getPermissionsByModule() {
    try {
      const permissions = await this.getAllPermissions();

      return permissions.reduce<Record<string, Permission[]>>(
        (acc, permission) => {
          if (!acc[permission.module]) {
            acc[permission.module] = [];
          }
          acc[permission.module].push(permission);
          return acc;
        },
        {},
      );
    } catch {
      throw new InternalServerErrorException(
        'Error al agrupar permisos por módulo',
      );
    }
  }

  /** Reemplaza los permisos de un rol personalizado (solo super-admin). */
  async updateRolePermissions(
    roleId: string,
    permissionIds: string[],
    editor: RoleEditor,
  ) {
    assertPlatformSuperAdmin(
      editor,
      'Solo la plataforma (super-admin) puede cambiar los permisos de un rol',
    );
    try {
      const role = await this.roleRepository.findOne({
        where: { id: roleId },
        relations: ['permissions'],
      });

      if (!role) {
        throw new NotFoundException(`Rol con ID ${roleId} no encontrado`);
      }
      this.assertCustomRole(role, 'cambiar los permisos de');

      // Verificar que todos los permisos existen
      const uniqueIds = [...new Set(permissionIds)];
      const permissions =
        uniqueIds.length === 0
          ? []
          : await this.permissionRepository.findBy({ id: In(uniqueIds) });

      if (permissions.length !== uniqueIds.length) {
        throw new NotFoundException('Algunos permisos no existen');
      }

      // Actualizar permisos del rol
      role.permissions = permissions;
      await this.roleRepository.save(role);

      return {
        message: `Permisos actualizados para el rol ${role.name}`,
        role: await this.findOne(roleId),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error al actualizar permisos del rol',
      );
    }
  }

  async getRolePermissions(roleId: string) {
    return this.findOne(roleId);
  }

  /** Filas de `user_roles_role` (incluye usuarios deshabilitados: la FK igual bloquea). */
  private async countUsersWithRole(roleId: string): Promise<number> {
    const rows = await this.roleRepository.query<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count" FROM user_roles_role WHERE "roleId" = $1`,
      [roleId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** 403 si es un rol de sistema (`DEFAULT_ROLES`). */
  private assertCustomRole(role: Pick<Role, 'name'>, verb: string): void {
    if (isSystemRoleName(role.name)) {
      throw new ForbiddenException(
        `No se puede ${verb} el rol de sistema "${role.name}": su definición vive en el código`,
      );
    }
  }

  /** 403 si el nombre es el de un rol de sistema (no se puede suplantar). */
  private assertNameNotReserved(name: string): void {
    if (isSystemRoleName(name)) {
      throw new ForbiddenException(
        `"${name}" es el nombre de un rol de sistema`,
      );
    }
  }
}
