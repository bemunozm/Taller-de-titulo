import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { hashPassword } from '../auth/utils/auth.util';
import { CreateHubDto } from './dto/create-hub.dto';
import { UpdateHubDto } from './dto/update-hub.dto';
import { Hub, HubType } from './entities/hub.entity';
import { HubGateway } from './hub.gateway';

/** Vista pública de un `Hub` — nunca incluye `secretHash`. */
export type PublicHub = Omit<Hub, 'secretHash'>;

/** Datos de la identidad de un hub que, si cambian, invalidan su socket. */
type HubIdentitySnapshot = Pick<Hub, 'type' | 'organizationId'>;

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
export class HubsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HubsService.name);

  /**
   * `HubGateway` no depende de `HubsService` (solo del repositorio de `Hub`),
   * así que inyectarlo acá no crea un ciclo de providers.
   */
  constructor(
    @InjectRepository(Hub)
    private readonly hubRepository: Repository<Hub>,
    private readonly hubGateway: HubGateway,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.warnAboutHubsWithoutOrganization();
  }

  /**
   * Aviso al arrancar (corrección P5, QA A3; mismo criterio que el de
   * membresías): desde la P5.C un hub ACTIVO sin condominio no ve ninguna
   * unidad ni residente y no puede crear nada, así que el citófono no
   * funciona hasta asociarlo (`PATCH /hubs/:hubId` con `organizationId`).
   * Nunca bloquea el arranque. Devuelve el conteo (`null` si falló).
   */
  async warnAboutHubsWithoutOrganization(): Promise<number | null> {
    try {
      const count = await this.hubRepository.count({
        where: { active: true, organizationId: IsNull() },
      });
      if (count > 0) {
        this.logger.warn(
          `${count} hub(s) activo(s) sin condominio: no ven unidades ni residentes y el citófono no funciona. ` +
            'Asócialos con PATCH /api/v1/hubs/:hubId { organizationId } (ver hub/README.md).',
        );
      }
      return count;
    } catch (error) {
      this.logger.error(
        'No se pudo contar los hubs sin condominio',
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  async provision(dto: CreateHubDto): Promise<HubWithPlaintextSecret> {
    const existing = await this.hubRepository.findOne({
      where: { hubId: dto.hubId },
    });
    if (existing) {
      throw new ConflictException(`Ya existe un hub con hubId "${dto.hubId}"`);
    }

    const secret = this.generateSecret();
    const hub = this.hubRepository.create({
      hubId: dto.hubId,
      location: dto.location,
      description: dto.description ?? null,
      organizationId: dto.organizationId,
      // Retrocompat: sin `type` explícito, se asume `physical-hub` (todo hub
      // provisionado antes de esta tarea era una Raspberry Pi física).
      type: dto.type ?? HubType.PHYSICAL_HUB,
      secretHash: await hashPassword(secret),
      active: true,
    });

    const saved = await this.hubRepository.save(hub);
    this.logger.log(
      `✅ Hub provisionado: ${saved.hubId} (org=${saved.organizationId})`,
    );

    return { hub: this.toPublicHub(saved), secret };
  }

  async findAll(): Promise<PublicHub[]> {
    const hubs = await this.hubRepository.find({
      order: { createdAt: 'DESC' },
    });
    return hubs.map((hub) => this.toPublicHub(hub));
  }

  async findByHubId(hubId: string): Promise<PublicHub> {
    const hub = await this.findEntityByHubId(hubId);
    return this.toPublicHub(hub);
  }

  /**
   * Fase 4 · P4: si el hub queda inactivo, o cambia su tipo o su condominio,
   * se corta su socket conectado: su identidad en `HubGateway` (la del
   * handshake) quedó desactualizada y podría seguir recibiendo eventos (p. ej.
   * un hub que pasa a `web-kiosk` seguiría recibiendo `hub:door_open`). Al
   * reconectarse se autentica con los datos nuevos.
   */
  async update(hubId: string, dto: UpdateHubDto): Promise<PublicHub> {
    const hub = await this.findEntityByHubId(hubId);
    const before: HubIdentitySnapshot = {
      type: hub.type,
      organizationId: hub.organizationId,
    };
    Object.assign(hub, dto);
    const saved = await this.hubRepository.save(hub);
    this.logger.log(`✅ Hub actualizado: ${saved.hubId}`);

    const reason = this.disconnectReason(before, saved);
    if (reason) {
      this.hubGateway.disconnectHub(saved.hubId, reason);
    }

    return this.toPublicHub(saved);
  }

  /**
   * Genera un nuevo secret para un hub existente (p.ej. sospecha de
   * compromiso). Invalida el anterior y corta el socket conectado con él
   * (Fase 4 · P4).
   */
  async rotateSecret(hubId: string): Promise<HubWithPlaintextSecret> {
    const hub = await this.findEntityByHubId(hubId);
    const secret = this.generateSecret();
    hub.secretHash = await hashPassword(secret);
    const saved = await this.hubRepository.save(hub);
    this.logger.log(`🔄 Secret rotado para hub: ${saved.hubId}`);
    this.hubGateway.disconnectHub(saved.hubId, 'secret rotado');
    return { hub: this.toPublicHub(saved), secret };
  }

  /** Motivo para cortar el socket tras un `update`, o `null` si sigue vigente. */
  private disconnectReason(
    before: HubIdentitySnapshot,
    after: Hub,
  ): string | null {
    if (!after.active) {
      return 'hub desactivado';
    }
    if (after.type !== before.type) {
      return `tipo cambiado (${before.type} -> ${after.type})`;
    }
    if (after.organizationId !== before.organizationId) {
      return 'condominio cambiado';
    }
    return null;
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
