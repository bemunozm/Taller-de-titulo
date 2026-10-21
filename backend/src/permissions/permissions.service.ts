import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { isSystemPermissionName } from '../common/constants/default-permissions.constant';
import { assertPlatformSuperAdmin } from '../common/tenant/tenant-context.util';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { isUniqueViolation } from '../common/utils/unique-violation.util';

/** Quién muta permisos: solo importa si es super-admin (P5 · D10). */
export type PermissionEditor = Pick<TenantContext, 'isSuperAdmin'>;

/**
 * Permisos (Fase 4 · P5, D10): crear, editar y borrar es solo del super-admin
 * (chequeo explícito). Los permisos de sistema (`DEFAULT_PERMISSIONS`) los usa
 * el código por nombre: no se renombran ni se borran (403).
 */
@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
  ) {}

  async create(
    createPermissionDto: CreatePermissionDto,
    editor: PermissionEditor,
  ): Promise<Permission> {
    assertPlatformSuperAdmin(
      editor,
      'Solo la plataforma (super-admin) puede crear permisos',
    );
    const permission = this.permissionRepository.create(createPermissionDto);
    try {
      return await this.permissionRepository.save(permission);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Ya existe un permiso "${createPermissionDto.name}"`,
        );
      }
      throw error;
    }
  }

  async findAll(): Promise<Permission[]> {
    return await this.permissionRepository.find({
      order: { module: 'ASC', action: 'ASC' },
    });
  }

  async findByModule(): Promise<{ [key: string]: Permission[] }> {
    const permissions = await this.findAll();

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
  }

  async findOne(id: string): Promise<Permission> {
    const permission = await this.permissionRepository.findOne({
      where: { id },
    });
    if (!permission) {
      throw new NotFoundException(`Permiso con ID ${id} no encontrado`);
    }
    return permission;
  }

  async update(
    id: string,
    updatePermissionDto: UpdatePermissionDto,
    editor: PermissionEditor,
  ): Promise<Permission> {
    assertPlatformSuperAdmin(
      editor,
      'Solo la plataforma (super-admin) puede editar permisos',
    );
    const permission = await this.findOne(id);
    const renames =
      updatePermissionDto.name !== undefined &&
      updatePermissionDto.name !== permission.name;
    if (renames && isSystemPermissionName(permission.name)) {
      throw new ForbiddenException(
        `El permiso de sistema "${permission.name}" no se puede renombrar`,
      );
    }
    if (renames && isSystemPermissionName(updatePermissionDto.name ?? '')) {
      throw new ForbiddenException(
        `"${updatePermissionDto.name}" es el nombre de un permiso de sistema`,
      );
    }

    try {
      await this.permissionRepository.update(id, updatePermissionDto);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Ya existe un permiso "${updatePermissionDto.name}"`,
        );
      }
      throw error;
    }
    return this.findOne(id);
  }

  async remove(id: string, editor: PermissionEditor): Promise<void> {
    assertPlatformSuperAdmin(
      editor,
      'Solo la plataforma (super-admin) puede eliminar permisos',
    );
    const permission = await this.findOne(id);
    if (isSystemPermissionName(permission.name)) {
      throw new ForbiddenException(
        `El permiso de sistema "${permission.name}" no se puede eliminar`,
      );
    }
    await this.permissionRepository.remove(permission);
  }
}
