import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import { CreateAccessAttemptDto } from './dto/create-access-attempt.dto';
import { VehiclesService } from '../vehicles/vehicles.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class DetectionsService {
  constructor(
    @InjectRepository(PlateDetection)
    private readonly detectionsRepo: Repository<PlateDetection>,
    @InjectRepository(AccessAttempt)
    private readonly attemptsRepo: Repository<AccessAttempt>,
    private readonly vehiclesService: VehiclesService,
  ) {}

  async createDetection(dto: CreatePlateDetectionDto) {
    // Mapear DTO a la entidad PlateDetection. Usamos el campo `meta` como JSONB
    // para guardar bbox, snapshot y estadísticas de caracteres.
    const ent = this.detectionsRepo.create(dto);

    // `create()` solo instancia la entidad; `save()` persiste en la BD.
    const saved = await this.detectionsRepo.save(ent);

    // Validar contra vehículos registrados
    const vehicle = await this.vehiclesService.findByPlate(dto.plate);
    let decision: string;
    let reason: string;
    if (!vehicle) {
      decision = 'Denegado';
      reason = 'No se encontró vehículo registrado';
    } else if (!vehicle.active) {
      decision = 'Denegado';
      reason = 'Vehículo inactivo';
    } else {
      decision = 'Permitido';
      reason = 'Vehículo registrado y activo';
    }

    const att = this.attemptsRepo.create({ detection: saved, decision, reason, method: 'Patente' });

    // Si el vehículo tiene un owner (User), enlazarlo como residente
    if (vehicle && vehicle.owner) {
      att.residente = vehicle.owner;
    }

    const savedAtt = await this.attemptsRepo.save(att);

    return { detection: saved, attempt: savedAtt };
  }

  async listDetections(limit = 50) {
    return this.detectionsRepo.find({ relations: ['accessAttempts'], take: limit, order: { createdAt: 'DESC' } });
  }

  async createAttempt(dto: CreateAccessAttemptDto) {
    const det = await this.detectionsRepo.findOne({ where: { id: dto.detectionId } });
    if (!det) throw new NotFoundException('detection not found');
    const att = this.attemptsRepo.create({ detection: det, decision: dto.decision, reason: dto.reason ?? null, method: dto.method ?? null });
    if (dto.residenteId) {
      (att as any).residente = { id: dto.residenteId };
    }
    return this.attemptsRepo.save(att);
  }

  async listAttempts(limit = 50) {
    return this.attemptsRepo.find({ relations: ['detection'], take: limit, order: { createdAt: 'DESC' } });
  }
}
