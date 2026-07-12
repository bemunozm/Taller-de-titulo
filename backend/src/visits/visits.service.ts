import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { Visit, VisitType, VisitStatus } from './entities/visit.entity';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { FamiliesService } from '../families/families.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { scopeWhere, applyTenantFilter, stampOrganizationId } from '../common/tenant/tenant-context.util';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import * as crypto from 'crypto';

/**
 * Opciones internas para los métodos de VisitsService que son compartidos
 * entre el flujo autenticado (VisitsController, humano con sesión) y flujos
 * SIN sesión de usuario:
 *  - Worker LPR (DetectionsService, protegido con ServiceApiKeyGuard — NO
 *    puebla `request.user`, ver service-api-key.guard.ts).
 *  - Conserje Digital (DigitalConciergeController — sin NINGÚN guard, el
 *    visitante habla con la IA de forma anónima desde el citofono).
 *
 * Para ambos, `TenantContextService.getContext()` resuelve
 * `{organizationId: null, isSuperAdmin: false}` (no hay forma de saber el
 * tenant desde `request.user`, que no existe). Aplicar el scoping por tenant
 * ahí de todas formas rompería esos flujos (ningún Visit real calzaría con
 * `organizationId IS NULL` tras el backfill). `skipTenantScope` es la válvula
 * de escape EXPLÍCITA para esos call-sites puntuales (ver DetectionsService y
 * DigitalConciergeService) — mismo criterio que
 * `CamerasService.resolveCameraByIdOrMount`/`getCameraByIdOrMount`, dejados
 * deliberadamente sin scoping por la misma razón (ver su docstring).
 */
interface TenantScopeOptions {
  skipTenantScope?: boolean;
}

