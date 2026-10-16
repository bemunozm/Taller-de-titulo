import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  MoreThan,
  FindOptionsWhere,
  type QueryDeepPartialEntity,
  type SelectQueryBuilder,
} from 'typeorm';
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
import { VehicleAccessLevel } from '../vehicles/vehicle-access';
import { isUniqueViolation } from '../common/utils/unique-violation.util';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import {
  scopeWhere,
  applyTenantFilter,
  requireOrganizationId,
  tenantWhereCondition,
} from '../common/tenant/tenant-context.util';
import type { TenantScope } from '../common/tenant/tenant-context.types';
import {
  familyScopeOf,
  isSelfOrFamilyMember,
  type FamilyScope,
  type TenantActor,
} from '../common/tenant/tenant-actor';
import { optionalEmbeddedUserFor } from '../users/user-summary';
import {
  CHECKIN_FROM,
  EDITABLE_FROM,
  LPR_MATCHABLE,
  QR_VALID,
  assertTransition,
  canTransition,
  describeVisitStatus,
} from './visit-state-machine';
import { VisitEntryAlreadyRegisteredException } from './visit-entry-already-registered.exception';
import { VisitExitAlreadyRegisteredException } from './visit-exit-already-registered.exception';
import { errorMessage } from '../common/utils/error-message.util';
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
 *
 * FIX aislamiento cross-tenant en apertura autónoma del portón (rama
 * feature/cierre-fases-1-2, hallazgo reportado sobre `skipTenantScope`):
 * `skipTenantScope` es un bypass TOTAL — sirve para el Conserje Digital, que
 * NO tiene ningún tenant confiable que ofrecer (visitante anónimo en el
 * citófono). El worker LPR SÍ tiene un tenant confiable — el `organizationId`
 * de la CÁMARA que detectó la patente (resource-derived, ver
 * `DetectionsService.resolveCameraOrganizationId`) — así que en vez de saltar
 * el scoping por completo, `organizationId` acota la búsqueda a ESE
 * condominio específico. `DetectionsService.createDetection` pasa este campo
 * en vez de `skipTenantScope` para las búsquedas de vehículo/visita del
 * camino de apertura física; `skipTenantScope` queda reservado para los
 * call-sites que de verdad no pueden determinar ningún tenant.
 */
export interface TenantScopeOptions {
  skipTenantScope?: boolean;
  /**
   * Scope explícito por organizationId — tiene prioridad sobre
   * `skipTenantScope` si ambos vinieran seteados (no debería pasar en la
   * práctica). Reutiliza `applyTenantFilter`/`scopeWhere` construyendo un
   * `TenantContext` sintético `{ organizationId, isSuperAdmin: false }`.
   */
  organizationId?: string;
}

/** Estados con los que se puede crear una visita (Fase 4 · P3). */
export type VisitInitialStatus =
  | VisitStatus.PENDING
  | VisitStatus.AWAITING_APPROVAL;

/**
 * Opciones INTERNAS de `create` (no llegan desde HTTP: `CreateVisitDto` ya no
 * tiene `status`). `AWAITING_APPROVAL` solo lo usa el conserje digital
 * (`DigitalConciergeService.notifyResident`): la visita queda como solicitud,
 * sin `Vehicle` y sin notificación de "visita aprobada".
 */
export interface CreateVisitOptions {
  initialStatus?: VisitInitialStatus;
  /**
   * Condominio EXPLÍCITO de la visita, para los flujos internos sin usuario
   * autenticado: el conserje digital pasa el de la sesión del citófono (que
   * viene del hub o de la sesión humana). El anfitrión debe pertenecer a ESE
   * condominio (403 si no) y la visita queda estampada con él. Sin este campo
   * (camino HTTP) el condominio es el del usuario autenticado (ver
   * `resolveWriteScope`).
   */
  organizationId?: string;
  /**
   * Fase 4 · P5.C: alcance por familia del actor HTTP (`familyScopeOf`). Con
   * él, el anfitrión debe ser el actor o un miembro de su familia (403 si no).
   */
  familyScope?: FamilyScope | null;
}

/**
 * Condominio al que queda acotada una escritura de visita (crear o editar).
 * `platform` es el super-admin: sin restricción sobre el anfitrión.
 */
type VisitWriteScope =
  | { kind: 'organization'; organizationId: string }
  | { kind: 'platform' };

/**
 * Opciones de la respuesta a una solicitud (`approve`/`deny`). Todo se
 * escribe en el MISMO `UPDATE` condicionado que resuelve la solicitud, así una
 * respuesta que pierde el claim no escribe nada:
 *  - `respondedById`: el usuario (sesión humana) que respondió — Fase 4 · P4
 *    (D5). Se guarda junto con `respondedAt`.
 *  - `hostId`: el residente que respondió, solo si estaba entre los
 *    notificados (lo verifica el caller); queda como anfitrión.
 */
export interface ResolveRequestOptions {
  respondedById: string;
  hostId?: string;
}

/** Payload de `NotificationsService.create`. */
type HostNotification = Parameters<NotificationsService['create']>[0];

/** Datos del vehículo temporal de un visitante. */
interface VisitorVehicleData {
  plate: string;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
}

/** Resultado de `validateAccess` (QR o patente). */
export interface VisitAccessValidation {
  valid: boolean;
  visit?: Visit;
  message: string;
}

