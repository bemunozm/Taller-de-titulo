import { Injectable, NotFoundException, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Family } from './entities/family.entity';
import { CreateFamilyDto } from './dto/create-family.dto';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, NotificationPriority } from '../notifications/entities/notification.entity';
import { UnitsService } from '../units/units.service';

@Injectable()
export class FamiliesService {
  private readonly logger = new Logger(FamiliesService.name);

  constructor(
    @InjectRepository(Family)
    private readonly familyRepository: Repository<Family>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly unitsService: UnitsService,
  ) {}

  async create(createFamilyDto: CreateFamilyDto): Promise<Family> {
    // Si se proporciona un unitId, verificar que la unidad existe y está disponible
    if (createFamilyDto.unitId) {
      const unit = await this.unitsService.findOne(createFamilyDto.unitId);
      
      // Verificar que no haya otra familia ACTIVA en esa unidad
      const activeFamily = await this.familyRepository.findOne({
        where: {
          unit: { id: createFamilyDto.unitId },
          active: true,
        },
      });

      if (activeFamily) {
        throw new ConflictException(
          `La unidad ${unit.identifier} ya tiene asignada la familia activa "${activeFamily.name}". ` +
          `Desactiva la familia actual antes de asignar una nueva.`
        );
      }
    }

    const family = this.familyRepository.create({
      name: createFamilyDto.name,
      description: createFamilyDto.description,
      active: createFamilyDto.active ?? true,
      unit: createFamilyDto.unitId ? { id: createFamilyDto.unitId } as any : null,
    });
    
    return await this.familyRepository.save(family);
  }

  async findAll(): Promise<Family[]> {
    return await this.familyRepository.find({
      relations: ['members'],
    });
  }

  async findOne(id: string): Promise<Family> {
    const family = await this.familyRepository.findOne({
      where: { id },
      relations: ['members'],
    });

    if (!family) {
      throw new NotFoundException(`Familia con ID ${id} no encontrada`);
    }

    return family;
  }

  async update(id: string, updateFamilyDto: Partial<CreateFamilyDto>): Promise<Family> {
    const family = await this.findOne(id);
    
    // Si se actualiza el unitId, verificar disponibilidad
    if (updateFamilyDto.unitId !== undefined) {
      if (updateFamilyDto.unitId) {
        const unit = await this.unitsService.findOne(updateFamilyDto.unitId);
        
        // Verificar que no haya otra familia ACTIVA en esa unidad (excepto esta si está activa)
        const activeFamily = await this.familyRepository.findOne({
          where: {
            unit: { id: updateFamilyDto.unitId },
            active: true,
          },
        });

        if (activeFamily && activeFamily.id !== id) {
          throw new ConflictException(
            `La unidad ${unit.identifier} ya tiene asignada la familia activa "${activeFamily.name}". ` +
            `Desactiva la familia actual antes de asignar esta unidad.`
          );
        }
        
        family.unit = unit;
      } else {
        // Si se pasa null, remover la asignación
        family.unit = null;
      }
    }
    
    if (updateFamilyDto.name !== undefined) {
      family.name = updateFamilyDto.name;
    }
    
    if (updateFamilyDto.description !== undefined) {
      family.description = updateFamilyDto.description || null;
    }
    
    if (updateFamilyDto.active !== undefined) {
      family.active = updateFamilyDto.active;
    }
    
    return await this.familyRepository.save(family);
  }

  async remove(id: string): Promise<void> {
    const family = await this.findOne(id);
    await this.familyRepository.remove(family);
  }

