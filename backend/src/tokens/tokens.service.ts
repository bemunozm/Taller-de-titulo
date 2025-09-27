import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { CreateTokenDto } from './dto/create-token.dto';
import { UpdateTokenDto } from './dto/update-token.dto';
import { Token } from './entities/token.entity';

@Injectable()
export class TokensService {
  constructor(
    @InjectRepository(Token)
    private readonly tokenRepository: Repository<Token>
  ) {}

  async create(createTokenDto: CreateTokenDto) {
    try {
      const newToken = this.tokenRepository.create(createTokenDto);
      return await this.tokenRepository.save(newToken);
    } catch (error) {
      throw new InternalServerErrorException('Error al crear el token');
    }
  }

  async findByToken(token: string) {
    try {
      const foundToken = await this.tokenRepository.findOne({ where: { token } });
      if (!foundToken) {
        throw new NotFoundException('Token no encontrado');
      }
      
      // Verificar si el token ha expirado
      if (foundToken.isExpired()) {
        // Eliminar el token expirado
        await this.tokenRepository.remove(foundToken);
        throw new NotFoundException('Token expirado');
      }
      
      return foundToken;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al buscar el token');
    }
  }

  async findByTokenWithUser(token: string) {
    try {
      const foundToken = await this.tokenRepository.findOne({ 
        where: { token }, 
        relations: ['user'] 
      });
      if (!foundToken) {
        throw new NotFoundException('Token no encontrado');
      }
      
      // Verificar si el token ha expirado
      if (foundToken.isExpired()) {
        // Eliminar el token expirado
        await this.tokenRepository.remove(foundToken);
        throw new NotFoundException('Token expirado');
      }
      
      return foundToken;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al buscar el token con usuario');
    }
  }

  async remove(id: string) {
    try {
      const foundToken = await this.findOne(id);
      if (!foundToken) {
        throw new NotFoundException('Token no encontrado');
      }
      return await this.tokenRepository.remove(foundToken);
    } catch (error) {
      throw new InternalServerErrorException('Error al eliminar el token');
    }
  }

  async findAll() {
    try {
      return await this.tokenRepository.find();
    } catch (error) {
      throw new InternalServerErrorException('Error al obtener todos los tokens');
    }
  }

  async findOne(id: string) {
    try {
      const token = await this.tokenRepository.findOne({ where: { id } });
      if (!token) {
        throw new NotFoundException(`Token con ID ${id} no encontrado`);
      }
      return token;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al buscar el token por ID');
    }
  }

  async update(id: string, updateTokenDto: UpdateTokenDto) {
    try {
      const result = await this.tokenRepository.update(id, updateTokenDto);
      if (result.affected === 0) {
        throw new NotFoundException(`Token con ID ${id} no encontrado`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al actualizar el token');
    }
  }

  /**
   * Elimina todos los tokens expirados de la base de datos
   * Este método puede ser llamado periódicamente para limpiar tokens antiguos
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const expiredTokens = await this.tokenRepository.find({
        where: {
          expiresAt: LessThan(new Date())
        }
      });

      if (expiredTokens.length > 0) {
        await this.tokenRepository.remove(expiredTokens);
        console.log(`Se eliminaron ${expiredTokens.length} tokens expirados`);
        return expiredTokens.length;
      }
      
      return 0;
    } catch (error) {
      console.error('Error al limpiar tokens expirados:', error);
      throw new InternalServerErrorException('Error al limpiar tokens expirados');
    }
  }

  /**
   * Elimina todos los tokens asociados a un usuario específico
   * Útil cuando un usuario cambia su contraseña o se desloguea
   */
  async removeTokensByUserId(userId: string): Promise<void> {
    try {
      await this.tokenRepository.delete({ userId });
    } catch (error) {
      throw new InternalServerErrorException('Error al eliminar tokens del usuario');
    }
  }
}
