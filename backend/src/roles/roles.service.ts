import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>
  ) {}

  async create(createRoleDto: CreateRoleDto) {
    try {
      const newRole = this.roleRepository.create(createRoleDto);
      return await this.roleRepository.save(newRole);
    } catch (error) {
      if (error.code === '23505') { // Duplicate key error
        throw new BadRequestException('El rol ya existe');
      }
      throw new InternalServerErrorException('Error al crear el rol');
    }
  }

  async findAll() {
    try {
      return await this.roleRepository.find({
        relations: ['permissions'],
        order: { name: 'ASC' }
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener todos los roles');
    }
  }

  async findOne(id: string) {
    try {
      const role = await this.roleRepository.findOne({ 
        where: { id },
        relations: ['permissions', 'users']
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

  async update(id: string, updateRoleDto: UpdateRoleDto) {
    try {
      const result = await this.roleRepository.update(id, updateRoleDto);
      if (result.affected === 0) {
        throw new NotFoundException(`Rol con ID ${id} no encontrado`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error.code === '23505') {
        throw new BadRequestException('El rol ya existe');
      }
      throw new InternalServerErrorException('Error al actualizar el rol');
    }
  }

  async remove(id: string) {
    try {
      const result = await this.roleRepository.delete(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Rol con ID ${id} no encontrado`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al eliminar el rol');
    }
  }

  // Métodos específicos para gestión de permisos
  async getAllPermissions() {
    try {
      return await this.permissionRepository.find({
        order: { module: 'ASC', action: 'ASC' }
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener los permisos');
    }
  }

  async getPermissionsByModule() {
    try {
      const permissions = await this.getAllPermissions();
      
      return permissions.reduce((acc, permission) => {
        if (!acc[permission.module]) {
          acc[permission.module] = [];
        }
        acc[permission.module].push(permission);
        return acc;
      }, {});
    } catch (error) {
      throw new InternalServerErrorException('Error al agrupar permisos por módulo');
    }
  }

  async updateRolePermissions(roleId: string, permissionIds: string[]) {
    try {
      const role = await this.roleRepository.findOne({
        where: { id: roleId },
        relations: ['permissions']
      });

      if (!role) {
        throw new NotFoundException(`Rol con ID ${roleId} no encontrado`);
      }

      // Verificar que todos los permisos existen
      const permissions = await this.permissionRepository.findByIds(permissionIds);
      
      if (permissions.length !== permissionIds.length) {
        throw new NotFoundException('Algunos permisos no existen');
      }

      // Actualizar permisos del rol
      role.permissions = permissions;
      await this.roleRepository.save(role);

      return {
        message: `Permisos actualizados para el rol ${role.name}`,
        role: await this.findOne(roleId)
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al actualizar permisos del rol');
    }
  }

  async getRolePermissions(roleId: string) {
    try {
      return await this.findOne(roleId);
    } catch (error) {
      throw error;
    }
  }
}
