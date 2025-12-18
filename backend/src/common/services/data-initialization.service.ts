import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../roles/entities/role.entity';
import { Permission } from '../../permissions/entities/permission.entity';
import { DEFAULT_PERMISSIONS } from '../constants/default-permissions.constant';
import { DEFAULT_ROLES } from '../constants/default-roles.constant';

@Injectable()
export class DataInitializationService implements OnModuleInit {
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
  ) {}

  async onModuleInit() {
    console.log('🔄 Inicializando datos del sistema...');
    await this.initializePermissions();
    await this.initializeRoles();
    await this.assignDefaultPermissions();
    console.log('✅ Inicialización de datos completada');
  }

  private async initializePermissions() {
    console.log('📋 Creando permisos por defecto...');
    
    for (const permData of DEFAULT_PERMISSIONS) {
      const existingPermission = await this.permissionRepository.findOne({
        where: { name: permData.name }
      });

      if (!existingPermission) {
        const permission = this.permissionRepository.create(permData);
        await this.permissionRepository.save(permission);
        console.log(`   ✅ Permiso creado: ${permData.name}`);
      }
    }
    
    console.log(`   ℹ️  Total de permisos en el sistema: ${DEFAULT_PERMISSIONS.length}`);
  }

  private async initializeRoles() {
    console.log('👥 Creando roles por defecto...');
    
    for (const roleData of DEFAULT_ROLES) {
      const existingRole = await this.roleRepository.findOne({
        where: { name: roleData.name }
      });

      if (!existingRole) {
        const role = this.roleRepository.create({
          name: roleData.name,
          description: roleData.description
        });
        await this.roleRepository.save(role);
        console.log(`   ✅ Rol creado: ${roleData.name}`);
      }
    }
    
    console.log(`   ℹ️  Total de roles en el sistema: ${DEFAULT_ROLES.length}`);
  }

  private async assignDefaultPermissions() {
    console.log('🔗 Asignando permisos por defecto a roles...');

    for (const roleDefinition of DEFAULT_ROLES) {
      await this.assignPermissionsToRole(
        roleDefinition.name,
        roleDefinition.permissions.length === 0 ? null : roleDefinition.permissions
      );
    }
  }

  private async assignPermissionsToRole(roleName: string, permissionNames: string[] | null) {
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
      relations: ['permissions']
    });

    if (!role) {
      console.log(`   ❌ Rol ${roleName} no encontrado`);
      return;
    }

    // Si ya tiene permisos asignados, no los sobreescribir
    if (role.permissions && role.permissions.length > 0) {
      console.log(`   ℹ️  El rol ${roleName} ya tiene permisos asignados`);
      return;
    }

    let permissions;
    
    if (permissionNames === null) {
      // Asignar todos los permisos (para Administrador)
      permissions = await this.permissionRepository.find();
    } else {
      // Asignar permisos específicos
      permissions = await this.permissionRepository
        .createQueryBuilder('permission')
        .where('permission.name IN (:...names)', { names: permissionNames })
        .getMany();
    }

    if (permissions.length > 0) {
      role.permissions = permissions;
      await this.roleRepository.save(role);
      console.log(`   ✅ Permisos asignados al rol ${roleName} (${permissions.length} permisos)`);
    } else {
      console.log(`   ⚠️  No se encontraron permisos para asignar al rol ${roleName}`);
    }
  }
}