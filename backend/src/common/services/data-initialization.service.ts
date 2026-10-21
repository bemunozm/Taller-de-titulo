import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '../../roles/entities/role.entity';
import { Permission } from '../../permissions/entities/permission.entity';
import { DEFAULT_PERMISSIONS } from '../constants/default-permissions.constant';
import {
  DEFAULT_ROLES,
  type RoleDefinition,
} from '../constants/default-roles.constant';
import { PLATFORM_SUPER_ADMIN_ROLE } from '../tenant/tenant-context.types';

/** Resultado de sincronizar un rol de sistema (para logs y tests). */
export interface SystemRoleSyncResult {
  role: string;
  added: string[];
  removed: string[];
}

/**
 * Siembra y sincroniza permisos y roles de sistema al arrancar.
 *
 * Fase 4 · P5 (D10): los roles de sistema (`DEFAULT_ROLES`) se definen en el
 * código. En cada arranque cada uno queda EXACTAMENTE con los permisos de su
 * definición: se agregan los que falten y se quitan los que sobren (antes, un
 * rol con al menos un permiso no se tocaba y un permiso nuevo nunca llegaba a
 * los roles ya sembrados). El "Super Administrador" queda con todos los
 * permisos que existan. La API no puede cambiar estos roles (RolesService).
 */
@Injectable()
export class DataInitializationService implements OnModuleInit {
  private readonly logger = new Logger(DataInitializationService.name);

  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
  ) {}

  async onModuleInit() {
    this.logger.log('Inicializando datos del sistema...');
    await this.initializePermissions();
    await this.initializeRoles();
    await this.syncSystemRoles();
    this.logger.log('Inicialización de datos completada');
  }

  private async initializePermissions() {
    for (const permData of DEFAULT_PERMISSIONS) {
      const existingPermission = await this.permissionRepository.findOne({
        where: { name: permData.name },
      });

      if (!existingPermission) {
        const permission = this.permissionRepository.create(permData);
        await this.permissionRepository.save(permission);
        this.logger.log(`Permiso creado: ${permData.name}`);
      }
    }

    this.logger.log(
      `Total de permisos de sistema: ${DEFAULT_PERMISSIONS.length}`,
    );
  }

  private async initializeRoles() {
    for (const roleData of DEFAULT_ROLES) {
      const existingRole = await this.roleRepository.findOne({
        where: { name: roleData.name },
      });

      if (!existingRole) {
        const role = this.roleRepository.create({
          name: roleData.name,
          description: roleData.description,
        });
        await this.roleRepository.save(role);
        this.logger.log(`Rol creado: ${roleData.name}`);
      }
    }

    this.logger.log(`Total de roles de sistema: ${DEFAULT_ROLES.length}`);
  }

  /** Deja cada rol de sistema con exactamente los permisos de su definición. */
  async syncSystemRoles(): Promise<SystemRoleSyncResult[]> {
    const results: SystemRoleSyncResult[] = [];
    for (const definition of DEFAULT_ROLES) {
      const result = await this.syncSystemRole(definition);
      if (result) {
        results.push(result);
      }
    }
    return results;
  }

  private async syncSystemRole(
    definition: RoleDefinition,
  ): Promise<SystemRoleSyncResult | null> {
    const role = await this.roleRepository.findOne({
      where: { name: definition.name },
      relations: ['permissions'],
    });
    if (!role) {
      this.logger.error(`Rol de sistema ${definition.name} no encontrado`);
      return null;
    }

    const desired = await this.desiredPermissionsFor(definition);
    const desiredNames = new Set(desired.map((permission) => permission.name));
    const currentNames = new Set(
      (role.permissions ?? []).map((permission) => permission.name),
    );
    const added = [...desiredNames].filter((name) => !currentNames.has(name));
    const removed = [...currentNames].filter((name) => !desiredNames.has(name));

    if (added.length === 0 && removed.length === 0) {
      return { role: definition.name, added, removed };
    }

    role.permissions = desired;
    await this.roleRepository.save(role);
    this.logger.log(
      `Rol de sistema ${definition.name} sincronizado: +${added.length} [${added.join(', ')}] / -${removed.length} [${removed.join(', ')}]`,
    );
    return { role: definition.name, added, removed };
  }

  /** Permisos que debe tener un rol de sistema (Super Administrador: todos). */
  private async desiredPermissionsFor(
    definition: RoleDefinition,
  ): Promise<Permission[]> {
    if (definition.name === PLATFORM_SUPER_ADMIN_ROLE) {
      return this.permissionRepository.find();
    }
    if (definition.permissions.length === 0) {
      return [];
    }

    const permissions = await this.permissionRepository.find({
      where: { name: In(definition.permissions) },
    });
    if (permissions.length !== new Set(definition.permissions).size) {
      const found = new Set(permissions.map((permission) => permission.name));
      const missing = definition.permissions.filter((name) => !found.has(name));
      this.logger.warn(
        `El rol ${definition.name} referencia permisos que no existen: ${missing.join(', ')}`,
      );
    }
    return permissions;
  }
}
