import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { hashPassword } from '../auth/utils/auth.util';
import { CreateHubDto } from './dto/create-hub.dto';
import { UpdateHubDto } from './dto/update-hub.dto';
import { Hub } from './entities/hub.entity';

/** Vista pública de un `Hub` — nunca incluye `secretHash`. */
export type PublicHub = Omit<Hub, 'secretHash'>;

/** Respuesta de provisioning/rotación: el secret en CLARO, mostrado UNA VEZ. */
export interface HubWithPlaintextSecret {
  hub: PublicHub;
  secret: string;
}

/**
 * CRUD de provisioning de hubs físicos (Fase 1, Bloque A1.1 —
 * docs/modulos/agente-cerebro.md §7/§11, hallazgo H1 de la auditoría).
 * Reemplaza el `HUB_SECRET` global compartido: cada hub recibe su PROPIO
 * secret, generado acá y devuelto en claro UNA SOLA VEZ (mismo patrón que
 * `AuthService.createServiceApiKey` con el plugin `apiKey` de better-auth —
 * ver docstring de `HubAuthGuard` para por qué NO se reusó ese plugin
 * directamente: modelarían el hub como un `User` de better-auth, que exige
 * `rut`/`phone`/`email` únicos — campos sin sentido para un dispositivo físico
 * y que ensuciarían la tabla de usuarios humanos).
 *
 * Protegido en el controller con `@RequirePermissions('platform.manage-hubs')`
 * — exclusivo de plataforma (Super Administrador), igual que
 * `platform.manage-organizations` (OnboardingController).
 */
@Injectable()
export class HubsService {
  private readonly logger = new Logger(HubsService.name);

  constructor(
    @InjectRepository(Hub)
    private readonly hubRepository: Repository<Hub>,
  ) {}

  async provision(dto: CreateHubDto): Promise<HubWithPlaintextSecret> {
    const existing = await this.hubRepository.findOne({ where: { hubId: dto.hubId } });
    if (existing) {
      throw new ConflictException(`Ya existe un hub con hubId "${dto.hubId}"`);
    }

    const secret = this.generateSecret();
    const hub = this.hubRepository.create({
      hubId: dto.hubId,
      location: dto.location,
      description: dto.description ?? null,
      organizationId: dto.organizationId,
      secretHash: await hashPassword(secret),
      active: true,
    });

    const saved = await this.hubRepository.save(hub);
    this.logger.log(`✅ Hub provisionado: ${saved.hubId} (org=${saved.organizationId})`);

    return { hub: this.toPublicHub(saved), secret };
  }

  async findAll(): Promise<PublicHub[]> {
    const hubs = await this.hubRepository.find({ order: { createdAt: 'DESC' } });
    return hubs.map((hub) => this.toPublicHub(hub));
  }

  async findByHubId(hubId: string): Promise<PublicHub> {
    const hub = await this.findEntityByHubId(hubId);
    return this.toPublicHub(hub);
  }

  async update(hubId: string, dto: UpdateHubDto): Promise<PublicHub> {
    const hub = await this.findEntityByHubId(hubId);
    Object.assign(hub, dto);
    const saved = await this.hubRepository.save(hub);
    this.logger.log(`✅ Hub actualizado: ${saved.hubId}`);
    return this.toPublicHub(saved);
  }

  /** Genera un nuevo secret para un hub existente (p.ej. sospecha de compromiso). Invalida el anterior. */
  async rotateSecret(hubId: string): Promise<HubWithPlaintextSecret> {
    const hub = await this.findEntityByHubId(hubId);
    const secret = this.generateSecret();
    hub.secretHash = await hashPassword(secret);
    const saved = await this.hubRepository.save(hub);
    this.logger.log(`🔄 Secret rotado para hub: ${saved.hubId}`);
    return { hub: this.toPublicHub(saved), secret };
  }

  private async findEntityByHubId(hubId: string): Promise<Hub> {
    const hub = await this.hubRepository.findOne({ where: { hubId } });
    if (!hub) {
      throw new NotFoundException(`Hub con hubId "${hubId}" no encontrado`);
    }
    return hub;
  }

  private generateSecret(): string {
    return randomBytes(32).toString('hex');
  }

  private toPublicHub(hub: Hub): PublicHub {
    const { secretHash, ...publicHub } = hub;
    return publicHub;
  }
}
