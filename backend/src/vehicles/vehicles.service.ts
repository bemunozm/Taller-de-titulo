import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle) private readonly repo: Repository<Vehicle>,
    private readonly usersService: UsersService,
  ) {}

  async create(dto: CreateVehicleDto) {
    const ent = this.repo.create({
      plate: dto.plate,
      brand: dto.brand ?? null,
      model: dto.model ?? null,
      color: dto.color ?? null,
      year: dto.year ?? null,
      vehicleType: dto.vehicleType ?? null,
      accessLevel: dto.accessLevel ?? null,
      active: dto.active ?? null,
    });

    // assign owner relation if ownerId provided (validate exists)
    if (dto.ownerId) {
      const owner = await this.usersService.findOne(dto.ownerId);
      if (!owner) throw new NotFoundException(`Usuario con ID ${dto.ownerId} no encontrado`);
      ent.owner = owner;
    }

    return this.repo.save(ent);
  }

  async findByPlate(plate: string) {
    return this.repo.findOne({ where: { plate }, relations: ['owner'] });
  }

  async listAll(limit = 100) {
    return this.repo.find({ take: limit, order: { id: 'DESC' } });
  }
}