@Injectable()
export class VisitsService {
  constructor(
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    private readonly usersService: UsersService,
    private readonly familiesService: FamiliesService,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
    // Tarea de aislamiento tenant (branch fix/visits-tenant-isolation, ver
    // docs/modulos/auth-multitenant.md §7): scoping por tenant en
    // create/findAll/findPending/findOne/findByQRCode/findByPlate/
    // validateAccess/update/checkIn/checkOut (ver métodos abajo e
    // interfaz TenantScopeOptions sobre los bypass puntuales).
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Búsqueda interna SIN scoping por tenant — únicamente para los call-sites
   * resource-derived (worker LPR / Conserje Digital, ver TenantScopeOptions)
   * que ya operan sobre un `id` de Visit resuelto por otra vía (plate/QR/
   * sesión propia), no por enumeración. NO exponer directamente al
   * controller.
   */
  private async loadVisitEntity(id: string, options?: TenantScopeOptions): Promise<Visit> {
    const where = options?.skipTenantScope
      ? { id }
      : scopeWhere({ id }, await this.tenantContext.getContext());

    const visit = await this.visitRepository.findOne({
      where,
      relations: ['host', 'family', 'vehicle'],
    });

    if (!visit) {
      throw new NotFoundException(`Visita con ID ${id} no encontrada`);
    }

    return visit;
  }

  /**
   * Fix de seguridad (follow-up post-auditoría Fase 0/1, ver
   * docs/modulos/auth-multitenant.md): `UsersService.findOne` que resuelve el
   * host NO está scopeado por tenant (a propósito — lo usan flujos internos
   * de todo tipo). Sin esta validación, un admin del condominio A podía pasar
   * un `hostId` de un usuario del condominio B y `create`/`update` terminaban
   * atribuyendo el recurso a B (la familia del host manda sobre el
   * organizationId, ver docstring de `create`).
   *
   * Mismo criterio que el "Fix M1" de
   * `DigitalConciergeService` (comparar `host.family?.organizationId` contra
   * el tenant del creador) — pero acá SOLO se aplica cuando hay un creador
   * humano autenticado con organización concreta
   * (`!ctx.isSuperAdmin && ctx.organizationId !== null`). Los flujos SIN
   * sesión de usuario (Conserje Digital citofono, worker LPR) resuelven
   * `TenantContextService.getContext()` como `EMPTY_TENANT_CONTEXT`
   * (`organizationId: null`) — para ellos no hay "creador" que validar, el
   * tenant se deriva enteramente del recurso (familia del host), así que la
   * validación se salta sin romper esos call-sites.
   */
  private assertHostBelongsToCreatorTenant(host: User, ctx: TenantContext): void {
    if (ctx.isSuperAdmin || ctx.organizationId === null) {
      return;
    }

    const hostOrganizationId = host.family?.organizationId ?? null;
    if (hostOrganizationId !== ctx.organizationId) {
      throw new ForbiddenException(
        'El anfitrión seleccionado pertenece a otro condominio',
      );
    }
  }

  /**
   * Crear una nueva visita (vehicular o peatonal)
   */
  async create(createVisitDto: CreateVisitDto): Promise<Visit> {
    const { hostId, type, validFrom, validUntil } = createVisitDto;

    // Validar que la fecha de inicio sea anterior a la fecha de fin
    const from = new Date(validFrom);
    const until = new Date(validUntil);

    if (from >= until) {
      throw new BadRequestException('La fecha de inicio debe ser anterior a la fecha de fin');
    }

    // Validar que el anfitrión exista
    const host = await this.usersService.findOne(hostId);
    if (!host) {
      throw new NotFoundException(`Usuario anfitrión con ID ${hostId} no encontrado`);
    }

    // Fix cross-tenant (ver docstring de assertHostBelongsToCreatorTenant):
    // rechazar si el host resuelto no pertenece al condominio del creador.
    const creatorCtx = await this.tenantContext.getContext();
    this.assertHostBelongsToCreatorTenant(host, creatorCtx);

    // Asignar automáticamente la familia del anfitrión
    const family = host.family || null;

    // Crear la visita base
    const visit = this.visitRepository.create({
      type,
      status: createVisitDto.status || VisitStatus.PENDING, // Usar status del DTO o PENDING por defecto
      visitorName: createVisitDto.visitorName,
      visitorRut: createVisitDto.visitorRut || null,
      visitorPhone: createVisitDto.visitorPhone || null,
      reason: createVisitDto.reason || null,
      validFrom: from,
      validUntil: until,
      host,
      family,
      maxUses: createVisitDto.maxUses !== undefined ? createVisitDto.maxUses : null,
      usedCount: 0,
    });

    // Tarea de aislamiento tenant: el organizationId se deriva PRIORITARIAMENTE
    // de la familia del host (recurso ya resuelto arriba) y solo si no tiene
    // familia se cae al tenant del creador (ctx). Esto es deliberado: `create`
    // lo invocan tanto el flujo autenticado (conserje/admin crea la visita
    // desde su propio condominio — ver VisitsController) como el Conserje
    // Digital (visitante anónimo en el citofono, SIN sesión de usuario — ver
    // DigitalConciergeController, no tiene guards). Para este último,
    // `tenantContext.getContext()` no puede resolver nada (no hay
    // `request.user`), así que la familia del host (que si vive en un
    // condominio ya tiene su `organizationId`, scopeado desde Fase 0) es la
    // única fuente confiable en ambos casos.
    const ctx = creatorCtx;
    stampOrganizationId(visit, { ...ctx, organizationId: family?.organizationId ?? ctx.organizationId });

    // Generar código QR único para TODAS las visitas (peatonales y vehiculares)
    // Para vehiculares sirve como respaldo si el LPR falla
    visit.qrCode = this.generateQRCode();

    // Si es visita vehicular, crear o asociar vehículo
    if (type === VisitType.VEHICULAR) {
      if (!createVisitDto.vehiclePlate) {
        throw new BadRequestException('La patente del vehículo es requerida para visitas vehiculares');
      }

      // Buscar si el vehículo ya existe
      let vehicle = await this.vehiclesService.findByPlate(createVisitDto.vehiclePlate);

      if (!vehicle) {
        // Crear nuevo vehículo temporal
        vehicle = await this.vehicleRepository.save(
          this.vehicleRepository.create({
            plate: createVisitDto.vehiclePlate,
            brand: createVisitDto.vehicleBrand || null,
            model: createVisitDto.vehicleModel || null,
            color: createVisitDto.vehicleColor || null,
            vehicleType: 'visitante',
            accessLevel: 'temporal',
            active: true,
            owner: null,
          })
        );
      }

      visit.vehicle = vehicle;
    }

    const savedVisit = await this.visitRepository.save(visit);

    // Notificar al host sobre la creación de la visita
    await this.notificationsService.create({
      recipientId: host.id,
      type: NotificationType.VISIT_APPROVED,
      title: 'Visita Creada',
      message: `Has creado una visita ${type === VisitType.VEHICULAR ? 'vehicular' : 'peatonal'} para ${createVisitDto.visitorName}. Válida desde ${from.toLocaleString('es-CL')} hasta ${until.toLocaleString('es-CL')}.`,
      data: {
        visitId: savedVisit.id,
        visitorName: savedVisit.visitorName,
        type: savedVisit.type,
        validFrom: savedVisit.validFrom,
        validUntil: savedVisit.validUntil,
      },
    });

    return savedVisit;
  }

  /**
   * Obtener todas las visitas con filtros opcionales
   */
  async findAll(filters?: {
    status?: VisitStatus;
    type?: VisitType;
    hostId?: string;
    familyId?: string;
  }, options?: TenantScopeOptions): Promise<Visit[]> {
    const query = this.visitRepository.createQueryBuilder('visit')
      .leftJoinAndSelect('visit.host', 'host')
      .leftJoinAndSelect('visit.family', 'family')
      .leftJoinAndSelect('visit.vehicle', 'vehicle')
      .orderBy('visit.createdAt', 'DESC');

    if (!options?.skipTenantScope) {
      const ctx = await this.tenantContext.getContext();
      applyTenantFilter(query, 'visit', ctx);
    }

    if (filters?.status) {
      query.andWhere('visit.status = :status', { status: filters.status });
    }

    if (filters?.type) {
      query.andWhere('visit.type = :type', { type: filters.type });
    }

    if (filters?.hostId) {
      query.andWhere('visit.hostId = :hostId', { hostId: filters.hostId });
    }

    if (filters?.familyId) {
      query.andWhere('visit.familyId = :familyId', { familyId: filters.familyId });
    }

    return await query.getMany();
  }

  /**
   * Obtener visitas activas (en curso)
   */
  async findActive(): Promise<Visit[]> {
    return await this.findAll({ status: VisitStatus.ACTIVE });
  }

  /**
   * Obtener visitas pendientes (programadas para hoy o futuro)
   */
  async findPending(): Promise<Visit[]> {
    const ctx = await this.tenantContext.getContext();
    return await this.visitRepository.find({
      where: scopeWhere({
        status: VisitStatus.PENDING,
        validFrom: MoreThan(new Date()),
      }, ctx),
      relations: ['host', 'family', 'vehicle'],
      order: { validFrom: 'ASC' },
    });
  }

  /**
   * Obtener una visita por ID
   */
  async findOne(id: string): Promise<Visit> {
    return this.loadVisitEntity(id);
  }

  /**
   * Buscar visita por código QR (para TODAS las visitas: peatonales y vehiculares)
   * Las visitas vehiculares también tienen QR como respaldo del LPR
   */
  async findByQRCode(qrCode: string): Promise<Visit> {
    const ctx = await this.tenantContext.getContext();
    const visit = await this.visitRepository.findOne({
      where: scopeWhere({ qrCode }, ctx),
      relations: ['host', 'family', 'vehicle'],
    });

    if (!visit) {
      throw new NotFoundException('Visita no encontrada con el código QR proporcionado');
    }

    return visit;
  }

  /**
   * Buscar visita por patente (para visitas vehiculares)
   */
  async findByPlate(plate: string, options?: TenantScopeOptions): Promise<Visit | null> {
    const query = this.visitRepository
      .createQueryBuilder('visit')
      .leftJoinAndSelect('visit.vehicle', 'vehicle')
      .leftJoinAndSelect('visit.host', 'host')
      .leftJoinAndSelect('visit.family', 'family')
      .where('vehicle.plate = :plate', { plate })
      .andWhere('visit.status IN (:...statuses)', {
        statuses: [VisitStatus.PENDING, VisitStatus.ACTIVE, VisitStatus.READY_FOR_REENTRY]
      })
      .andWhere('visit.validFrom <= :now', { now: new Date() })
      .andWhere('visit.validUntil >= :now', { now: new Date() });

    if (!options?.skipTenantScope) {
      const ctx = await this.tenantContext.getContext();
      applyTenantFilter(query, 'visit', ctx);
    }

    const visit = await query.getOne();

    return visit;
  }

  /**
   * Actualizar solo el estado de una visita
   * Método simplificado para cambios rápidos de estado
   *
   * Único caller: DigitalConciergeService (flujo del citofono, sin sesión de
   * usuario — ver TenantScopeOptions), por eso la carga es siempre
   * resource-derived (sin scoping por tenant).
   */
  async updateStatus(id: string, status: string): Promise<Visit> {
    const visit = await this.loadVisitEntity(id, { skipTenantScope: true });

    // Convertir string a enum de VisitStatus
    const validStatuses = ['pending', 'active', 'ready', 'completed', 'cancelled', 'expired', 'denied'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Estado inválido: ${status}`);
    }

    visit.status = status as VisitStatus;
    return await this.visitRepository.save(visit);
  }

  /**
   * Actualizar una visita
   */
  async update(id: string, updateVisitDto: UpdateVisitDto, options?: TenantScopeOptions): Promise<Visit> {
    const visit = await this.loadVisitEntity(id, options);

    // Actualizar campos básicos de la visita
    if (updateVisitDto.type !== undefined) {
      visit.type = updateVisitDto.type;
    }

    if (updateVisitDto.visitorName !== undefined) {
      visit.visitorName = updateVisitDto.visitorName;
    }

    if (updateVisitDto.visitorRut !== undefined) {
      visit.visitorRut = updateVisitDto.visitorRut || null;
    }

    if (updateVisitDto.visitorPhone !== undefined) {
      visit.visitorPhone = updateVisitDto.visitorPhone || null;
    }

    if (updateVisitDto.reason !== undefined) {
      visit.reason = updateVisitDto.reason || null;
    }

    // Actualizar fechas de validez
    if (updateVisitDto.validFrom !== undefined) {
      visit.validFrom = new Date(updateVisitDto.validFrom);
    }

    if (updateVisitDto.validUntil !== undefined) {
      visit.validUntil = new Date(updateVisitDto.validUntil);
    }

    // Actualizar anfitrión y familia automáticamente
    if (updateVisitDto.hostId !== undefined) {
      console.log(`[VISITS] 🔄 Actualizando host de visita ${id}`);
      console.log(`[VISITS] Host anterior: ${visit.host?.name} (${visit.host?.id})`);
      console.log(`[VISITS] Nuevo hostId: ${updateVisitDto.hostId}`);

      const host = await this.usersService.findOne(updateVisitDto.hostId);
      if (!host) {
        throw new NotFoundException(`Usuario anfitrión con ID ${updateVisitDto.hostId} no encontrado`);
      }

      // Fix cross-tenant (ver docstring de assertHostBelongsToCreatorTenant):
      // mismo criterio que en `create` — el único caller de `update` es
      // VisitsController (autenticado), así que `ctx` siempre refleja al
      // creador humano cuando corresponde validar.
      const updaterCtx = await this.tenantContext.getContext();
      this.assertHostBelongsToCreatorTenant(host, updaterCtx);

      visit.host = host;

      // Actualizar automáticamente la familia del nuevo anfitrión
      visit.family = host.family || null;

      console.log(`[VISITS] ✅ Nuevo host asignado: ${host.name} (${host.id})`);
      console.log(`[VISITS] Familia: ${visit.family?.name || 'Sin familia'}`);
    }

    // Actualizar máximo de usos
    if (updateVisitDto.maxUses !== undefined) {
      visit.maxUses = updateVisitDto.maxUses || null;
    }

    // Actualizar datos del vehículo (para visitas vehiculares)
    if (updateVisitDto.vehiclePlate !== undefined) {
      if (updateVisitDto.vehiclePlate) {
        // Si hay patente, buscar o crear vehículo
        let vehicle = await this.vehiclesService.findByPlate(updateVisitDto.vehiclePlate);

        if (!vehicle) {
          // Crear nuevo vehículo si no existe
          vehicle = await this.vehiclesService.create({
            plate: updateVisitDto.vehiclePlate,
            brand: updateVisitDto.vehicleBrand || undefined,
            model: updateVisitDto.vehicleModel || undefined,
            color: updateVisitDto.vehicleColor || undefined,
            ownerId: visit.host.id,
          });
        } else if (updateVisitDto.vehicleBrand || updateVisitDto.vehicleModel || updateVisitDto.vehicleColor) {
          // Actualizar datos del vehículo existente si se proporcionan
          await this.vehiclesService.update(vehicle.id, {
            brand: updateVisitDto.vehicleBrand || vehicle.brand || undefined,
            model: updateVisitDto.vehicleModel || vehicle.model || undefined,
            color: updateVisitDto.vehicleColor || vehicle.color || undefined,
          });
        }

        visit.vehicle = vehicle;
      } else {
        visit.vehicle = null;
      }
    }

    // Actualizar estado
    if (updateVisitDto.status) {
      visit.status = updateVisitDto.status;
    }

    // Actualizar tiempos de entrada/salida
    if (updateVisitDto.entryTime) {
      visit.entryTime = new Date(updateVisitDto.entryTime);
      // Si se registra entrada, cambiar estado a ACTIVE
      if (visit.status === VisitStatus.PENDING) {
        visit.status = VisitStatus.ACTIVE;
      }
    }

    if (updateVisitDto.exitTime) {
      visit.exitTime = new Date(updateVisitDto.exitTime);
      // Si se registra salida, cambiar estado a COMPLETED
      if (visit.status === VisitStatus.ACTIVE) {
        visit.status = VisitStatus.COMPLETED;
      }
    }

    const savedVisit = await this.visitRepository.save(visit);

    // Log de confirmación si se actualizó el host
    if (updateVisitDto.hostId !== undefined) {
      console.log(`[VISITS] 💾 Visita guardada con nuevo host: ${savedVisit.host.name} (${savedVisit.host.id})`);
    }

    return savedVisit;
  }

  /**
   * Registrar entrada de una visita
   */
  async checkIn(id: string, options?: TenantScopeOptions): Promise<Visit> {
    const visit = await this.loadVisitEntity(id, options);
    const now = new Date();

    // Validar que la visita esté en estado PENDING, READY_FOR_REENTRY o COMPLETED (para reusos)
    if (visit.status === VisitStatus.CANCELLED) {
      throw new BadRequestException('La visita está cancelada');
    }

    if (visit.status === VisitStatus.EXPIRED) {
      throw new BadRequestException('La visita ha expirado');
    }

    // Validar que esté dentro del período válido
    if (now < visit.validFrom || now > visit.validUntil) {
      throw new BadRequestException('La visita no está dentro del período válido');
    }

    // Validar contador de usos si está definido
    if (visit.maxUses !== null && visit.usedCount >= visit.maxUses) {
      throw new BadRequestException(
        `La visita ha alcanzado el máximo de usos permitidos (${visit.maxUses})`
      );
    }

    // Incrementar contador de usos
    visit.usedCount += 1;
    visit.entryTime = now;
    visit.exitTime = null; // Limpiar salida anterior si existía
    visit.status = VisitStatus.ACTIVE;

    const savedVisit = await this.visitRepository.save(visit);

    // Notificar al host sobre la llegada de la visita
    const usageInfo = visit.maxUses !== null
      ? ` (Uso ${visit.usedCount}/${visit.maxUses})`
      : '';

    await this.notificationsService.create({
      recipientId: visit.host.id,
      type: NotificationType.VISIT_CHECK_IN,
      title: 'Visita Arribó',
      message: `${savedVisit.visitorName} ha llegado${usageInfo}. ${savedVisit.type === 'vehicular' ? `Patente: ${savedVisit.vehicle?.plate || 'N/A'}` : 'Visita peatonal'}.`,
      data: {
        visitId: savedVisit.id,
        visitorName: savedVisit.visitorName,
        entryTime: savedVisit.entryTime,
        type: savedVisit.type,
        usedCount: savedVisit.usedCount,
        maxUses: savedVisit.maxUses,
        plate: savedVisit.vehicle?.plate,
      },
    });

    return savedVisit;
  }

  /**
   * Registrar salida de una visita
   */
  async checkOut(id: string, options?: TenantScopeOptions): Promise<Visit> {
    const visit = await this.loadVisitEntity(id, options);

    // Validar que la visita esté en estado ACTIVE
    if (visit.status !== VisitStatus.ACTIVE) {
      throw new BadRequestException('La visita no está activa');
    }

    visit.exitTime = new Date();

    // Si aún tiene usos disponibles, marcar como READY_FOR_REENTRY para permitir reingreso
    // Si ya no tiene usos, marcar como COMPLETED
    if (visit.maxUses === null || visit.usedCount < visit.maxUses) {
      visit.status = VisitStatus.READY_FOR_REENTRY;
    } else {
      visit.status = VisitStatus.COMPLETED;
    }

    const savedVisit = await this.visitRepository.save(visit);

    // Notificar al host sobre la salida de la visita
    const statusInfo = savedVisit.status === VisitStatus.COMPLETED
      ? 'Visita completada (sin usos disponibles).'
      : 'Podrá reingresar si está dentro del período válido.';

    await this.notificationsService.create({
      recipientId: visit.host.id,
      type: NotificationType.VISIT_CHECK_OUT,
      title: 'Visita Se Retiró',
      message: `${savedVisit.visitorName} se ha retirado. ${statusInfo}`,
      data: {
        visitId: savedVisit.id,
        visitorName: savedVisit.visitorName,
        entryTime: savedVisit.entryTime,
        exitTime: savedVisit.exitTime,
        usedCount: savedVisit.usedCount,
        maxUses: savedVisit.maxUses,
        status: savedVisit.status,
      },
    });

    return savedVisit;
  }

  /**
   * Cancelar una visita
   */
  async cancel(id: string): Promise<Visit> {
    const visit = await this.loadVisitEntity(id);

    if (visit.status === VisitStatus.COMPLETED) {
      throw new BadRequestException('No se puede cancelar una visita completada');
    }

    // Validar que no tenga usos registrados
    if (visit.usedCount && visit.usedCount > 0) {
      throw new BadRequestException('No se puede cancelar una visita que ya tiene usos registrados');
    }

    visit.status = VisitStatus.CANCELLED;

    return await this.visitRepository.save(visit);
  }

  /**
   * Eliminar una visita
   */
  async remove(id: string): Promise<void> {
    const visit = await this.loadVisitEntity(id);
    await this.visitRepository.remove(visit);
  }

  /**
   * Validar acceso de una visita (por QR o patente)
   */
  async validateAccess(identifier: string, type: 'qr' | 'plate', options?: TenantScopeOptions): Promise<{
    valid: boolean;
    visit?: Visit;
    message: string;
  }> {
    let visit: Visit | null = null;

    if (type === 'qr') {
      try {
        visit = await this.findByQRCode(identifier);
      } catch (error) {
        return { valid: false, message: 'Código QR no válido' };
      }
    } else if (type === 'plate') {
      visit = await this.findByPlate(identifier, options);
      if (!visit) {
        return { valid: false, message: 'Patente no autorizada' };
      }
    }

    if (!visit) {
      return { valid: false, message: 'Visita no encontrada' };
    }

    const now = new Date();

    // Verificar estado
    if (visit.status === VisitStatus.CANCELLED) {
      return { valid: false, visit, message: 'Visita cancelada' };
    }

    if (visit.status === VisitStatus.COMPLETED) {
      return { valid: false, visit, message: 'Visita completada (sin usos disponibles)' };
    }

    if (visit.status === VisitStatus.DENIED) {
      return { valid: false, visit, message: 'Visita rechazada' };
    }

    // Verificar período de validez ANTES de verificar si está marcada como expirada
    // Esto permite marcar como expirada una visita que aún no lo está
    if (now < visit.validFrom) {
      return {
        valid: false,
        visit,
        message: `Visita válida desde ${visit.validFrom.toLocaleString()}`
      };
    }

    if (now > visit.validUntil) {
      // Marcar como expirada si aún no lo está
      if (visit.status === VisitStatus.PENDING || visit.status === VisitStatus.ACTIVE || visit.status === VisitStatus.READY_FOR_REENTRY) {
        visit.status = VisitStatus.EXPIRED;
        await this.visitRepository.save(visit);

        // Notificar al host
        await this.notificationsService.create({
          recipientId: visit.host.id,
          type: NotificationType.VISIT_EXPIRED,
          title: 'Visita Expiró',
          message: `La visita de ${visit.visitorName} ha expirado. Período válido hasta ${visit.validUntil.toLocaleString('es-CL')}.`,
          data: {
            visitId: visit.id,
            visitorName: visit.visitorName,
            type: visit.type,
            validUntil: visit.validUntil,
            plate: visit.vehicle?.plate,
          },
        });
      }
      return { valid: false, visit, message: 'Visita expirada' };
    }

    // Ahora verificar si ya está marcada como expirada (por si acaso)
    if (visit.status === VisitStatus.EXPIRED) {
      return { valid: false, visit, message: 'Visita expirada' };
    }

    // READY_FOR_REENTRY es válido (puede reingresar)
    if (visit.status === VisitStatus.READY_FOR_REENTRY) {
      // Validar que aún tenga usos disponibles
      if (visit.maxUses !== null && visit.usedCount >= visit.maxUses) {
        return { valid: false, visit, message: 'Visita sin usos disponibles' };
      }
    }

    return {
      valid: true,
      visit,
      message: 'Acceso autorizado'
    };
  }

  /**
   * Generar código QR único
   */
  private generateQRCode(): string {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(16).toString('hex');
    return crypto.createHash('sha256').update(`${timestamp}-${random}`).digest('hex').substring(0, 32);
  }
}