/** Mensaje de `validateAccess` para una visita cuyo estado no admite acceso. */
const INVALID_STATUS_MESSAGES: Partial<Record<VisitStatus, string>> = {
  [VisitStatus.AWAITING_APPROVAL]:
    'Visita pendiente de aprobación del residente',
  [VisitStatus.CANCELLED]: 'Visita cancelada',
  [VisitStatus.COMPLETED]: 'Visita completada (sin usos disponibles)',
  [VisitStatus.DENIED]: 'Visita rechazada',
  [VisitStatus.EXPIRED]: 'Visita expirada',
};

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

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
  private async loadVisitEntity(
    id: string,
    options?: TenantScopeOptions,
  ): Promise<Visit> {
    return this.findVisitOrFail(id, await this.visitWhere(id, options));
  }

  private async findVisitOrFail(
    id: string,
    where: FindOptionsWhere<Visit>,
  ): Promise<Visit> {
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
   * `where` por id con el scope de tenant que corresponde al caller (ver
   * `TenantScopeOptions`). Es el mismo `where` con el que se cargó la visita,
   * así las escrituras condicionadas (`update`) quedan acotadas igual.
   */
  private async visitWhere(
    id: string,
    options?: TenantScopeOptions,
  ): Promise<FindOptionsWhere<Visit>> {
    if (options?.organizationId) {
      // Defense-in-depth: aunque el `id` ya fue resuelto por un
      // findByPlate/findByQRCode previamente scopeado, se re-verifica el
      // organizationId al cargar por id (p.ej. checkIn/checkOut del camino
      // LPR, ver DetectionsService).
      return { id, organizationId: options.organizationId };
    }
    if (options?.skipTenantScope) {
      return { id };
    }
    return scopeWhere<FindOptionsWhere<Visit>>(
      { id },
      await this.tenantContext.getContext(),
    ) as FindOptionsWhere<Visit>;
  }

  /**
   * `where` por id acotado a un `TenantScope` (vocabulario del agente /
   * conserje digital), con la misma semántica que `scopeWhere`: super-admin
   * sin filtro; resto, `organizationId` exacto. Fase 4 · P5.C: un scope SIN
   * condominio no alcanza ninguna visita (antes, el "cajón nulo").
   */
  private whereForScope(
    id: string,
    tenantScope: TenantScope,
  ): FindOptionsWhere<Visit> {
    return scopeWhere<FindOptionsWhere<Visit>>(
      { id },
      {
        organizationId: tenantScope.tenantId,
        isSuperAdmin: tenantScope.isSuperAdmin,
      },
    ) as FindOptionsWhere<Visit>;
  }

  /**
   * Claim atómico de una transición (Fase 4 · P3, D2): `UPDATE ... WHERE id
   * AND status = :from` (y tenant). Si dos requests compiten, solo una afecta
   * la fila; la otra recibe 409 con el estado real. Mismo patrón que
   * `PendingActionsService.approve`. `extra` son columnas que se escriben en
   * el mismo `UPDATE` (p. ej. el QR o el anfitrión que respondió).
   */
  private async claimTransition(
    repository: Repository<Visit>,
    visitId: string,
    from: VisitStatus,
    to: VisitStatus,
    tenantScope: TenantScope,
    action: string,
    extra: QueryDeepPartialEntity<Visit> = {},
  ): Promise<void> {
    assertTransition(from, to);

    const where = this.whereForScope(visitId, tenantScope);
    const result = await repository.update(
      { ...where, status: from },
      { ...extra, status: to },
    );
    if (result.affected) {
      return;
    }

    const current = await repository.findOne({ where });
    if (!current) {
      throw new NotFoundException(`Visita con ID ${visitId} no encontrada`);
    }
    throw new ConflictException(
      `No se puede ${action} la visita: está ${describeVisitStatus(current.status)}`,
    );
  }

  /**
   * Busca el vehículo por patente o crea uno temporal de visitante. Es la
   * lógica que antes vivía inline en `create`, compartida con `approve`
   * (que la ejecuta dentro de su transacción).
   *
   * Fase 4 · P5.B: la búsqueda y el vehículo nuevo son del condominio de la
   * VISITA (`organizationId`). Antes buscaba la patente en toda la
   * plataforma (podía asociar el vehículo de otro condominio) y creaba el
   * vehículo SIN `organizationId`, así que el LPR del condominio (que busca
   * por el condominio de la cámara) nunca lo encontraba como vehículo
   * registrado. Si otra request crea la misma patente entre la búsqueda y el
   * INSERT (índice UNIQUE `(organizationId, plate)`), se reutiliza esa; dentro
   * de la transacción de `approve` esa carrera aborta la transacción y la
   * aprobación falla sin efectos (la visita sigue esperando respuesta).
   */
  private async findOrCreateVisitorVehicle(
    vehicles: Repository<Vehicle>,
    organizationId: string | null,
    data: VisitorVehicleData,
  ): Promise<Vehicle> {
    const where: FindOptionsWhere<Vehicle> = {
      plate: data.plate,
      ...tenantWhereCondition(organizationId),
    };
    const existing = await vehicles.findOne({ where, relations: ['owner'] });
    if (existing) {
      return existing;
    }

    try {
      return await vehicles.save(
        vehicles.create({
          organizationId,
          plate: data.plate,
          brand: data.brand || null,
          model: data.model || null,
          color: data.color || null,
          // Fase 4 · P5.C: el nivel de acceso es lo que decide el portón; la
          // carrocería de un auto de visita no se conoce.
          vehicleType: null,
          accessLevel: VehicleAccessLevel.VISITOR,
          active: true,
          owner: null,
        }),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const created = await vehicles.findOne({ where, relations: ['owner'] });
      if (!created) {
        throw error;
      }
      return created;
    }
  }

  /**
   * Condominio de una escritura de visita (crear o editar).
   *
   * Fase 4 · P3 (seguridad ALTO, bypass por contexto nulo): antes un contexto
   * sin condominio SALTABA la validación del anfitrión y la visita se
   * estampaba con el condominio de la familia del anfitrión. Así un usuario
   * sin condominio (o uno cuya membresía no se pudo leer por un error de BD:
   * `resolveOrganizationIdForUser` devuelve `null`) creaba por `POST /visits`
   * una visita, incluso vehicular, para un anfitrión de otro condominio, y el
   * LPR de ese condominio la abría. Ahora:
   *  - `explicitOrganizationId` (flujo interno, p. ej. el conserje digital):
   *    ese condominio.
   *  - Super-admin: sin restricción (`platform`).
   *  - Resto (camino HTTP): el condominio del usuario autenticado, exigido con
   *    `requireOrganizationId` (403 si no tiene). Nunca se deriva de un
   *    contexto nulo.
   */
  private async resolveWriteScope(
    explicitOrganizationId?: string,
  ): Promise<VisitWriteScope> {
    if (explicitOrganizationId) {
      return { kind: 'organization', organizationId: explicitOrganizationId };
    }
    const ctx = await this.tenantContext.getContext();
    if (ctx.isSuperAdmin) {
      return { kind: 'platform' };
    }
    return { kind: 'organization', organizationId: requireOrganizationId(ctx) };
  }

  /**
   * `UsersService.findOne`, que resuelve el anfitrión, NO está acotado por
   * condominio (lo usan flujos internos de todo tipo). Sin esta validación un
   * usuario del condominio A podía pasar el `hostId` de un usuario de B y la
   * visita quedaba atribuida a B. Mismo criterio que el "Fix M1" de
   * `DigitalConciergeService.notifyResident`.
   *
   * Fase 4 · P5.C: un anfitrión SIN familia (p. ej. un residente que todavía
   * no tiene una asignada y crea su propia visita) se valida por su
   * membresía activa en el condominio (D11). Con familia, la familia debe ser
   * del condominio, como antes.
   */
  private async assertHostInScope(
    host: User,
    scope: VisitWriteScope,
  ): Promise<void> {
    if (scope.kind === 'platform') {
      return;
    }
    const inScope = host.family
      ? host.family.organizationId === scope.organizationId
      : await this.usersService.isActiveMemberOfOrganization(
          host.id,
          scope.organizationId,
        );
    if (!inScope) {
      throw new ForbiddenException(
        'El anfitrión seleccionado pertenece a otro condominio',
      );
    }
  }

  /**
   * Fase 4 · P5.C: un actor acotado a su familia (sin
   * `condominium.view-all`) solo crea o reasigna visitas cuyo anfitrión es él
   * mismo o un miembro de su familia (403 si no). Sin familia, solo él.
   */
  private assertHostInFamilyScope(
    host: User,
    familyScope: FamilyScope | null | undefined,
  ): void {
    if (!familyScope) {
      return;
    }
    if (
      !isSelfOrFamilyMember(familyScope, {
        id: host.id,
        familyId: host.family?.id ?? null,
      })
    ) {
      throw new ForbiddenException(
        'Solo puedes registrar visitas para ti o para un miembro de tu familia',
      );
    }
  }

  /**
   * Residual de P3 (Fase 4 · P4): cuando el super-admin cambia el anfitrión
   * por `PATCH`, el anfitrión nuevo debe ser del condominio de la visita. El
   * patch mueve `host` y `family` pero no `organizationId`: sin esta
   * validación la visita quedaba estampada en un condominio y atribuida a una
   * familia de otro. Fail-closed: una visita sin condominio no admite cambio
   * de anfitrión.
   */
  private assertHostInVisitOrganization(host: User, visit: Visit): void {
    const hostOrganizationId = host.family?.organizationId ?? null;
    if (
      visit.organizationId === null ||
      hostOrganizationId !== visit.organizationId
    ) {
      throw new ForbiddenException(
        'El anfitrión seleccionado pertenece a otro condominio que la visita',
      );
    }
  }

  /**
   * Condominio con el que se estampa una visita nueva: el de la escritura o,
   * para el super-admin (que no tiene condominio propio), el de la familia
   * del anfitrión.
   *
   * Fase 4 · P5.C (creación estricta): si el super-admin elige un anfitrión
   * sin familia de un condominio, 400. Antes la visita quedaba sin condominio:
   * ningún LPR la reconocía y solo la veían los humanos sin condominio.
   */
  private visitOrganizationId(host: User, scope: VisitWriteScope): string {
    if (scope.kind === 'organization') {
      return scope.organizationId;
    }
    const organizationId = host.family?.organizationId ?? null;
    if (!organizationId) {
      throw new BadRequestException(
        'El anfitrión no pertenece a una familia de un condominio: no se puede determinar el condominio de la visita',
      );
    }
    return organizationId;
  }

  /**
   * Id del anfitrión, o `null` si está deshabilitado: `UsersService.disable`
   * es un soft-delete y TypeORM excluye esa fila del join, así que
   * `visit.host` queda `null` aunque la columna sea NOT NULL.
   */
  private hostIdOf(visit: Visit): string | null {
    const host: User | null = visit.host ?? null;
    return host?.id ?? null;
  }

  /**
   * Crear una nueva visita (vehicular o peatonal).
   *
   * Fase 4 · P3: el estado inicial lo decide el servidor (`options`, nunca el
   * body). Con `AWAITING_APPROVAL` (solicitud del conserje digital) la visita
   * NO recibe `Vehicle` (solo guarda `requestedPlate`) ni dispara la
   * notificación VISIT_APPROVED: ambas cosas pasan en `approve`.
   *
   * El condominio sale de `options.organizationId` (flujo interno) o del
   * usuario autenticado (HTTP, 403 sin condominio salvo super-admin), y el
   * anfitrión debe pertenecer a él (ver `resolveWriteScope`).
   */
  async create(
    createVisitDto: CreateVisitDto,
    options?: CreateVisitOptions,
  ): Promise<Visit> {
    const { hostId, type, validFrom, validUntil } = createVisitDto;
    const initialStatus = options?.initialStatus ?? VisitStatus.PENDING;
    const awaitingApproval = initialStatus === VisitStatus.AWAITING_APPROVAL;

    // Validar que la fecha de inicio sea anterior a la fecha de fin
    const from = new Date(validFrom);
    const until = new Date(validUntil);

    if (from >= until) {
      throw new BadRequestException(
        'La fecha de inicio debe ser anterior a la fecha de fin',
      );
    }

    // Condominio de la escritura ANTES de tocar nada (403 sin condominio).
    const scope = await this.resolveWriteScope(options?.organizationId);

    // Validar que el anfitrión exista
    const host = await this.usersService.findOne(hostId);
    if (!host) {
      throw new NotFoundException(
        `Usuario anfitrión con ID ${hostId} no encontrado`,
      );
    }

    // Fix cross-tenant: el anfitrión debe ser del condominio de la escritura.
    await this.assertHostInScope(host, scope);
    // P5.C: y, para un actor acotado a su familia, él o alguien de su familia.
    this.assertHostInFamilyScope(host, options?.familyScope);

    // Asignar automáticamente la familia del anfitrión
    const family = host.family || null;

    // Crear la visita base
    const visit = this.visitRepository.create({
      type,
      status: initialStatus,
      visitorName: createVisitDto.visitorName,
      visitorRut: createVisitDto.visitorRut || null,
      visitorPhone: createVisitDto.visitorPhone || null,
      reason: createVisitDto.reason || null,
      validFrom: from,
      validUntil: until,
      host,
      family,
      maxUses:
        createVisitDto.maxUses !== undefined ? createVisitDto.maxUses : null,
      usedCount: 0,
    });

    // El condominio de la visita es el de la escritura (explícito o del
    // usuario autenticado), nunca uno derivado de un contexto nulo. El
    // anfitrión ya se validó contra él.
    visit.organizationId = this.visitOrganizationId(host, scope);

    // Código QR único para las visitas autorizadas (peatonales y vehiculares;
    // en las vehiculares es el respaldo si el LPR falla). Una solicitud
    // AWAITING_APPROVAL no tiene QR (seguridad B1): `approve` lo genera.
    visit.qrCode = awaitingApproval ? null : this.generateQRCode();

    // Si es visita vehicular, crear o asociar vehículo
    if (type === VisitType.VEHICULAR) {
      if (!createVisitDto.vehiclePlate) {
        throw new BadRequestException(
          'La patente del vehículo es requerida para visitas vehiculares',
        );
      }

      if (awaitingApproval) {
        // Solicitud sin aprobar: sin `Vehicle`, así el LPR no la reconoce
        // (la detección cae en la rama "vehículo no registrado" y escala al
        // conserje). `approve` crea el vehículo desde esta patente.
        visit.requestedPlate = createVisitDto.vehiclePlate;
      } else {
        visit.vehicle = await this.findOrCreateVisitorVehicle(
          this.vehicleRepository,
          visit.organizationId,
          {
            plate: createVisitDto.vehiclePlate,
            brand: createVisitDto.vehicleBrand,
            model: createVisitDto.vehicleModel,
            color: createVisitDto.vehicleColor,
          },
        );
      }
    }

    const savedVisit = await this.visitRepository.save(visit);

    if (!awaitingApproval) {
      // Notificar al host sobre la creación de la visita
      await this.notifyHostBestEffort(savedVisit, 'la creación', {
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
    }

    return savedVisit;
  }

  /**
   * Notificación al anfitrión DESPUÉS de confirmar la escritura (QA M2 /
   * seguridad B3): es best-effort, como en `ExpirationService`. Si falla, la
   * transición ya hecha se mantiene (un check-in registrado no puede terminar
   * en "Denegado" ni dejar al visitante atascado por una notificación).
   *
   * Con el anfitrión deshabilitado (`visit.host` en `null`, ver `hostIdOf`) la
   * notificación se omite con un log: la transición ya está hecha y no debe
   * terminar en una excepción.
   */
  private async notifyHostBestEffort(
    visit: Visit,
    event: string,
    notification: Omit<HostNotification, 'recipientId'>,
  ): Promise<void> {
    const recipientId = this.hostIdOf(visit);
    if (!recipientId) {
      this.logger.warn(
        `Visita ${visit.id} sin anfitrión activo: se omite la notificación de ${event}`,
      );
      return;
    }
    try {
      await this.notificationsService.create({ ...notification, recipientId });
    } catch (error) {
      this.logger.warn(
        `No se pudo notificar ${event} de la visita ${visit.id}: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Aprueba una solicitud (`AWAITING_APPROVAL → PENDING`, Fase 4 · P3, D2).
   *
   * En una sola transacción:
   *  - claim atómico condicionado al estado y al tenant (409 si otra request
   *    ya la resolvió o si no está esperando aprobación), que en el mismo
   *    `UPDATE` genera el QR (una solicitud no tiene QR, seguridad B1), guarda
   *    quién respondió y cuándo (`respondedById`/`respondedAt`, Fase 4 · P4)
   *    y, si viene, asigna como anfitrión al residente que respondió;
   *  - el `Vehicle` de la visita sale SOLO de `requestedPlate`, la patente que
   *    vio el residente (seguridad M2): nunca de un `vehicle` ya asociado ni de
   *    la sesión del conserje. Sin `requestedPlate`, la visita queda sin
   *    vehículo (el LPR no la reconoce; el QR sigue sirviendo).
   *  - la visita que se devuelve se lee DENTRO de la transacción (Fase 4 ·
   *    P4, M1): si esa lectura falla, el claim se revierte, así nunca queda
   *    una aprobación confirmada que el caller crea fallida.
   * Si algo falla, la visita sigue en `AWAITING_APPROVAL`. La notificación
   * VISIT_APPROVED va después del commit y es best-effort.
   *
   * NO hace check-in: lo hace el caller (`respondToVisitor`) en el mismo
   * evento que abre la puerta o el portón.
   */
  async approve(
    visitId: string,
    tenantScope: TenantScope,
    options: ResolveRequestOptions,
  ): Promise<Visit> {
    const approved = await this.visitRepository.manager.transaction(
      async (manager) => {
        const visits = manager.getRepository(Visit);
        await this.claimTransition(
          visits,
          visitId,
          VisitStatus.AWAITING_APPROVAL,
          VisitStatus.PENDING,
          tenantScope,
          'aprobar',
          {
            qrCode: this.generateQRCode(),
            ...this.responderPatch(options),
          },
        );

        const claimed = await visits.findOne({ where: { id: visitId } });
        const vehicleId = await this.approvedVehicleId(
          manager.getRepository(Vehicle),
          visitId,
          claimed,
        );
        await visits.update(
          { id: visitId },
          { vehicle: vehicleId ? { id: vehicleId } : null },
        );

        return this.readResolvedRequest(visits, visitId, tenantScope);
      },
    );

    await this.notifyHostBestEffort(approved, 'la aprobación', {
      type: NotificationType.VISIT_APPROVED,
      title: 'Visita Aprobada',
      message: `Se aprobó la visita ${approved.type === VisitType.VEHICULAR ? 'vehicular' : 'peatonal'} de ${approved.visitorName}. Válida hasta ${approved.validUntil.toLocaleString('es-CL')}.`,
      data: {
        visitId: approved.id,
        visitorName: approved.visitorName,
        type: approved.type,
        validFrom: approved.validFrom,
        validUntil: approved.validUntil,
      },
    });

    return approved;
  }

  /**
   * Vehículo de una solicitud recién aprobada: el de `requestedPlate` (busca
   * o crea el temporal de visitante) en las vehiculares; ninguno en el resto.
   */
  private async approvedVehicleId(
    vehicles: Repository<Vehicle>,
    visitId: string,
    claimed: Visit | null,
  ): Promise<string | null> {
    if (claimed?.type !== VisitType.VEHICULAR) {
      return null;
    }
    if (!claimed.requestedPlate) {
      this.logger.warn(
        `Visita vehicular ${visitId} aprobada sin patente solicitada: el LPR no podrá reconocerla`,
      );
      return null;
    }
    const vehicle = await this.findOrCreateVisitorVehicle(
      vehicles,
      claimed.organizationId,
      { plate: claimed.requestedPlate },
    );
    return vehicle.id;
  }

  /**
   * Columnas de la respuesta que van en el `UPDATE` del claim: quién
   * respondió y cuándo (Fase 4 · P4) y, si corresponde, el anfitrión.
   */
  private responderPatch(
    options: ResolveRequestOptions,
  ): QueryDeepPartialEntity<Visit> {
    return {
      respondedById: options.respondedById,
      respondedAt: new Date(),
      ...(options.hostId ? { host: { id: options.hostId } } : {}),
    };
  }

  /**
   * Rechaza una solicitud (`AWAITING_APPROVAL → DENIED`, Fase 4 · P3, D2),
   * con el mismo claim atómico que `approve` (409 si no estaba esperando
   * aprobación). Quién respondió (y, si era un residente notificado, el
   * anfitrión) se escribe en el mismo `UPDATE`.
   */
  async deny(
    visitId: string,
    tenantScope: TenantScope,
    options: ResolveRequestOptions,
  ): Promise<Visit> {
    // Fase 4 · P4 (M1): claim y relectura en la misma transacción, igual que
    // `approve`.
    return this.visitRepository.manager.transaction(async (manager) => {
      const visits = manager.getRepository(Visit);
      await this.claimTransition(
        visits,
        visitId,
        VisitStatus.AWAITING_APPROVAL,
        VisitStatus.DENIED,
        tenantScope,
        'denegar',
        this.responderPatch(options),
      );
      return this.readResolvedRequest(visits, visitId, tenantScope);
    });
  }

  /**
   * Solicitud recién resuelta, leída con el repositorio de la transacción del
   * claim (Fase 4 · P4, M1): si no se puede leer, la transacción se revierte.
   */
  private async readResolvedRequest(
    visits: Repository<Visit>,
    visitId: string,
    tenantScope: TenantScope,
  ): Promise<Visit> {
    const resolved = await visits.findOne({
      where: this.whereForScope(visitId, tenantScope),
      relations: ['host', 'family', 'vehicle'],
    });
    if (!resolved) {
      throw new NotFoundException(`Visita con ID ${visitId} no encontrada`);
    }
    return resolved;
  }

  /**
   * Resolución persistida de una solicitud: estado y quién respondió (Fase 4
   * · P4, M1). La usa `respondToVisitor` cuando `approve`/`deny` fallan sin
   * 409, para saber si su claim igual quedó confirmado (p. ej. un commit
   * ambiguo). `null` si la visita no existe en el scope.
   */
  async findResolution(
    visitId: string,
    tenantScope: TenantScope,
  ): Promise<{ status: VisitStatus; respondedById: string | null } | null> {
    const visit = await this.visitRepository.findOne({
      where: this.whereForScope(visitId, tenantScope),
    });
    return visit
      ? { status: visit.status, respondedById: visit.respondedById ?? null }
      : null;
  }

  /**
   * Expira una solicitud cuya sesión del conserje terminó sin respuesta del
   * residente (`AWAITING_APPROVAL → EXPIRED`, QA B4). Escritura condicionada
   * al estado y al tenant: si el residente ya respondió, no hace nada.
   *
   * @returns `true` si la solicitud se expiró.
   */
  async expireRequest(
    visitId: string,
    tenantScope: TenantScope,
  ): Promise<boolean> {
    assertTransition(VisitStatus.AWAITING_APPROVAL, VisitStatus.EXPIRED);
    const result = await this.visitRepository.update(
      {
        ...this.whereForScope(visitId, tenantScope),
        status: VisitStatus.AWAITING_APPROVAL,
      },
      { status: VisitStatus.EXPIRED },
    );
    return Boolean(result.affected);
  }

  /**
   * Fase 4 · P5.C: restringe una consulta de visitas (alias `visit`) al
   * alcance por familia del actor: las de su familia o en las que él es el
   * anfitrión; sin familia, solo estas últimas. `null` = sin restricción.
   * "Su familia" es la de la visita (`visit.family`, la del anfitrión al
   * crearla o al cambiarlo).
   */
  private applyFamilyScope(
    query: SelectQueryBuilder<Visit>,
    familyScope: FamilyScope | null,
  ): void {
    if (!familyScope) {
      return;
    }
    if (familyScope.familyId) {
      query.andWhere(
        '(visit.familyId = :scopeFamilyId OR visit.hostId = :scopeUserId)',
        {
          scopeFamilyId: familyScope.familyId,
          scopeUserId: familyScope.userId,
        },
      );
      return;
    }
    query.andWhere('visit.hostId = :scopeUserId', {
      scopeUserId: familyScope.userId,
    });
  }

  /**
   * ¿La visita es del espectador (anfitrión) o de su familia? Decide el
   * alcance por familia de una visita ya cargada y si el espectador recibe su
   * `qrCode` (Fase 4 · P5.C).
   */
  private isVisitOfFamily(visit: Visit, viewer: FamilyScope): boolean {
    return (
      this.hostIdOf(visit) === viewer.userId ||
      (viewer.familyId !== null &&
        (visit.family?.id ?? null) === viewer.familyId)
    );
  }

  /** 404 si la visita está fuera del alcance por familia (`null` = sin restricción). */
  private assertVisitInFamilyScope(
    visit: Visit,
    familyScope: FamilyScope | null,
    notFoundMessage = `Visita con ID ${visit.id} no encontrada`,
  ): void {
    if (familyScope && !this.isVisitOfFamily(visit, familyScope)) {
      throw new NotFoundException(notFoundMessage);
    }
  }

  /**
   * Ids del actor y de su familia, para decidir qué propietarios de vehículo
   * puede ver (corrección P5, cyber N2). `null` = ve todo su condominio
   * (`condominium.view-all`). Solo consulta la familia si alguna visita trae
   * un vehículo con propietario.
   */
  private async viewerFamilyIds(
    actor: TenantActor,
    visits: readonly Visit[],
  ): Promise<ReadonlySet<string> | null> {
    const scope = familyScopeOf(actor);
    if (!scope) {
      return null;
    }
    // Fase 4 · P6.R: también `ownerId` sin `owner` (los QueryBuilder de
    // `findAll`/`findByPlate` no cargan la relación eager).
    const hasOwners = visits.some(
      (visit) => visit.vehicle?.owner || visit.vehicle?.ownerId,
    );
    if (!hasOwners || !scope.familyId) {
      return new Set([scope.userId]);
    }
    const members = await this.usersService.findByFamily(scope.familyId);
    return new Set([scope.userId, ...members.map((member) => member.id)]);
  }

  /**
   * Fase 4 · P5.C: el `qrCode` es una credencial de acceso. Solo lo recibe el
   * anfitrión o alguien de su familia; para cualquier otro espectador
   * (incluidos Conserje y Administrador) va `null`. Muta la entidad cargada
   * (no se vuelve a guardar).
   *
   * Corrección P5:
   *  - (cyber B3) el anfitrión embebido va como `{ id, name }` para quien no
   *    ve el detalle de usuarios (sin `users.update`);
   *  - (cyber N2) igual el propietario del vehículo de la visita
   *    (`Vehicle.owner` es eager y `findOrCreateVisitorVehicle` reutiliza el
   *    vehículo registrado con esa patente, que puede ser el de un vecino).
   *    Para quien está acotado a su familia, el propietario (y `ownerId`) va
   *    `null` si no es de su familia.
   *  - (Fase 4 · P6.R) la decisión usa `owner.id` o, si la relación no vino
   *    cargada (QueryBuilder de `GET /visits` y `/visits/plate`), el
   *    `ownerId` de la columna: antes ese camino devolvía el `ownerId` del
   *    vecino.
   */
  private presentVisit(
    visit: Visit,
    actor: TenantActor,
    viewerFamilyIds: ReadonlySet<string> | null,
  ): Visit {
    if (
      !this.isVisitOfFamily(visit, {
        userId: actor.userId,
        familyId: actor.familyId ?? null,
      })
    ) {
      visit.qrCode = null;
    }
    visit.host = optionalEmbeddedUserFor(visit.host, actor);
    if (visit.vehicle) {
      const owner = visit.vehicle.owner ?? null;
      const ownerId = owner?.id ?? visit.vehicle.ownerId ?? null;
      if (ownerId && viewerFamilyIds && !viewerFamilyIds.has(ownerId)) {
        visit.vehicle.owner = null;
        visit.vehicle.ownerId = null;
      } else {
        visit.vehicle.owner = optionalEmbeddedUserFor(owner, actor);
      }
    }
    return visit;
  }

  /** Una visita tal como la ve el actor (ver `presentVisit`). */
  private async presentForViewer(
    visit: Visit,
    actor: TenantActor,
  ): Promise<Visit> {
    return this.presentVisit(
      visit,
      actor,
      await this.viewerFamilyIds(actor, [visit]),
    );
  }

  /** Varias visitas tal como las ve el actor (una sola consulta de familia). */
  private async presentAllForViewer(
    visits: Visit[],
    actor: TenantActor,
  ): Promise<Visit[]> {
    const viewerFamilyIds = await this.viewerFamilyIds(actor, visits);
    return visits.map((visit) =>
      this.presentVisit(visit, actor, viewerFamilyIds),
    );
  }

  /**
   * Visita por id del condominio del actor y de su alcance por familia (404
   * si no). Base de las rutas `/:id` (Fase 4 · P5.C).
   */
  private async loadVisitForActor(
    id: string,
    actor: TenantActor,
  ): Promise<Visit> {
    const visit = await this.loadVisitEntity(id);
    this.assertVisitInFamilyScope(visit, familyScopeOf(actor));
    return visit;
  }

  // ===========================================================================
  // Variantes por actor (Fase 4 · P5.C, D12). Las usa VisitsController: acotan
  // por familia a quien no tiene `condominium.view-all` (fuera de alcance →
  // 404) y ocultan el `qrCode` a quien no es de la familia del anfitrión.
  // Reemplazan a `@FilterByUser`/`UserFilterInterceptor`. Los métodos sin
  // actor siguen siendo los internos (agente, conserje digital, LPR).
  // ===========================================================================

  /**
   * `POST /visits`: el anfitrión, del alcance por familia del actor (403).
   * Corrección P5 (QA A1): la respuesta pasa por `presentForViewer` como
   * las demás: el Conserje o el Administrador que crea la visita para otro
   * recibe `qrCode: null`; el anfitrión o su familia, el QR.
   */
  async createForActor(
    dto: CreateVisitDto,
    actor: TenantActor,
  ): Promise<Visit> {
    const created = await this.create(dto, {
      familyScope: familyScopeOf(actor),
    });
    return this.presentForViewer(created, actor);
  }

  /** `GET /visits`. */
  async findAllForActor(
    filters: { status?: VisitStatus; type?: VisitType; hostId?: string },
    actor: TenantActor,
  ): Promise<Visit[]> {
    const visits = await this.findAll(filters, undefined, familyScopeOf(actor));
    return this.presentAllForViewer(visits, actor);
  }

  /** `GET /visits/active`. */
  async findActiveForActor(actor: TenantActor): Promise<Visit[]> {
    return this.findAllForActor({ status: VisitStatus.ACTIVE }, actor);
  }

  /** `GET /visits/pending`. */
  async findPendingForActor(actor: TenantActor): Promise<Visit[]> {
    const visits = await this.findPending(familyScopeOf(actor));
    return this.presentAllForViewer(visits, actor);
  }

  /** `GET /visits/:id`. */
  async findOneForActor(id: string, actor: TenantActor): Promise<Visit> {
    return this.presentForViewer(
      await this.loadVisitForActor(id, actor),
      actor,
    );
  }

  /** `GET /visits/qr/:qrCode`. */
  async findByQRCodeForActor(
    qrCode: string,
    actor: TenantActor,
  ): Promise<Visit> {
    const visit = await this.findByQRCode(qrCode);
    this.assertVisitInFamilyScope(
      visit,
      familyScopeOf(actor),
      'Visita no encontrada con el código QR proporcionado',
    );
    return this.presentForViewer(visit, actor);
  }

  /** `GET /visits/plate/:plate`: 404 si no hay una visita vigente en su alcance. */
  async findByPlateForActor(plate: string, actor: TenantActor): Promise<Visit> {
    const visit = await this.findByPlate(
      plate,
      undefined,
      familyScopeOf(actor),
    );
    if (!visit) {
      throw new NotFoundException('Visita no encontrada con esa patente');
    }
    return this.presentForViewer(visit, actor);
  }

  /** `PATCH /visits/:id`. */
  async updateForActor(
    id: string,
    dto: UpdateVisitDto,
    actor: TenantActor,
  ): Promise<Visit> {
    const updated = await this.update(id, dto, undefined, familyScopeOf(actor));
    return this.presentForViewer(updated, actor);
  }

  /** `POST /visits/:id/check-in`. */
  async checkInForActor(id: string, actor: TenantActor): Promise<Visit> {
    await this.loadVisitForActor(id, actor);
    return this.presentForViewer(await this.checkIn(id), actor);
  }

  /** `POST /visits/:id/check-out`. */
  async checkOutForActor(id: string, actor: TenantActor): Promise<Visit> {
    await this.loadVisitForActor(id, actor);
    return this.presentForViewer(await this.checkOut(id), actor);
  }

  /** `POST /visits/:id/cancel`. */
  async cancelForActor(id: string, actor: TenantActor): Promise<Visit> {
    await this.loadVisitForActor(id, actor);
    return this.presentForViewer(await this.cancel(id), actor);
  }

  /** `DELETE /visits/:id`. */
  async removeForActor(id: string, actor: TenantActor): Promise<void> {
    await this.loadVisitForActor(id, actor);
    await this.remove(id);
  }

  /** `POST /visits/validate` (la visita va sin `qrCode` si no es de su familia). */
  async validateAccessForActor(
    identifier: string,
    type: 'qr' | 'plate',
    actor: TenantActor,
  ): Promise<VisitAccessValidation> {
    const result = await this.validateAccess(identifier, type);
    if (result.visit) {
      await this.presentForViewer(result.visit, actor);
    }
    return result;
  }

  /**
   * Obtener todas las visitas con filtros opcionales. `familyScope` (P5.C):
   * ver `applyFamilyScope`; los callers internos no lo pasan.
   */
  async findAll(
    filters?: {
      status?: VisitStatus;
      type?: VisitType;
      hostId?: string;
      familyId?: string;
    },
    options?: TenantScopeOptions,
    familyScope: FamilyScope | null = null,
  ): Promise<Visit[]> {
    const query = this.visitRepository
      .createQueryBuilder('visit')
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
      query.andWhere('visit.familyId = :familyId', {
        familyId: filters.familyId,
      });
    }

    this.applyFamilyScope(query, familyScope);

    return await query.getMany();
  }

  /**
   * Obtener visitas activas (en curso)
   */
  async findActive(): Promise<Visit[]> {
    return await this.findAll({ status: VisitStatus.ACTIVE });
  }

  /**
   * Obtener visitas pendientes (programadas para hoy o futuro). Con
   * `familyScope` (P5.C): las de su familia o en las que él es el anfitrión
   * (forma OR del `where`, ver `applyFamilyScope`).
   */
  async findPending(familyScope: FamilyScope | null = null): Promise<Visit[]> {
    const ctx = await this.tenantContext.getContext();
    const base: FindOptionsWhere<Visit> = {
      status: VisitStatus.PENDING,
      validFrom: MoreThan(new Date()),
    };
    let where: FindOptionsWhere<Visit> | FindOptionsWhere<Visit>[] = base;
    if (familyScope) {
      where = [{ ...base, host: { id: familyScope.userId } }];
      if (familyScope.familyId) {
        where.push({ ...base, family: { id: familyScope.familyId } });
      }
    }
    return await this.visitRepository.find({
      where: scopeWhere(where, ctx),
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
      throw new NotFoundException(
        'Visita no encontrada con el código QR proporcionado',
      );
    }

    return visit;
  }

  /**
   * Buscar visita por patente (para visitas vehiculares). Solo estados de
   * `LPR_MATCHABLE`: una solicitud `AWAITING_APPROVAL` nunca calza.
   */
  async findByPlate(
    plate: string,
    options?: TenantScopeOptions,
    familyScope: FamilyScope | null = null,
  ): Promise<Visit | null> {
    const query = this.visitRepository
      .createQueryBuilder('visit')
      .leftJoinAndSelect('visit.vehicle', 'vehicle')
      .leftJoinAndSelect('visit.host', 'host')
      .leftJoinAndSelect('visit.family', 'family')
      .where('vehicle.plate = :plate', { plate })
      .andWhere('visit.status IN (:...statuses)', {
        statuses: [...LPR_MATCHABLE],
      })
      .andWhere('visit.validFrom <= :now', { now: new Date() })
      .andWhere('visit.validUntil >= :now', { now: new Date() });

    if (options?.organizationId) {
      // Camino LPR (ver DetectionsService.createDetection): acota la
      // búsqueda al condominio de la CÁMARA que detectó la patente —
      // reutiliza applyTenantFilter con un TenantContext sintético en vez de
      // buscar la patente en TODOS los condominios (fix cross-tenant).
      applyTenantFilter(query, 'visit', {
        organizationId: options.organizationId,
        isSuperAdmin: false,
      });
    } else if (!options?.skipTenantScope) {
      const ctx = await this.tenantContext.getContext();
      applyTenantFilter(query, 'visit', ctx);
    }

    this.applyFamilyScope(query, familyScope);

    const visit = await query.getOne();

    return visit;
  }

  /**
   * Actualizar una visita (`PATCH /visits/:id`).
   *
   * Fase 4 · P3 (seguridad M1 / QA M3):
   *  - Solo en `EDITABLE_FROM` (PENDING o READY_FOR_REENTRY); cualquier otro
   *    estado responde 409. Una solicitud AWAITING_APPROVAL no se edita: el
   *    residente aprueba exactamente lo que vio (seguridad M2).
   *  - Escribe un patch EXPLÍCITO con los campos editables, nunca la entidad
   *    completa: `status`, `usedCount`, `entryTime`, `exitTime` y `qrCode` no
   *    se tocan (antes `save()` reescribía los valores leídos y revivía
   *    visitas canceladas o reiniciaba usos si otra request cambiaba la visita
   *    en el medio). `entryTime`/`exitTime` del DTO se ignoran: las marcas las
   *    registran `checkIn`/`checkOut`.
   *  - El `UPDATE` se condiciona al estado y a los usos leídos (y al tenant):
   *    si la visita cambió entre la lectura y la escritura (también un
   *    ingreso + salida que la deja otra vez lista para reingresar), 409.
   *  - Sin condominio (camino HTTP, salvo super-admin) responde 403 antes de
   *    leer nada (ver `resolveWriteScope`).
   *  - Fase 4 · P5.C: con `familyScope` (actor sin `condominium.view-all`),
   *    una visita fuera de su familia responde 404 y el anfitrión nuevo debe
   *    ser él o alguien de su familia (403).
   */
  async update(
    id: string,
    updateVisitDto: UpdateVisitDto,
    options?: TenantScopeOptions,
    familyScope: FamilyScope | null = null,
  ): Promise<Visit> {
    const scope = await this.resolveWriteScope(options?.organizationId);
    const where = await this.visitWhere(id, options);
    const visit = await this.findVisitOrFail(id, where);
    this.assertVisitInFamilyScope(visit, familyScope);

    if (!EDITABLE_FROM.includes(visit.status)) {
      throw new ConflictException(
        `No se puede editar la visita: está ${describeVisitStatus(visit.status)}`,
      );
    }

    const patch = await this.buildEditPatch(
      visit,
      updateVisitDto,
      scope,
      familyScope,
    );
    if (Object.keys(patch).length === 0) {
      return visit;
    }

    const result = await this.visitRepository.update(
      { ...where, status: visit.status, usedCount: visit.usedCount },
      patch,
    );
    if (!result.affected) {
      throw new ConflictException(
        'La visita cambió mientras se editaba; vuelve a intentarlo',
      );
    }

    return this.findVisitOrFail(id, where);
  }

  /**
   * Patch de `update` con SOLO los campos editables presentes en el DTO.
   * Valida la ventana resultante, el máximo de usos (nunca menor que los ya
   * registrados), el anfitrión (del condominio de la escritura) y el vehículo:
   * una visita peatonal queda sin vehículo (el LPR no la reconoce) y en una
   * vehicular la patente se asocia con `findOrCreateVisitorVehicle` (un
   * `Vehicle` temporal válido para el LPR, nunca uno sin tipo ni estado).
   */
  private async buildEditPatch(
    visit: Visit,
    dto: UpdateVisitDto,
    scope: VisitWriteScope,
    familyScope: FamilyScope | null,
  ): Promise<QueryDeepPartialEntity<Visit>> {
    const patch: QueryDeepPartialEntity<Visit> = {};

    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.visitorName !== undefined) patch.visitorName = dto.visitorName;
    if (dto.visitorRut !== undefined) patch.visitorRut = dto.visitorRut || null;
    if (dto.visitorPhone !== undefined) {
      patch.visitorPhone = dto.visitorPhone || null;
    }
    if (dto.reason !== undefined) patch.reason = dto.reason || null;
    if (dto.maxUses !== undefined) {
      patch.maxUses = this.editedMaxUses(dto.maxUses, visit.usedCount);
    }

    const validFrom =
      dto.validFrom !== undefined ? new Date(dto.validFrom) : visit.validFrom;
    const validUntil =
      dto.validUntil !== undefined
        ? new Date(dto.validUntil)
        : visit.validUntil;
    if (validFrom >= validUntil) {
      throw new BadRequestException(
        'La fecha de inicio debe ser anterior a la fecha de fin',
      );
    }
    if (dto.validFrom !== undefined) patch.validFrom = validFrom;
    if (dto.validUntil !== undefined) patch.validUntil = validUntil;

    if (dto.hostId !== undefined) {
      const host = await this.usersService.findOne(dto.hostId);
      if (!host) {
        throw new NotFoundException(
          `Usuario anfitrión con ID ${dto.hostId} no encontrado`,
        );
      }
      // Fix cross-tenant: el anfitrión debe ser del condominio de la escritura.
      await this.assertHostInScope(host, scope);
      // P5.C: y, para un actor acotado a su familia, él o alguien de su familia.
      this.assertHostInFamilyScope(host, familyScope);
      if (scope.kind === 'platform') {
        // Residual de P3 (Fase 4 · P4): el super-admin no tiene condominio
        // propio, y el patch no mueve `organizationId`.
        this.assertHostInVisitOrganization(host, visit);
      }
      patch.host = { id: host.id };
      // La familia sigue al anfitrión.
      patch.family = host.family ? { id: host.family.id } : null;
    }

    const type = dto.type ?? visit.type;
    if (type === VisitType.PEDESTRIAN) {
      // QA N6: una visita peatonal no tiene vehículo (ni el que tenía antes de
      // cambiar de tipo): si no, el LPR la seguiría reconociendo. La patente
      // que venga en el DTO se ignora.
      if (visit.vehicle || dto.type !== undefined) {
        patch.vehicle = null;
      }
    } else if (dto.vehiclePlate === '') {
      patch.vehicle = null;
    } else if (dto.vehiclePlate !== undefined) {
      const vehicle = await this.findOrCreateVisitorVehicle(
        this.vehicleRepository,
        visit.organizationId,
        {
          plate: dto.vehiclePlate,
          brand: dto.vehicleBrand,
          model: dto.vehicleModel,
          color: dto.vehicleColor,
        },
      );
      patch.vehicle = { id: vehicle.id };
    }

    return patch;
  }

  /**
   * Máximo de usos editado (`null` = ilimitado). QA N6: nunca menor que los
   * usos ya registrados, 400 si no.
   */
  private editedMaxUses(
    maxUses: number | null,
    usedCount: number,
  ): number | null {
    const value = maxUses || null;
    if (value !== null && value < usedCount) {
      throw new BadRequestException(
        `El máximo de usos (${value}) no puede ser menor que los usos ya registrados (${usedCount})`,
      );
    }
    return value;
  }

  /**
   * Registrar entrada de una visita.
   *
   * Fase 4 · P3 (D3): solo desde `CHECKIN_FROM` (PENDING o
   * READY_FOR_REENTRY). Una solicitud sin aprobar, rechazada, completada,
   * cancelada o expirada responde 409. La escritura se condiciona al estado y
   * al contador leídos, así dos detecciones simultáneas no registran dos
   * entradas ni superan `maxUses`.
   *
   * Si la entrada ya quedó registrada (la visita está ACTIVE, al leerla o
   * porque otra request ganó el `UPDATE`), lanza
   * `VisitEntryAlreadyRegisteredException` (409): los flujos automáticos la
   * tratan como idempotente (seguridad B4). La notificación al anfitrión es
   * best-effort.
   */
  async checkIn(id: string, options?: TenantScopeOptions): Promise<Visit> {
    const visit = await this.loadVisitEntity(id, options);
    const now = new Date();

    if (visit.status === VisitStatus.ACTIVE) {
      throw new VisitEntryAlreadyRegisteredException();
    }

    if (!CHECKIN_FROM.includes(visit.status)) {
      throw new ConflictException(
        `No se puede registrar la entrada: la visita está ${describeVisitStatus(visit.status)}`,
      );
    }

    // Validar que esté dentro del período válido
    if (now < visit.validFrom || now > visit.validUntil) {
      throw new BadRequestException(
        'La visita no está dentro del período válido',
      );
    }

    // Validar contador de usos si está definido
    if (visit.maxUses !== null && visit.usedCount >= visit.maxUses) {
      throw new BadRequestException(
        `La visita ha alcanzado el máximo de usos permitidos (${visit.maxUses})`,
      );
    }

    const usedCount = visit.usedCount + 1;
    const claimed = await this.visitRepository.update(
      { id: visit.id, status: visit.status, usedCount: visit.usedCount },
      {
        status: VisitStatus.ACTIVE,
        usedCount,
        entryTime: now,
        exitTime: null, // Limpiar salida anterior si existía
      },
    );
    if (!claimed.affected) {
      const current = await this.visitRepository.findOne({
        where: { id: visit.id },
      });
      if (current?.status === VisitStatus.ACTIVE) {
        throw new VisitEntryAlreadyRegisteredException();
      }
      throw new ConflictException(
        'La visita cambió mientras se registraba la entrada; vuelve a intentarlo',
      );
    }

    visit.usedCount = usedCount;
    visit.entryTime = now;
    visit.exitTime = null;
    visit.status = VisitStatus.ACTIVE;
    const savedVisit = visit;

    // Notificar al host sobre la llegada de la visita
    const usageInfo =
      visit.maxUses !== null
        ? ` (Uso ${visit.usedCount}/${visit.maxUses})`
        : '';

    await this.notifyHostBestEffort(savedVisit, 'la entrada', {
      type: NotificationType.VISIT_CHECK_IN,
      title: 'Visita Arribó',
      message: `${savedVisit.visitorName} ha llegado${usageInfo}. ${savedVisit.type === VisitType.VEHICULAR ? `Patente: ${savedVisit.vehicle?.plate || 'N/A'}` : 'Visita peatonal'}.`,
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
   * Registrar salida de una visita (`ACTIVE → READY_FOR_REENTRY | COMPLETED`).
   * Desde otro estado responde 409. La escritura se condiciona a que la
   * visita siga `ACTIVE` (409 si otra request la movió). La notificación al
   * anfitrión es best-effort.
   *
   * Si la salida ya quedó registrada (la visita está lista para reingresar o
   * completada, al leerla o porque otra request ganó el `UPDATE`), lanza
   * `VisitExitAlreadyRegisteredException` (409): el LPR la trata como lectura
   * duplicada (QA N5).
   */
  async checkOut(id: string, options?: TenantScopeOptions): Promise<Visit> {
    const visit = await this.loadVisitEntity(id, options);

    if (this.isExitRegistered(visit.status)) {
      throw new VisitExitAlreadyRegisteredException();
    }

    if (visit.status !== VisitStatus.ACTIVE) {
      throw new ConflictException(
        `No se puede registrar la salida: la visita está ${describeVisitStatus(visit.status)}`,
      );
    }

    // Si aún tiene usos disponibles, marcar como READY_FOR_REENTRY para permitir reingreso
    // Si ya no tiene usos, marcar como COMPLETED
    const nextStatus =
      visit.maxUses === null || visit.usedCount < visit.maxUses
        ? VisitStatus.READY_FOR_REENTRY
        : VisitStatus.COMPLETED;
    assertTransition(visit.status, nextStatus);

    const exitTime = new Date();
    const claimed = await this.visitRepository.update(
      { id: visit.id, status: VisitStatus.ACTIVE },
      { status: nextStatus, exitTime },
    );
    if (!claimed.affected) {
      const current = await this.visitRepository.findOne({
        where: { id: visit.id },
      });
      if (current && this.isExitRegistered(current.status)) {
        throw new VisitExitAlreadyRegisteredException();
      }
      throw new ConflictException(
        'La visita cambió mientras se registraba la salida; vuelve a intentarlo',
      );
    }

    visit.exitTime = exitTime;
    visit.status = nextStatus;
    const savedVisit = visit;

    // Notificar al host sobre la salida de la visita
    const statusInfo =
      savedVisit.status === VisitStatus.COMPLETED
        ? 'Visita completada (sin usos disponibles).'
        : 'Podrá reingresar si está dentro del período válido.';

    await this.notifyHostBestEffort(savedVisit, 'la salida', {
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
   * Cancelar una visita. Solo una visita programada sin usos (`PENDING`):
   * una solicitud sin aprobar se rechaza (`deny`), no se cancela. Todo
   * problema de estado responde 409 (QA B6).
   */
  async cancel(id: string): Promise<Visit> {
    const visit = await this.loadVisitEntity(id);

    if (!canTransition(visit.status, VisitStatus.CANCELLED)) {
      throw new ConflictException(
        `No se puede cancelar la visita: está ${describeVisitStatus(visit.status)}`,
      );
    }

    // Defensa adicional: una visita con usos registrados nunca se cancela.
    if (visit.usedCount > 0) {
      throw new ConflictException(
        'No se puede cancelar una visita que ya tiene usos registrados',
      );
    }

    const claimed = await this.visitRepository.update(
      { id: visit.id, status: visit.status },
      { status: VisitStatus.CANCELLED },
    );
    if (!claimed.affected) {
      throw new ConflictException(
        'La visita cambió mientras se cancelaba; vuelve a intentarlo',
      );
    }

    visit.status = VisitStatus.CANCELLED;
    return visit;
  }

  /**
   * Eliminar una visita
   */
  async remove(id: string): Promise<void> {
    const visit = await this.loadVisitEntity(id);
    await this.visitRepository.remove(visit);
  }

  /**
   * Validar acceso de una visita (por QR o patente).
   *
   * Fase 4 · P3 (D3): lista BLANCA. Solo los estados de `QR_VALID` (PENDING,
   * ACTIVE, READY_FOR_REENTRY), dentro de la ventana de validez, son
   * válidos; cualquier otro estado (incluido uno que se agregue en el futuro)
   * es inválido por defecto.
   */
  async validateAccess(
    identifier: string,
    type: 'qr' | 'plate',
    options?: TenantScopeOptions,
  ): Promise<VisitAccessValidation> {
    let visit: Visit | null = null;

    if (type === 'qr') {
      try {
        visit = await this.findByQRCode(identifier);
      } catch {
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

    if (!QR_VALID.includes(visit.status)) {
      return {
        valid: false,
        visit,
        message:
          INVALID_STATUS_MESSAGES[visit.status] ??
          `Visita ${describeVisitStatus(visit.status)}`,
      };
    }

    const now = new Date();

    if (now < visit.validFrom) {
      return {
        valid: false,
        visit,
        message: `Visita válida desde ${visit.validFrom.toLocaleString()}`,
      };
    }

    if (now > visit.validUntil) {
      await this.markExpired(visit);
      return { valid: false, visit, message: 'Visita expirada' };
    }

    // READY_FOR_REENTRY es válido (puede reingresar) si aún tiene usos disponibles
    if (
      visit.status === VisitStatus.READY_FOR_REENTRY &&
      visit.maxUses !== null &&
      visit.usedCount >= visit.maxUses
    ) {
      return { valid: false, visit, message: 'Visita sin usos disponibles' };
    }

    return {
      valid: true,
      visit,
      message: 'Acceso autorizado',
    };
  }

  /**
   * Marca como `EXPIRED` una visita cuya ventana de validez ya terminó (si la
   * máquina de estados lo permite) y avisa al host. La escritura se
   * condiciona al estado leído: si otra request la movió antes, no hace nada.
   */
  private async markExpired(visit: Visit): Promise<void> {
    if (!canTransition(visit.status, VisitStatus.EXPIRED)) {
      return;
    }

    const result = await this.visitRepository.update(
      { id: visit.id, status: visit.status },
      { status: VisitStatus.EXPIRED },
    );
    if (!result.affected) {
      return;
    }
    visit.status = VisitStatus.EXPIRED;

    await this.notifyHostBestEffort(visit, 'la expiración', {
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

  /**
   * Estados que implican una salida ya registrada: lista para reingresar
   * (`checkOut` con usos disponibles) o completada (`checkOut` sin usos, o el
   * cierre por validez de una lista para reingresar en `ExpirationService`).
   */
  private isExitRegistered(status: VisitStatus): boolean {
    return (
      status === VisitStatus.READY_FOR_REENTRY ||
      status === VisitStatus.COMPLETED
    );
  }

  /**
   * Generar código QR único
   */
  private generateQRCode(): string {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(16).toString('hex');
    return crypto
      .createHash('sha256')
      .update(`${timestamp}-${random}`)
      .digest('hex')
      .substring(0, 32);
  }
}
