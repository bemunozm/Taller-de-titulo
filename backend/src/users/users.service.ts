import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {

  //CONSTRUCTOR
  constructor(@InjectRepository(User) private userRepository: Repository<User>) {}



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

  async findAll() {
    try {
      return await this.userRepository.find();
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener todos los usuarios');
    }
  }

  async findOne(id: string) {
    try {
      const user = await this.userRepository.findOneBy({ id });
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
        select: ['id', 'email', 'password', 'name', 'confirmed']
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
      const result = await this.userRepository.update(id, updateUserDto);
      if (result.affected === 0) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
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
}