  // Agregar un miembro a la familia
  async addMember(familyId: string, userId: string): Promise<Family> {
    const family = await this.findOne(familyId);
    
    const user = await this.userRepository.findOne({ 
      where: { id: userId },
      relations: ['family']
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${userId} no encontrado`);
    }

    // Verificar si el usuario ya pertenece a otra familia
    if (user.family && user.family.id !== familyId) {
      throw new BadRequestException(
        `El usuario ya pertenece a la familia "${user.family.name}". Debe ser removido primero.`
      );
    }

    // Si ya pertenece a esta familia, no hacer nada
    if (user.family && user.family.id === familyId) {
      return family;
    }

    user.family = family;
    await this.userRepository.save(user);

    this.logger.log(`Usuario ${user.name} agregado a la familia ${family.name}`);

    // Enviar notificación al usuario agregado
    await this.notificationsService.create({
      recipientId: userId,
      type: NotificationType.FAMILY_UPDATE,
      title: 'Agregado a Familia',
      message: `Has sido agregado a la familia "${family.name}"`,
      priority: NotificationPriority.NORMAL,
      data: {
        familyId: family.id,
        familyName: family.name,
        unitIdentifier: family.unit?.identifier || null,
      },
    });

    // Notificar a todos los demás miembros de la familia
    const updatedFamily = await this.findOne(familyId);
    const otherMembers = updatedFamily.members.filter(m => m.id !== userId);

    for (const member of otherMembers) {
      await this.notificationsService.create({
        recipientId: member.id,
        type: NotificationType.FAMILY_UPDATE,
        title: 'Nuevo Miembro en la Familia',
        message: `${user.name} ha sido agregado a tu familia`,
        priority: NotificationPriority.NORMAL,
        data: {
          familyId: family.id,
          familyName: family.name,
          newMemberId: userId,
          newMemberName: user.name,
        },
      });
    }

    return updatedFamily;
  }

  // Remover un miembro de la familia
  async removeMember(familyId: string, userId: string): Promise<Family> {
    const family = await this.findOne(familyId);
    
    const user = await this.userRepository.findOne({ 
      where: { id: userId },
      relations: ['family']
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${userId} no encontrado`);
    }

    if (!user.family || user.family.id !== familyId) {
      throw new BadRequestException(
        `El usuario no pertenece a esta familia`
      );
    }

    const userName = user.name;
    user.family = null as any;
    await this.userRepository.save(user);

    this.logger.log(`Usuario ${userName} removido de la familia ${family.name}`);

    // Enviar notificación al usuario removido
    await this.notificationsService.create({
      recipientId: userId,
      type: NotificationType.FAMILY_UPDATE,
      title: 'Removido de Familia',
      message: `Has sido removido de la familia "${family.name}"`,
      priority: NotificationPriority.NORMAL,
      data: {
        familyId: family.id,
        familyName: family.name,
      },
    });

    // Notificar a los miembros restantes de la familia
    const updatedFamily = await this.findOne(familyId);

    for (const member of updatedFamily.members) {
      await this.notificationsService.create({
        recipientId: member.id,
        type: NotificationType.FAMILY_UPDATE,
        title: 'Miembro Removido de la Familia',
        message: `${userName} ha sido removido de tu familia`,
        priority: NotificationPriority.NORMAL,
        data: {
          familyId: family.id,
          familyName: family.name,
          removedMemberId: userId,
          removedMemberName: userName,
        },
      });
    }

    return updatedFamily;
  }

  // Agregar múltiples miembros a la familia
  async addMembers(familyId: string, userIds: string[]): Promise<Family> {
    const family = await this.findOne(familyId);
    
    for (const userId of userIds) {
      await this.addMember(familyId, userId);
    }

    return await this.findOne(familyId);
  }

  // Obtener usuarios disponibles (sin familia asignada)
  async getAvailableUsers(): Promise<User[]> {
    return await this.userRepository
      .createQueryBuilder('user')
      .where('user.familyId IS NULL')
      .select(['user.id', 'user.name', 'user.email', 'user.rut'])
      .getMany();
  }

  /**
   * Busca una familia por identificador de unidad (ej: "A-303", "Casa-5")
   * Maneja formatos flexibles usando el servicio de Units
   */
  async findByDepartment(searchTerm: string): Promise<Family | null> {
    // Normalizar el término de búsqueda
    const normalizedSearch = searchTerm.trim();

    // Buscar la unidad por identificador
    const unit = await this.unitsService.findByIdentifier(normalizedSearch);
    
    if (unit) {
      // Buscar la familia activa en esta unidad
      const activeFamily = unit.families?.find(f => f.active);
      if (activeFamily) {
        return this.findOne(activeFamily.id);
      }
    }

    // Si no se encuentra directamente, intentar búsqueda flexible
    const units = await this.unitsService.search(normalizedSearch);
    
    // Retornar la primera unidad con familia activa asignada
    for (const u of units) {
      const activeFamily = u.families?.find(f => f.active);
      if (activeFamily) {
        return this.findOne(activeFamily.id);
      }
    }

    return null;
  }
}