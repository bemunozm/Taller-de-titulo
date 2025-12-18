import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateAccountByAdminDto } from './dto/create-account-by-admin.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from '../roles/entities/role.entity';
import { Family } from '../families/entities/family.entity';
import { Repository } from 'typeorm';
import { TokensService } from '../tokens/tokens.service';
import { AuthEmailService } from '../auth/services/auth-email.service';
import { hashPassword } from '../auth/utils/auth.util';
import * as crypto from 'crypto';

// Función para generar token de 6 dígitos
const generateToken = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

@Injectable()
export class UsersService {

  //CONSTRUCTOR
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(Role) private roleRepository: Repository<Role>,
    @InjectRepository(Family) private familyRepository: Repository<Family>,
    private readonly tokensService: TokensService,
    private readonly authEmailService: AuthEmailService,
  ) {}



  //METODOS
  async create(createUserDto: CreateUserDto) {
    try {
      const newUser = this.userRepository.create(createUserDto);
      return await this.userRepository.save(newUser);
    } catch (error) {
      if (error.code === '23505') { // Duplicate key error
        throw new BadRequestException('El email ya está en uso');
      }
      throw new InternalServerErrorException('Error al crear el usuario');
    }
  }

  async createAccountByAdmin(createAccountByAdminDto: CreateAccountByAdminDto) {
    try {
      // Verificar si el email ya existe
      const existingUser = await this.findByEmail(createAccountByAdminDto.email);
      if (existingUser) {
        throw new BadRequestException('El email ya está en uso');
      }

      // Generar contraseña aleatoria segura (16 caracteres)
      const randomPassword = crypto.randomBytes(16).toString('hex');

      // Crear usuario con contraseña generada y hasheada
      const newUser = this.userRepository.create({
        ...createAccountByAdminDto,
        password: await hashPassword(randomPassword),
        confirmed: false, // El usuario debe confirmar su cuenta
      });

      // Asignar roles si se proporcionaron
      if (createAccountByAdminDto.roleIds && createAccountByAdminDto.roleIds.length > 0) {
        const roles = await this.roleRepository.findByIds(createAccountByAdminDto.roleIds);
        if (roles.length !== createAccountByAdminDto.roleIds.length) {
          throw new BadRequestException('Uno o más roles no son válidos');
        }
        newUser.roles = roles;
      }

      // Asignar familia si se proporcionó
      if (createAccountByAdminDto.familyId) {
        const family = await this.familyRepository.findOne({ 
          where: { id: createAccountByAdminDto.familyId } 
        });
        if (!family) {
          throw new BadRequestException('La familia especificada no existe');
        }
        newUser.family = family;
      }

      // Guardar usuario
      const savedUser = await this.userRepository.save(newUser);

      // Generar token de recuperación de contraseña
      const tokenValue = generateToken();
      await this.tokensService.create({
        token: tokenValue,
        userId: savedUser.id,
      });

      // Enviar email de bienvenida con token
      await this.authEmailService.sendAccountCreatedByAdminEmail(savedUser, tokenValue);

      return savedUser;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error.code === '23505') {
        throw new BadRequestException('El email o RUT ya está en uso');
      }
      console.error('Error al crear cuenta por admin:', error);
      throw new InternalServerErrorException('Error al crear la cuenta');
    }
  }

  async findAll(userId?: string) {
    try {
      // Si hay userId (residente filtrado por interceptor), devolver solo ese usuario
      console.log('UsersService - findAll - userId:', userId);
      if (userId) {
        const user = await this.userRepository.findOne({
          where: { id: userId },
          relations: ['roles', 'family'],
          withDeleted: true
        });
        return user ? [user] : [];
      }

      // Admin: devolver todos los usuarios
      return await this.userRepository.find({
        relations: ['roles', 'family'],
        withDeleted: true,
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener todos los usuarios');
    }
  }

  async findOne(id: string) {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
        relations: ['roles', 'roles.permissions', 'family']
      });
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al buscar el usuario');
    }
  }

  async findByEmail(email: string) {
    try {
      return await this.userRepository.findOne({ where: { email: email.toLowerCase() } });
    } catch (error) {
      throw new InternalServerErrorException('Error al buscar usuario por email');
    }
  }

  async findByEmailWithPassword(email: string) {
    try {
      const user = await this.userRepository.findOne({ 
        where: { email: email.toLowerCase() },
        select: ['id', 'email', 'password', 'name', 'confirmed'],
        relations: ['roles', 'roles.permissions']
      });
      
      return user;
    } catch (error) {
      throw new InternalServerErrorException('Error al buscar usuario por email con password');
    }
  }

  async findByIdWithPassword(id: string) {
    try {
      const user = await this.userRepository.findOne({ 
        where: { id },
        select: ['id', 'password']
      });
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al buscar usuario por ID con password');
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      // Buscar el usuario primero
      const user = await this.userRepository.findOne({ 
        where: { id },
        relations: ['roles', 'family']
      });
      
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }

      // Actualizar roles si se proporcionaron
      if (updateUserDto.roleIds !== undefined) {
        if (updateUserDto.roleIds && updateUserDto.roleIds.length > 0) {
          const roles = await this.roleRepository.findByIds(updateUserDto.roleIds);
          if (roles.length !== updateUserDto.roleIds.length) {
            throw new BadRequestException('Uno o más roles no son válidos');
          }
          user.roles = roles;
        } else {
          user.roles = [];
        }
      }

      // Actualizar familia si se proporcionó
      if (updateUserDto.familyId !== undefined) {
        if (updateUserDto.familyId) {
          const family = await this.familyRepository.findOne({ 
            where: { id: updateUserDto.familyId } 
          });
          if (!family) {
            throw new BadRequestException('La familia especificada no existe');
          }
          user.family = family;
        } else {
          user.family = null;
        }
      }

      // Actualizar otros campos
      const { roleIds, familyId, ...otherFields } = updateUserDto;
      Object.assign(user, otherFields);

      // Guardar usuario actualizado
      const updatedUser = await this.userRepository.save(user);
      return updatedUser;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      if (error.code === '23505') {
        throw new BadRequestException('El email ya está en uso');
      }
      throw new InternalServerErrorException('Error al actualizar el usuario');
    }
  }

  async save(user: User) {
    try {
      return await this.userRepository.save(user);
    } catch (error) {
      if (error.code === '23505') {
        throw new BadRequestException('El email ya está en uso');
      }
      throw new InternalServerErrorException('Error al guardar el usuario');
    }
  }

  async findOneWithFamily(id: string) {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
        relations: ['family', 'family.members'],
      });
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al buscar usuario con familia');
    }
  }

  async findByRole(roleName: string) {
    try {
      return await this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.roles', 'role')
        .where('role.name = :roleName', { roleName })
        .getMany();
    } catch (error) {
      throw new InternalServerErrorException('Error al buscar usuarios por rol');
    }
  }

  async findByFamily(familyId: string) {
    try {
      return await this.userRepository.find({
        where: { family: { id: familyId } },
        relations: ['roles']
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al buscar usuarios por familia');
    }
  }

  async remove(id: string) {
    try {
      const result = await this.userRepository.delete(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al eliminar el usuario');
    }
  }

  async disable(id: string) {
    try {
      const user = await this.userRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      
      const result = await this.userRepository.softDelete(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return { message: 'Usuario deshabilitado exitosamente', affected: result.affected };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al deshabilitar el usuario');
    }
  }

  async enable(id: string) {
    try {
      const user = await this.userRepository.findOne({ 
        where: { id },
        withDeleted: true 
      });
      
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      
      if (!user.deletedAt) {
        throw new BadRequestException('El usuario ya está habilitado');
      }
      
      const result = await this.userRepository.restore(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return { message: 'Usuario habilitado exitosamente', affected: result.affected };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al habilitar el usuario');
    }
  }
}
