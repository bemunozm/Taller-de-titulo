import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../roles/entities/role.entity';
import { Permission } from '../../permissions/entities/permission.entity';

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
    
    const defaultPermissions = [
      // Gestión de usuarios
      { name: 'users.create', description: 'Crear usuarios', module: 'users', action: 'create' },
      { name: 'users.read', description: 'Ver usuarios', module: 'users', action: 'read' },
      { name: 'users.update', description: 'Actualizar usuarios', module: 'users', action: 'update' },
      { name: 'users.delete', description: 'Eliminar usuarios', module: 'users', action: 'delete' },
      { name: 'users.profile', description: 'Ver perfil propio', module: 'users', action: 'profile' },

      // Gestión de roles
      { name: 'roles.create', description: 'Crear roles', module: 'roles', action: 'create' },
      { name: 'roles.read', description: 'Ver roles', module: 'roles', action: 'read' },
      { name: 'roles.update', description: 'Actualizar roles y permisos', module: 'roles', action: 'update' },
      { name: 'roles.delete', description: 'Eliminar roles', module: 'roles', action: 'delete' },

      // Gestión de permisos
      { name: 'permissions.create', description: 'Crear permisos', module: 'permissions', action: 'create' },
      { name: 'permissions.read', description: 'Ver permisos', module: 'permissions', action: 'read' },
      { name: 'permissions.update', description: 'Actualizar permisos', module: 'permissions', action: 'update' },
      { name: 'permissions.delete', description: 'Eliminar permisos', module: 'permissions', action: 'delete' },

      // Panel administrativo
      { name: 'admin.dashboard', description: 'Acceder al panel administrativo', module: 'admin', action: 'dashboard' },
      { name: 'admin.reports', description: 'Ver reportes', module: 'admin', action: 'reports' },
      { name: 'admin.settings', description: 'Configurar sistema', module: 'admin', action: 'settings' },

      // Módulo de residentes
      { name: 'residents.read', description: 'Ver información de residentes', module: 'residents', action: 'read' },
      { name: 'residents.update', description: 'Actualizar datos de residentes', module: 'residents', action: 'update' },
      { name: 'residents.create', description: 'Registrar nuevos residentes', module: 'residents', action: 'create' },
      { name: 'residents.delete', description: 'Eliminar residentes', module: 'residents', action: 'delete' },

      // Módulo de conserjerÍa
      { name: 'maintenance.create', description: 'Crear solicitudes de mantenimiento', module: 'maintenance', action: 'create' },
      { name: 'maintenance.read', description: 'Ver solicitudes de mantenimiento', module: 'maintenance', action: 'read' },
      { name: 'maintenance.update', description: 'Actualizar estado de mantenimiento', module: 'maintenance', action: 'update' },
      { name: 'maintenance.assign', description: 'Asignar solicitudes de mantenimiento', module: 'maintenance', action: 'assign' },

      // Módulo de visitantes
      { name: 'visitors.create', description: 'Registrar visitantes', module: 'visitors', action: 'create' },
      { name: 'visitors.read', description: 'Ver registro de visitantes', module: 'visitors', action: 'read' },
      { name: 'visitors.update', description: 'Actualizar datos de visitantes', module: 'visitors', action: 'update' },
      { name: 'visitors.authorize', description: 'Autorizar acceso de visitantes', module: 'visitors', action: 'authorize' },
    ];

    for (const permData of defaultPermissions) {
      const existingPermission = await this.permissionRepository.findOne({
        where: { name: permData.name }
      });

      if (!existingPermission) {
        const permission = this.permissionRepository.create(permData);
        await this.permissionRepository.save(permission);
        console.log(`   ✅ Permiso creado: ${permData.name}`);
      }
    }
  }

  private async initializeRoles() {
    console.log('👥 Creando roles por defecto...');
    
    const defaultRoles = [
      { name: 'Administrador', description: 'Acceso completo al sistema' },
      { name: 'Conserje', description: 'Gestión de mantenimiento y seguridad' },
      { name: 'Residente', description: 'Acceso básico para residentes' },
      { name: 'Desarrollador', description: 'Acceso técnico para desarrollo' }
    ];

    for (const roleData of defaultRoles) {
      const existingRole = await this.roleRepository.findOne({
        where: { name: roleData.name }
      });

      if (!existingRole) {
        const role = this.roleRepository.create(roleData);
        await this.roleRepository.save(role);
        console.log(`   ✅ Rol creado: ${roleData.name}`);
      }
    }
  }

  private async assignDefaultPermissions() {
    console.log('🔗 Asignando permisos por defecto a roles...');

    // Administrador - todos los permisos
    await this.assignPermissionsToRole('Administrador', null); // null = todos los permisos

    // Desarrollador - permisos técnicos
    await this.assignPermissionsToRole('Desarrollador', [
      'admin.dashboard', 'admin.settings', 'admin.reports',
      'roles.read', 'roles.update', 'roles.create',
      'permissions.read', 'permissions.create', 'permissions.update',
      'users.read', 'users.create', 'users.update'
    ]);

    // Conserje - permisos operativos
    await this.assignPermissionsToRole('Conserje', [
      'maintenance.create', 'maintenance.read', 'maintenance.update', 'maintenance.assign',
      'visitors.create', 'visitors.read', 'visitors.update', 'visitors.authorize',
      'residents.read', 'residents.update',
      'users.profile'
    ]);

    // Residente - permisos básicos
    await this.assignPermissionsToRole('Residente', [
      'users.profile',
      'maintenance.create', 'maintenance.read',
      'residents.read',
      'visitors.create', 'visitors.read'
    ]);
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