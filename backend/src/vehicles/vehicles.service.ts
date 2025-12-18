import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, NotificationPriority } from '../notifications/entities/notification.entity';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    @InjectRepository(Vehicle) private readonly repo: Repository<Vehicle>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(dto: CreateVehicleDto) {
    this.logger.debug('=== CREATE VEHICLE ===');
    this.logger.debug('DTO recibido:', JSON.stringify(dto, null, 2));
    this.logger.debug('ownerId:', dto.ownerId);
    this.logger.debug('ownerId type:', typeof dto.ownerId);
    
    // Validate owner exists if ownerId provided
    if (dto.ownerId) {
      const owner = await this.usersService.findOneWithFamily(dto.ownerId);
      if (!owner) throw new NotFoundException(`Usuario con ID ${dto.ownerId} no encontrado`);
    }

    const ent = this.repo.create({
      plate: dto.plate,
      brand: dto.brand ?? null,
      model: dto.model ?? null,
      color: dto.color ?? null,
      year: dto.year ?? null,
      vehicleType: dto.vehicleType ?? null,
      accessLevel: dto.accessLevel ?? null,
      active: dto.active ?? null,
      ownerId: dto.ownerId ?? null,
    });

    const savedVehicle = await this.repo.save(ent);

    this.logger.log(`Vehículo ${savedVehicle.plate} registrado`);

    // Notificar al propietario y familia
    if (savedVehicle.owner) {
      const ownerWithFamily = await this.usersService.findOneWithFamily(savedVehicle.owner.id);
      await this.notifyVehicleAction(
        ownerWithFamily,
        savedVehicle,
        NotificationType.VEHICLE_REGISTERED,
        'Vehículo Registrado',
        'registrado'
      );
    }

    return savedVehicle;
  }

  async update(id: string, dto: Partial<CreateVehicleDto>) {
    this.logger.debug('=== UPDATE VEHICLE ===');
    this.logger.debug('DTO recibido:', JSON.stringify(dto, null, 2));
    this.logger.debug('ownerId:', dto.ownerId);
    this.logger.debug('ownerId type:', typeof dto.ownerId);
    
    const vehicle = await this.repo.findOne({
      where: { id },
      relations: ['owner'],
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehículo con ID ${id} no encontrado`);
    }

    // Update fields
    if (dto.plate !== undefined) vehicle.plate = dto.plate;
    if (dto.brand !== undefined) vehicle.brand = dto.brand ?? null;
    if (dto.model !== undefined) vehicle.model = dto.model ?? null;
    if (dto.color !== undefined) vehicle.color = dto.color ?? null;
    if (dto.year !== undefined) vehicle.year = dto.year ?? null;
    if (dto.vehicleType !== undefined) vehicle.vehicleType = dto.vehicleType ?? null;
    if (dto.accessLevel !== undefined) vehicle.accessLevel = dto.accessLevel ?? null;
    if (dto.active !== undefined) vehicle.active = dto.active ?? null;

    // Update owner relation if ownerId is provided
    if (dto.ownerId !== undefined) {
      if (dto.ownerId) {
        // Validate new owner exists
        const owner = await this.usersService.findOneWithFamily(dto.ownerId);
        if (!owner) throw new NotFoundException(`Usuario con ID ${dto.ownerId} no encontrado`);
        vehicle.ownerId = dto.ownerId;
      } else {
        // Remove owner (set to null)
        vehicle.ownerId = null;
      }
    }

    const savedVehicle = await this.repo.save(vehicle);

    this.logger.log(`Vehículo ${savedVehicle.plate} actualizado`);

    // Notificar si tiene propietario
    if (savedVehicle.owner) {
      const ownerWithFamily = await this.usersService.findOneWithFamily(savedVehicle.owner.id);
      await this.notifyVehicleAction(
        ownerWithFamily,
        savedVehicle,
        NotificationType.VEHICLE_UPDATED,
        'Vehículo Actualizado',
        'actualizado'
      );
    }

    return savedVehicle;
  }

  async remove(id: string) {
    const vehicle = await this.repo.findOne({
      where: { id },
      relations: ['owner'],
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehículo con ID ${id} no encontrado`);
    }

    const vehicleData = {
      id: vehicle.id,
      plate: vehicle.plate,
      brand: vehicle.brand,
      model: vehicle.model,
    };

    const owner = vehicle.owner;

    try {
      await this.repo.remove(vehicle);
    } catch (error) {
      // Manejar error de restricción de clave foránea
      if (error.code === '23503') {
        const vehicleDesc = vehicle.brand && vehicle.model
          ? `${vehicle.brand} ${vehicle.model} (${vehicle.plate})`
          : `con patente ${vehicle.plate}`;
        
        throw new BadRequestException(
          `No se puede eliminar el vehículo ${vehicleDesc} porque está asociado a una o más visitas. ` +
          `Primero debes eliminar o modificar las visitas que usan este vehículo.`
        );
      }
      throw error; // Re-lanzar otros errores
    }

    this.logger.log(`Vehículo ${vehicleData.plate} eliminado`);

    // Notificar si tenía propietario
    if (owner) {
      const ownerWithFamily = await this.usersService.findOneWithFamily(owner.id);
      await this.notifyVehicleAction(
        ownerWithFamily,
        vehicleData as any,
        NotificationType.VEHICLE_REMOVED,
        'Vehículo Eliminado',
        'eliminado'
      );
    }

    return { message: 'Vehículo eliminado exitosamente' };
  }

  /**
   * Notifica al propietario y su familia sobre una acción en un vehículo
   */
  private async notifyVehicleAction(
    owner: User,
    vehicle: Vehicle | any,
    type: NotificationType,
    title: string,
    action: string,
  ) {
    const vehicleDesc = vehicle.brand && vehicle.model
      ? `${vehicle.brand} ${vehicle.model} (${vehicle.plate})`
      : `patente ${vehicle.plate}`;

    // Notificar al propietario
    await this.notificationsService.create({
      recipientId: owner.id,
      type,
      title,
      message: `Tu vehículo ${vehicleDesc} ha sido ${action} exitosamente`,
      priority: NotificationPriority.NORMAL,
      data: {
        vehicleId: vehicle.id,
        plate: vehicle.plate,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        year: vehicle.year,
      },
    });

    // Notificar a la familia si existe
    if (owner.family?.members) {
      const familyMembers = owner.family.members.filter(m => m.id !== owner.id);

      for (const member of familyMembers) {
        await this.notificationsService.create({
          recipientId: member.id,
          type,
          title: `Vehículo ${action.charAt(0).toUpperCase() + action.slice(1)} en la Familia`,
          message: `${owner.name} ha ${action} el vehículo ${vehicleDesc}`,
          priority: NotificationPriority.NORMAL,
          data: {
            vehicleId: vehicle.id,
            plate: vehicle.plate,
            brand: vehicle.brand,
            model: vehicle.model,
            ownerId: owner.id,
            ownerName: owner.name,
            familyId: owner.family.id,
          },
        });
      }
    }
  }

  async findByPlate(plate: string) {
    return this.repo.findOne({ where: { plate }, relations: ['owner'] });
  }

  async findByFamily(familyId: string) {
    this.logger.log(`🔍 Buscando vehículos de la familia: ${familyId}`);
    
    // Obtener usuarios de la familia
    const familyUsers = await this.usersService.findByFamily(familyId);
    const userIds = familyUsers.map(u => u.id);
    
    if (userIds.length === 0) {
      return [];
    }
    
    // Buscar vehículos de todos los miembros de la familia
    const vehicles = await this.repo
      .createQueryBuilder('vehicle')
      .leftJoinAndSelect('vehicle.owner', 'owner')
      .where('vehicle.ownerId IN (:...userIds)', { userIds })
      .orderBy('vehicle.createdAt', 'DESC')
      .getMany();
      
    this.logger.log(`📊 Encontrados ${vehicles.length} vehículos de la familia ${familyId}`);
    return vehicles;
  }

  async listAll(filters?: { familyId?: string; ownerId?: string }, limit = 100) {
    const query = this.repo.createQueryBuilder('vehicle')
      .leftJoinAndSelect('vehicle.owner', 'owner')
      .orderBy('vehicle.createdAt', 'DESC')
      .take(limit);

    // Si hay filtro por familyId, obtener vehículos de todos los miembros
    if (filters?.familyId) {
      const familyUsers = await this.usersService.findByFamily(filters.familyId);
      const userIds = familyUsers.map(u => u.id);
      
      if (userIds.length === 0) {
        return [];
      }
      
      query.where('vehicle.ownerId IN (:...userIds)', { userIds });
    }
    
    // Si hay filtro por ownerId
    if (filters?.ownerId) {
      query.andWhere('vehicle.ownerId = :ownerId', { ownerId: filters.ownerId });
    }

    return query.getMany();
  }

  /**
   * Busca vehículos por múltiples IDs de propietarios
   * Útil para obtener todos los vehículos de una familia
   */
  async findByOwnerIds(ownerIds: string[]) {
    if (!ownerIds || ownerIds.length === 0) {
      return [];
    }
    
    return this.repo
      .createQueryBuilder('vehicle')
      .leftJoinAndSelect('vehicle.owner', 'owner')
      .where('vehicle.ownerId IN (:...ownerIds)', { ownerIds })
      .getMany();
  }
}
