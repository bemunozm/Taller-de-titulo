import {
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import { CreateAccessAttemptDto } from './dto/create-access-attempt.dto';
import { RespondPendingDetectionDto } from './dto/respond-pending-detection.dto';
import { VehiclesService } from '../vehicles/vehicles.service';
import { VisitsService } from '../visits/visits.service';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import {
  NotificationType,
  NotificationPriority,
} from '../notifications/entities/notification.entity';
import { HubGateway } from '../hub/hub.gateway';
import {
  applyTenantFilter,
  scopeWhere,
} from '../common/tenant/tenant-context.util';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type { FamilyScope } from '../common/tenant/tenant-actor';
import { Visit, VisitStatus } from '../visits/entities/visit.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import {
  VehicleAccessLevel,
  vehicleAccessRuleFor,
} from '../vehicles/vehicle-access';
import {
  CHECKIN_FROM,
  describeVisitStatus,
} from '../visits/visit-state-machine';
import { VisitEntryAlreadyRegisteredException } from '../visits/visit-entry-already-registered.exception';
import { VisitExitAlreadyRegisteredException } from '../visits/visit-exit-already-registered.exception';
import { errorMessage } from '../common/utils/error-message.util';
import { maskPlate } from '../common/privacy/pii-mask';
import { parseVisitExitCooldownMinutes } from '../config/env.validation';
import {
  DUPLICATE_ACCESS_DECISION,
  REGISTERED_ACCESS_DECISION,
  type AccessDecision,
} from './access-decision';
import { normalizeChileanPlate } from '../common/utils/chilean-format.util';
import { isRegisterOnly } from '../cameras/lpr-settings';
import { VehiclePassage } from './entities/vehicle-passage.entity';
import { VehiclePassagesService } from './vehicle-passages.service';
import {
  methodForDirection,
  readDirection,
  verifyReadingSource,
} from './vehicle-passage-direction';

/** Usuario de la sesión que responde una detección pendiente. */
export interface PendingDetectionResponder {
  id: string;
  name: string;
}

/** Motivo con el que escala una visita cuyo anfitrión ya no está activo. */
const INACTIVE_HOST_REASON =
  'Anfitrión de la visita inactivo o fuera del condominio - requiere aprobación';

/** `method` de un intento de solo registro cuando no se conoce la dirección. */
const REGISTER_UNKNOWN_METHOD = 'Patente - Registro';
/** `method` de un intento de acceso de residente cuando no se conoce la dirección. */
const ACCESS_UNKNOWN_METHOD = 'Patente - Entrada';

interface AccessOutcome {
  decision: AccessDecision;
  reason: string;
  residente: User | null;
  isExit: boolean;
}

@Injectable()
export class DetectionsService {
  private readonly logger = new Logger(DetectionsService.name);
  /**
   * Espera tras el ingreso (o la salida) de una visita en la que el LPR no
   * registra el paso contrario (ms, VISIT_EXIT_COOLDOWN_MINUTES).
   */
  private readonly exitCooldownMs: number;

  constructor(
    @InjectRepository(PlateDetection)
    private readonly detectionsRepo: Repository<PlateDetection>,
    @InjectRepository(AccessAttempt)
    private readonly attemptsRepo: Repository<AccessAttempt>,
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    private readonly vehiclesService: VehiclesService,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
    private readonly hubGateway: HubGateway,
    @Inject(forwardRef(() => VisitsService))
    private readonly visitsService: VisitsService,
    configService: ConfigService,
    private readonly passages: VehiclePassagesService,
  ) {
    this.exitCooldownMs =
      parseVisitExitCooldownMinutes(
        configService.get<string>('VISIT_EXIT_COOLDOWN_MINUTES'),
      ) *
      60 *
      1000;
  }

  /**
   * Cámara de una detección (id UUID o mountPath, limpiando el sufijo
   * `_guardia` del worker manager). Réplica minimalista de
   * `CamerasService.resolveCameraByIdOrMount` para no acoplar módulos.
   */
  private async resolveCamera(cameraIdOrMount: string): Promise<Camera | null> {
    if (!cameraIdOrMount) return null;
    const cleanId = cameraIdOrMount.replace('_guardia', '');
    const isUuid =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        cleanId,
      );

    return isUuid
      ? this.cameraRepository.findOne({ where: { id: cleanId } })
      : this.cameraRepository.findOne({ where: { mountPath: cleanId } });
  }

  /**
   * Hallazgo A2 (Fase 4 · P2): la ingesta usa el condominio de la API key de
   * servicio. La cámara debe existir y ser de ESE condominio antes de
   * cualquier efecto (guardar, check-in/out, notificar, abrir el portón);
   * si no, 403 y nada más. Una key del condominio A ya no puede inyectar
   * eventos en una cámara de B. Inexistente y ajena responden igual (no
   * revela qué cámaras existen en otros condominios).
   */
  private async requireCameraOfOrganization(
    cameraIdOrMount: string,
    keyOrganizationId: string,
  ): Promise<Camera> {
    const camera = await this.resolveCamera(cameraIdOrMount);
    if (!camera || camera.organizationId !== keyOrganizationId) {
      this.logger.warn(
        `Ingesta rechazada: la cámara ${cameraIdOrMount} no pertenece al condominio de la API key`,
      );
      throw new ForbiddenException(
        'La cámara no pertenece al condominio de la API key de servicio',
      );
    }
    return camera;
  }

  /**
   * D11: la patente se normaliza (mayúsculas, sin espacios ni símbolos) antes
   * de persistir y de buscar el vehículo/visita (la búsqueda es por igualdad
   * exacta). Si la normalización cambia el texto y el worker no mandó
   * `plate_raw`, se conserva lo recibido ahí. Una patente que queda vacía se
   * rechaza (400): no puede coincidir con nada.
   */
  private normalizeIncomingPlate(
    input: CreatePlateDetectionDto,
  ): CreatePlateDetectionDto {
    const plate = normalizeChileanPlate(input.plate);
    if (plate.length === 0) {
      throw new BadRequestException(
        'La patente no contiene caracteres válidos',
      );
    }
    if (plate === input.plate) return input;
    return {
      ...input,
      plate,
      plate_raw: input.plate_raw ?? input.plate.slice(0, 64),
    };
  }

  /**
   * D8 — cámara en modo "solo registrar" (`lprSettings.action = 'register'`).
   * Guarda la detección y un intento `Registrado` y NADA más: sin búsqueda de
   * vehículo/visita, sin aprobación del conserje, sin check-in/out, sin
   * notificación de acceso y sin `sendDoorOpen`. Es la única salida de
   * `createDetection` para estas cámaras y se evalúa antes de cualquier efecto.
   */
  private async registerOnly(saved: PlateDetection, passage: VehiclePassage) {
    const att = this.attemptsRepo.create({
      detection: saved,
      decision: REGISTERED_ACCESS_DECISION,
      reason: 'Cámara en modo solo registro: no se evalúa acceso',
      // La dirección es la de la PASADA (la mejor fuente de todas las cámaras).
      method: methodForDirection(passage.direction, REGISTER_UNKNOWN_METHOD),
      residente: null,
      // No es una decisión de acceso: sin tiempo de respuesta, no cuenta en las
      // métricas de SLA del dashboard.
      responseTimeMs: null,
      organizationId: saved.organizationId,
    });
    const result = await this.passages.saveAttempt(att, passage, {
      decidesAccess: false,
      followsDirection: true,
      unknownMethod: REGISTER_UNKNOWN_METHOD,
    });
    if (!result.written) {
      return this.asEvidence(saved, result.attempt, passage);
    }
    const savedAtt = result.attempt;
    this.logger.log(
      `Detección ${saved.id} (${maskPlate(saved.plate)}) registrada en cámara de solo registro`,
    );
    return {
      detection: saved,
      attempt: savedAtt,
      isExit: passage.direction === 'exit',
      passage: this.passages.summarize(passage),
      deduplicated: false,
    };
  }

  /**
   * El llamador perdió el liderazgo de la pasada (otra lectura la tomó) o la
   * pasada ya tiene una decisión de acceso: su lectura es evidencia. Responde
   * como tal, SIN abrir, notificar ni tocar visitas o conserje.
   */
  private asEvidence(
    detection: PlateDetection,
    attempt: AccessAttempt | null,
    passage: VehiclePassage,
  ) {
    this.logger.warn(
      `Detección ${detection.id} (${maskPlate(detection.plate)}): la pasada ${passage.id} ya no la lidera esta petición o ya tiene decisión; queda como evidencia`,
    );
    return {
      detection,
      attempt,
      isExit: passage.direction === 'exit',
      passage: this.passages.summarize(passage),
      deduplicated: true,
    };
  }

  async createDetection(
    input: CreatePlateDetectionDto,
    keyOrganizationId: string,
  ) {
    const camera = await this.requireCameraOfOrganization(
      input.cameraId,
      keyOrganizationId,
    );
    const dto = this.normalizeIncomingPlate(input);

    // Mapear DTO a la entidad PlateDetection. Usamos el campo `meta` como JSONB
    // para guardar bbox, snapshot y estadísticas de caracteres.
    const ent = this.detectionsRepo.create(dto);
    // Tarea #19 + A2: el condominio es el de la cámara, que ya se verificó
    // igual al de la API key.
    ent.organizationId = camera.organizationId;

    // Pasadas (E6): ANTES de cualquier efecto, bajo el advisory lock de
    // (condominio, patente), se guarda la detección y se decide si es una
    // pasada nueva (esta petición decide el acceso) o evidencia de una ya
    // abierta (no crea intento, no notifica, no abre, no toca visitas).
    // La fuente de la dirección que declara el worker se valida contra la
    // configuración de la cámara (ver `verifyReadingSource`). Una cámara de
    // solo registro no decide el acceso: otra de acceso puede promover su
    // pasada (ver `VehiclePassagesService.claim`).
    const reading = verifyReadingSource(
      readDirection(dto.meta?.direction, dto.meta?.direction_source),
      camera.lprSettings,
    );
    if (
      reading.source !== dto.meta?.direction_source &&
      dto.meta?.direction_source !== undefined &&
      dto.meta.direction !== 'unknown'
    ) {
      this.logger.debug(
        `direction_source '${dto.meta.direction_source}' no respaldada por la configuración de la cámara ${camera.id}: se usa '${reading.source}'`,
      );
    }
    // La detección guarda la fuente EFECTIVA (la verificada): es la que ve la
    // trazabilidad. Lo declarado por el worker se conserva aparte si difiere.
    if (ent.meta && dto.meta?.direction !== undefined) {
      const declared = dto.meta.direction_source;
      ent.meta = {
        ...ent.meta,
        direction: reading.direction,
        direction_source: reading.source,
        ...(declared !== undefined && declared !== reading.source
          ? { direction_source_declared: declared }
          : {}),
      };
    }
    const claim = await this.passages.claim(ent, reading, {
      decidesAccess: !isRegisterOnly(camera.lprSettings),
    });
    if (claim.kind === 'sighting') {
      this.logger.log(
        `Detección ${claim.detection.id} (${maskPlate(dto.plate)}) agregada como evidencia de la pasada ${claim.passage.id}`,
      );
      return {
        detection: claim.detection,
        attempt: claim.attempt,
        passage: this.passages.summarize(claim.passage),
        deduplicated: true,
      };
    }

    try {
      return await this.decideAccess(
        claim.detection,
        claim.passage,
        dto,
        camera,
        keyOrganizationId,
      );
    } catch (error) {
      // Si falló antes de guardar el intento, la pasada no puede quedar
      // "ocupada" sin intento: se descarta para que la próxima lectura decida.
      // Una promoción fallida solo vuelve a "solo registro" (su intento
      // Registrado se conserva).
      if (claim.promoted) {
        await this.passages.demote(claim.passage);
      } else {
        await this.passages.release(claim.passage);
      }
      throw error;
    }
  }

  /**
   * Flujo de decisión del líder de la pasada (antes el cuerpo de
   * `createDetection` tras guardar la detección). Corre FUERA del lock.
   */
  private async decideAccess(
    saved: PlateDetection,
    passage: VehiclePassage,
    dto: CreatePlateDetectionDto,
    camera: Camera,
    keyOrganizationId: string,
  ) {
    // D8: cámara de solo registro -> salida temprana y fail-closed (ver
    // `isRegisterOnly`), antes de cualquier búsqueda o efecto de acceso.
    if (isRegisterOnly(camera.lprSettings)) {
      return this.registerOnly(saved, passage);
    }

    const pending = (reason: string) =>
      this.createPendingDetectionForConcierge(saved, reason, passage);

    // FIX aislamiento cross-tenant en la apertura física autónoma del portón
    // (rama feature/cierre-fases-1-2, hallazgo reportado): hasta acá, la
    // búsqueda de vehículo/visita para decidir si abrir el portón se hacía
    // con `skipTenantScope: true` (TODOS los condominios) — una visita o
    // vehículo pre-aprobado del condominio B abría el portón físico del
    // condominio A si una cámara de A leía esa patente. El `organizationId`
    // de la CÁMARA (resource-derived, `saved.organizationId` arriba) es la
    // fuente de tenant confiable en este flujo (el worker LPR no tiene
    // `request.user`), así que se usa para acotar ambas búsquedas al MISMO
    // condominio de la cámara — ver `VehiclesService.findByPlate` y
    // `VisitsService.findByPlate`/`validateAccess`, que ahora aceptan este
    // scope explícito además de `skipTenantScope`.
    //
    // Una cámara sin organizationId (legacy, pre-tarea #19) ya no llega acá:
    // `requireCameraOfOrganization` la rechaza con 403 (A2), porque nunca
    // coincide con el condominio de la API key.
    const cameraOrganizationId = keyOrganizationId;

    // Validar acceso siguiendo este orden de prioridad (Fase 4 · P3, D4:
    // fail-closed — "Permitido" SOLO en las ramas explícitas de abajo). Fase
    // 4 · P5.C: la regla de un vehículo registrado sale SOLO de su
    // `accessLevel` (`vehicleAccessRuleFor`); la carrocería (`vehicleType`)
    // no interviene.
    // 1. Vehículo registrado y activo con nivel `residente`
    // 2. Visita vehicular válida y dentro del período:
    //    - entrada: PENDING/READY_FOR_REENTRY → check-in, salvo una
    //      READY_FOR_REENTRY dentro de la espera posterior a la salida
    //      (VISIT_EXIT_COOLDOWN_MINUTES) → Duplicado, sin efectos
    //    - salida: ACTIVE → check-out, salvo dentro de la espera posterior al
    //      ingreso (VISIT_EXIT_COOLDOWN_MINUTES) → Duplicado, sin efectos
    //    - check-in o check-out que pierde la carrera con otra detección →
    //      Duplicado
    //    - cualquier otro estado → Denegado
    // 3. Vehículo activo de `servicio` o sin nivel de acceso, inactivo, o
    //    patente sin vehículo ni visita válida → aprobación del conserje
    // 4. Denegado en cualquier otro caso

    let outcome: AccessOutcome;
    // `true` solo si el `method` del intento sale de la dirección de la pasada
    // (residentes). Las visitas fijan su método por estado + espera.
    let followsDirection = false;

    // 1. Verificar si es un vehículo registrado (scopeado al condominio de la cámara)
    const vehicle = await this.vehiclesService.findByPlate(dto.plate, {
      organizationId: cameraOrganizationId,
    });

    if (vehicle && vehicle.active) {
      const accessRule = vehicleAccessRuleFor(vehicle.accessLevel);
      if (
        accessRule === 'allow' &&
        !(await this.hasActiveOwner(vehicle, cameraOrganizationId))
      ) {
        // Corrección P5 (cyber A1): un vehículo de residente abre solo si su
        // propietario sigue siendo miembro ACTIVO del condominio de la
        // cámara. Sin propietario, propietario deshabilitado o que dejó el
        // condominio -> lo decide el conserje (el portón no abre solo).
        return await pending(
          'Vehículo de residente sin propietario activo en el condominio - requiere aprobación',
        );
      }
      if (accessRule === 'allow') {
        // Vehículo con nivel de acceso de residente y propietario activo
        // Los residentes no tienen estado dentro/fuera: la dirección es solo
        // informativa y sale de la pasada.
        followsDirection = true;
        outcome = {
          decision: 'Permitido',
          reason: 'Vehículo residente registrado y activo',
          residente: vehicle.owner,
          isExit: passage.direction === 'exit',
        };
      } else if (accessRule === 'requires-visit') {
        // Vehículo de visitante, verificar si tiene visita válida
        try {
          // Fix cross-tenant (rama feature/cierre-fases-1-2 — ver docstring
          // grande arriba, sobre `saved`): el worker LPR sin sesión de
          // usuario (ServiceApiKeyGuard, no puebla request.user) no puede
          // resolver el tenant vía TenantContextService, pero SÍ conoce el
          // organizationId de la cámara (resource-derived). Se acota la
          // búsqueda de la visita a ESE condominio en vez de saltarse el
          // scoping (antes `skipTenantScope: true` buscaba en TODOS los
          // condominios — la causa raíz del leak).
          const visitValidation = await this.visitsService.validateAccess(
            dto.plate,
            'plate',
            { organizationId: cameraOrganizationId },
          );

          if (
            visitValidation.valid &&
            visitValidation.visit &&
            !(await this.hasActiveHost(
              visitValidation.visit,
              cameraOrganizationId,
            ))
          ) {
            return await pending(INACTIVE_HOST_REASON);
          }
          if (visitValidation.valid && visitValidation.visit) {
            outcome = await this.applyVisitPassage(
              visitValidation.visit,
              cameraOrganizationId,
            );
          } else {
            outcome = {
              decision: 'Denegado',
              reason: visitValidation.message || 'Visita no válida o expirada',
              residente: null,
              isExit: false,
            };
          }
        } catch (error) {
          this.logger.error(
            `Error al validar visita para vehículo visitante ${maskPlate(dto.plate)}: ${errorMessage(error)}`,
          );
          outcome = {
            decision: 'Denegado',
            reason: 'Error al validar visita',
            residente: null,
            isExit: false,
          };
        }
      } else {
        // D4: un vehículo activo de servicio o SIN nivel de acceso no se
        // permite por defecto (fail-closed): lo decide el conserje.
        return await pending(
          vehicle.accessLevel === VehicleAccessLevel.SERVICE
            ? 'Vehículo de servicio - requiere aprobación'
            : 'Vehículo registrado sin nivel de acceso - requiere aprobación',
        );
      }
    } else if (!vehicle) {
      // No existe el vehículo, verificar si hay una visita programada. Una
      // solicitud del conserje digital sin aprobar (AWAITING_APPROVAL) cae
      // acá: no tiene Vehicle y `validateAccess` no la encuentra → conserje.
      try {
        // Ver comentario equivalente más arriba: mismo fix cross-tenant,
        // scopeado explícitamente al condominio de la cámara.
        const visitValidation = await this.visitsService.validateAccess(
          dto.plate,
          'plate',
          { organizationId: cameraOrganizationId },
        );

        if (
          visitValidation.valid &&
          visitValidation.visit &&
          !(await this.hasActiveHost(
            visitValidation.visit,
            cameraOrganizationId,
          ))
        ) {
          return await pending(INACTIVE_HOST_REASON);
        }
        if (visitValidation.valid && visitValidation.visit) {
          outcome = await this.applyVisitPassage(
            visitValidation.visit,
            cameraOrganizationId,
          );
        } else {
          // No hay visita válida, enviar a aprobación del conserje
          return await pending(
            visitValidation.message ||
              'Vehículo no registrado y sin visita autorizada',
          );
        }
      } catch (error) {
        this.logger.error(
          `Error al validar visita para patente ${maskPlate(dto.plate)}: ${errorMessage(error)}`,
        );
        // En caso de error, enviar a aprobación del conserje
        return await pending('Error al validar - requiere aprobación manual');
      }
    } else {
      // Vehículo existe pero está inactivo, enviar a aprobación del conserje
      return await pending('Vehículo inactivo - requiere aprobación');
    }

    const { decision, reason, residente, isExit } = outcome;

    // Calcular tiempo de respuesta: T2 (ahora) - T1 (detectionTimestamp del LPR o createdAt como fallback)
    // Si el LPR envió detectionTimestamp, usar ese valor para mayor precisión
    // Sino, usar createdAt (timestamp de recepción en backend)
    const t1 = saved.detectionTimestamp || saved.createdAt.getTime();
    const responseTimeMs = Date.now() - t1;

    const att = this.attemptsRepo.create({
      detection: saved,
      decision,
      reason,
      method: followsDirection
        ? methodForDirection(passage.direction, ACCESS_UNKNOWN_METHOD)
        : isExit
          ? 'Patente - Salida'
          : 'Patente - Entrada',
      residente,
      responseTimeMs, // Guardar métrica de tiempo de respuesta
      organizationId: saved.organizationId, // Tarea #19: hereda de la detección
    });

    const result = await this.passages.saveAttempt(att, passage, {
      decidesAccess: true,
      followsDirection,
      unknownMethod: ACCESS_UNKNOWN_METHOD,
    });
    // Solo quien ESCRIBIÓ la decisión notifica y abre el portón.
    if (!result.written) {
      return this.asEvidence(saved, result.attempt, passage);
    }
    const savedAtt = result.attempt;

    // Log de rendimiento si el tiempo supera el umbral de 5 segundos
    if (responseTimeMs > 5000) {
      this.logger.warn(
        `⚠️ Tiempo de respuesta alto: ${responseTimeMs}ms para detección ${saved.id} (${maskPlate(dto.plate)})`,
      );
    }

    // Enviar notificaciones según el tipo de detección. Una lectura duplicada
    // no notifica: el paso original ya avisó al anfitrión y a los conserjes.
    if (decision !== DUPLICATE_ACCESS_DECISION) {
      await this.sendDetectionNotifications(
        dto.plate,
        decision,
        reason,
        isExit,
        residente,
        vehicle,
        saved.organizationId,
      );
    }

    // AUTO-APERTURA INTEGRADADA AL HUB:
    // Si la placa está autorizada, mandamos evento directo a la Raspberry Pi saltándonos a Sofía
    if (decision === 'Permitido') {
      this.logger.log(
        `🚗 Placa autorizada (${maskPlate(dto.plate)}) detectada en la detección ${saved.id}. Enviando comando de apertura al Portón Vehicular...`,
      );
      // Fase 1, Bloque A1.1 (H2): dirigido por el `organizationId` de la
      // detección (`saved.organizationId`, tarea #19), nunca un broadcast
      // global. Fase 4 · P4 (D7): `sendDoorOpen` entrega solo a los hubs
      // FÍSICOS del condominio, nunca a un kiosko web.
      this.hubGateway.sendDoorOpen(
        { hubId: null, organizationId: saved.organizationId },
        {
          type: 'vehicular',
          plate: dto.plate,
        },
      );
    }

    return {
      detection: saved,
      attempt: savedAtt,
      isExit,
      passage: this.passages.summarize(passage),
      deduplicated: false,
    };
  }

  /**
   * Corrección P5 (cyber A1): ¿el propietario del vehículo es miembro ACTIVO
   * (membresía + cuenta no deshabilitada) del condominio de la cámara?
   * Fail-closed: sin propietario, `false`.
   */
  private async hasActiveOwner(
    vehicle: Vehicle,
    organizationId: string,
  ): Promise<boolean> {
    const ownerId = vehicle.ownerId ?? vehicle.owner?.id ?? null;
    if (!ownerId) {
      return false;
    }
    return this.usersService.isActiveMemberOfOrganization(
      ownerId,
      organizationId,
    );
  }

  /**
   * Corrección P5 (cyber A1, rama de visitas): `validateAccess` valida el
   * estado y la ventana de la visita, pero NO que su anfitrión siga activo
   * (solo se validó al crearla). Una visita cuyo anfitrión fue deshabilitado
   * (el join lo excluye: `visit.host` null) o dejó el condominio no abre
   * sola: la decide el conserje.
   */
  private async hasActiveHost(
    visit: Visit,
    organizationId: string,
  ): Promise<boolean> {
    const hostId = visit.host?.id ?? null;
    if (!hostId) {
      return false;
    }
    return this.usersService.isActiveMemberOfOrganization(
      hostId,
      organizationId,
    );
  }

  /**
   * Fase 4 · P3 (D4): decide el paso de una visita YA validada por
   * `validateAccess`, según su estado. "Permitido" solo sale de las dos ramas
   * explícitas, y solo después de que el check-in/check-out se registró (si
   * lanza, el caller lo trata como error: nunca abre):
   *  - entrada: `CHECKIN_FROM` (PENDING, READY_FOR_REENTRY) → `checkIn`;
   *  - salida: ACTIVE → `checkOut`.
   * Cualquier otro estado → "Denegado" (sin `hub:door_open`).
   *
   * "Duplicado" (sin cambio de estado, sin apertura ni alertas):
   *  - ACTIVE dentro de la espera posterior al ingreso: las cámaras no saben
   *    si miran la entrada o la salida, y esa lectura casi siempre es el mismo
   *    auto que todavía está pasando (decisión de Benjamin);
   *  - READY_FOR_REENTRY dentro de la espera posterior a la salida: el caso
   *    simétrico, el mismo auto saliendo no se lee como reingreso;
   *  - el check-in o el check-out pierde la carrera con otra detección que ya
   *    registró ese paso (seguridad B4 / QA N5).
   */
  private async applyVisitPassage(
    visit: Visit,
    organizationId: string,
  ): Promise<AccessOutcome> {
    if (CHECKIN_FROM.includes(visit.status)) {
      if (
        visit.status === VisitStatus.READY_FOR_REENTRY &&
        this.isWithinCooldown(visit.exitTime)
      ) {
        return this.duplicateOutcome(
          visit,
          'Salida ya registrada, dentro del período de espera',
          true,
        );
      }
      try {
        await this.visitsService.checkIn(visit.id, { organizationId });
      } catch (error) {
        if (error instanceof VisitEntryAlreadyRegisteredException) {
          return this.duplicateOutcome(
            visit,
            'Ingreso ya registrado por otra detección',
            false,
          );
        }
        throw error;
      }
      return {
        decision: 'Permitido',
        reason:
          visit.status === VisitStatus.PENDING
            ? `Entrada autorizada - ${visit.visitorName}`
            : `Reingreso autorizado - ${visit.visitorName}`,
        residente: visit.host ?? null,
        isExit: false,
      };
    }

    if (visit.status === VisitStatus.ACTIVE) {
      if (this.isWithinCooldown(visit.entryTime)) {
        return this.duplicateOutcome(
          visit,
          'Ingreso ya registrado, dentro del período de espera',
          false,
        );
      }
      try {
        await this.visitsService.checkOut(visit.id, { organizationId });
      } catch (error) {
        if (error instanceof VisitExitAlreadyRegisteredException) {
          return this.duplicateOutcome(
            visit,
            'Salida ya registrada por otra detección',
            true,
          );
        }
        throw error;
      }
      return {
        decision: 'Permitido',
        reason: `Salida registrada - ${visit.visitorName}`,
        residente: visit.host ?? null,
        isExit: true,
      };
    }

    return {
      decision: 'Denegado',
      reason: `Visita ${describeVisitStatus(visit.status)} - ${visit.visitorName}`,
      residente: visit.host ?? null,
      isExit: false,
    };
  }

  /**
   * `true` si `since` (el ingreso o la salida de la visita) fue hace menos de
   * `VISIT_EXIT_COOLDOWN_MINUTES`; en el borde exacto ya no hay espera. Sin
   * marca (`null`, solo datos previos a P3: `checkIn`/`checkOut` siempre la
   * escriben) no hay paso reciente que proteger.
   */
  private isWithinCooldown(since: Date | null): boolean {
    if (!since) {
      return false;
    }
    return Date.now() - since.getTime() < this.exitCooldownMs;
  }

  /** `isExit`: la lectura repite una salida (no una entrada). */
  private duplicateOutcome(
    visit: Visit,
    reason: string,
    isExit: boolean,
  ): AccessOutcome {
    return {
      decision: DUPLICATE_ACCESS_DECISION,
      reason: `${reason} - ${visit.visitorName}`,
      residente: visit.host ?? null,
      isExit,
    };
  }

  /**
   * Patentes (en mayúsculas) de los vehículos de la familia de un actor
   * acotado a su familia (Fase 4 · P5.C), con la fecha desde la que la
   * familia puede ver su historial: el registro del vehículo (corrección P5,
   * cyber M3). Sin familia, ninguna: un residente sin familia no ve
   * detecciones. Si la familia registró dos veces la misma patente, cuenta la
   * fecha más antigua.
   */
  private async familyPlates(
    scope: FamilyScope,
  ): Promise<Array<{ plate: string; since: Date }>> {
    if (!scope.familyId) {
      return [];
    }
    const members = await this.usersService.findByFamily(scope.familyId);
    const ownerIds = members.map((member) => member.id);
    if (ownerIds.length === 0) {
      return [];
    }
    const vehicles = await this.vehiclesService.findByOwnerIds(ownerIds);
    const sinceByPlate = new Map<string, Date>();
    for (const vehicle of vehicles) {
      const plate = vehicle.plate.toUpperCase();
      const since = vehicle.createdAt;
      const current = sinceByPlate.get(plate);
      if (!current || since < current) {
        sinceByPlate.set(plate, since);
      }
    }
    return [...sinceByPlate].map(([plate, since]) => ({ plate, since }));
  }

  /**
   * Restringe `query` a las detecciones de las patentes de la familia del
   * actor (`detection.plate`), y solo las POSTERIORES al registro de cada
   * vehículo (`detection.createdAt`, corrección P5 · cyber M3): registrar la
   * patente de un tercero no revela su historial anterior en el condominio.
   * `false` si no hay patentes: el caller responde vacío.
   */
  private async restrictToFamilyPlates<T extends object>(
    query: SelectQueryBuilder<T>,
    scope: FamilyScope | null,
  ): Promise<boolean> {
    if (!scope) {
      return true;
    }
    const plates = await this.familyPlates(scope);
    if (plates.length === 0) {
      return false;
    }
    const conditions: string[] = [];
    const parameters: Record<string, string | Date> = {};
    plates.forEach(({ plate, since }, index) => {
      conditions.push(
        `(UPPER(detection.plate) = :familyPlate${index} AND detection.createdAt >= :familyPlateSince${index})`,
      );
      parameters[`familyPlate${index}`] = plate;
      parameters[`familyPlateSince${index}`] = since;
    });
    query.andWhere(`(${conditions.join(' OR ')})`, parameters);
    return true;
  }

  /**
   * Detecciones del condominio del actor (Fase 4 · P5.B, D12: `tenantScope`
   * lo pasa el controller; super-admin: todas).
   *
   * Fase 4 · P5.C: con `familyScope` (actor sin `condominium.view-all`),
   * solo las de las patentes de los vehículos de su familia; sin familia,
   * vacío. El filtro se SUMA al de tenant. Reemplaza al
   * `UserFilterInterceptor` (por nombre de rol, y sin filtro para un no-admin
   * sin familia).
   */
  async listDetections(
    tenantScope: TenantContext,
    familyScope: FamilyScope | null,
    limit = 50,
  ) {
    const query = this.detectionsRepo
      .createQueryBuilder('detection')
      .leftJoinAndSelect('detection.accessAttempts', 'attempts')
      .orderBy('detection.createdAt', 'DESC')
      .take(limit);

    applyTenantFilter(query, 'detection', tenantScope);

    if (!(await this.restrictToFamilyPlates(query, familyScope))) {
      return [];
    }

    return query.getMany();
  }

  /**
   * Hallazgo A2: la detección debe ser del condominio de la API key. Una
   * detección de otro condominio responde igual que una inexistente (404).
   */
  async createAttempt(dto: CreateAccessAttemptDto, keyOrganizationId: string) {
    const det = await this.detectionsRepo.findOne({
      where: { id: dto.detectionId, organizationId: keyOrganizationId },
    });
    if (!det) throw new NotFoundException('detection not found');

    // Calcular tiempo de respuesta usando detectionTimestamp si está disponible
    const t1 = det.detectionTimestamp || det.createdAt.getTime();
    const responseTimeMs = Date.now() - t1;

    const att = this.attemptsRepo.create({
      detection: det,
      decision: dto.decision,
      reason: dto.reason ?? null,
      method: dto.method ?? null,
      responseTimeMs,
      organizationId: det.organizationId, // Tarea #19: hereda de la detección
    });
    if (dto.residenteId) {
      // Referencia por id: TypeORM solo necesita la clave foránea.
      att.residente = { id: dto.residenteId } as User;
    }
    return this.attemptsRepo.save(att);
  }

  /**
   * Intentos de acceso del condominio de `tenantScope` (super-admin: todos).
   *
   * Fase 4 · P5.B (D12): `tenantScope` pasa a ser OBLIGATORIO. Antes era
   * opcional y `DetectionsController` llamaba sin él (sin filtro: intentos de
   * todos los condominios). Lo pasan el controller (contexto del actor) y la
   * tool `consultar_accesos_recientes` (su `AuthorizedContext`).
   *
   * Fase 4 · P5.C: con `familyScope` (actor sin `condominium.view-all`, que
   * pasa el controller), solo los intentos de las patentes de su familia,
   * igual que `listDetections`. La tool no lo pasa: exige
   * `digital-concierge.manage` y ve todo el condominio.
   */
  async listAttempts(
    limit: number,
    tenantScope: TenantContext,
    familyScope: FamilyScope | null = null,
    options: { withPassages?: boolean } = {},
  ) {
    const query = this.attemptsRepo
      .createQueryBuilder('attempt')
      .leftJoinAndSelect('attempt.detection', 'detection')
      .leftJoinAndSelect('attempt.residente', 'residente')
      .leftJoinAndSelect('residente.family', 'family')
      .orderBy('attempt.createdAt', 'DESC')
      .take(limit);

    applyTenantFilter(query, 'attempt', tenantScope);

    if (!(await this.restrictToFamilyPlates(query, familyScope))) {
      return [];
    }

    const attempts = await query.getMany();
    // Sin pasadas (p. ej. la tool del agente, que solo lee la decisión): se
    // evitan las dos consultas extra y `passage` va en `null`.
    if (options.withPassages === false) {
      return attempts.map((attempt) => ({ ...attempt, passage: null }));
    }
    // Cada intento expone su pasada (dirección, fuente y últimas lecturas de
    // todas las cámaras); `passage: null` si es anterior a las pasadas.
    return this.passages.attachPassages(attempts);
  }

  /**
   * Enviar notificaciones de detección según el tipo de vehículo
   * - Si es un vehículo de visita: notificar a la familia y al conserje
   * - Cualquier otra detección: notificar solo al conserje
   *
   * Fix cross-tenant (mismo leak que `createPendingDetectionForConcierge`,
   * cerrado en el mismo follow-up): notificar a los conserjes vía
   * `notifyByRoleForOrganization` (filtra por la tabla `member`) en vez de
   * `notifyByRole`, que ignora la organización y llegaba a los conserjes de
   * TODOS los condominios en CADA detección de patente (no solo las
   * pendientes). El aviso directo al host (`notificationsService.create` más
   * abajo) no necesita este scoping: va a un `recipientId` puntual ya
   * resuelto (el residente/host de la visita), no es un broadcast por rol.
   */
  private async sendDetectionNotifications(
    plate: string,
    decision: string,
    reason: string,
    isExit: boolean,
    residente: User | null,
    vehicle: Vehicle | null,
    organizationId: string | null,
  ) {
    try {
      const action = isExit ? 'salida' : 'entrada';
      const actionCapitalized = isExit ? 'Salida' : 'Entrada';

      // Determinar el tipo de notificación según la decisión
      const notificationType =
        decision === 'Permitido'
          ? NotificationType.VEHICLE_DETECTED
          : NotificationType.UNKNOWN_VEHICLE;

      // Prioridad alta para accesos denegados, normal para permitidos
      const priority =
        decision === 'Permitido'
          ? NotificationPriority.NORMAL
          : NotificationPriority.HIGH;

      // Si el vehículo es de visitante y hay un residente (host) asociado
      // (P5.C: por su nivel de acceso; la carrocería no dice si es de visita)
      if (vehicle?.accessLevel === VehicleAccessLevel.VISITOR && residente) {
        // Notificar solo al host (creador de la visita) — recipientId puntual,
        // no un broadcast por rol, no requiere scoping por organización.
        await this.notificationsService.create({
          recipientId: residente.id,
          type: notificationType,
          title: `${actionCapitalized} de Visita Detectada`,
          message: `Se detectó la ${action} del vehículo de visita con patente ${plate}. ${reason}`,
          priority,
          data: {
            plate,
            decision,
            reason,
            isExit,
            detectionType: 'visit',
          },
        });

        this.logger.log(
          `Notificación de visita enviada al host para patente ${maskPlate(plate)}`,
        );
      }

      // Notificar a los conserjes del MISMO condominio que la detección.
      // Fail-closed en cámaras legacy sin organización asignada
      // (organizationId === null, pre-tarea #19): en vez de dejar que
      // `notifyByRoleForOrganization` compare "null === null" (que en teoría
      // podría calzar con un conserje sin membresía registrada), se opta
      // explícitamente por NO notificar a nadie — preferible a arriesgar un
      // broadcast o un match accidental cross-tenant.
      if (organizationId === null) {
        this.logger.warn(
          `Detección de patente ${maskPlate(plate)} sin organizationId (cámara legacy) — no se notifica a conserjes (fail-closed)`,
        );
      } else {
        await this.notificationsService.notifyByRoleForOrganization(
          'Conserje',
          organizationId,
          notificationType,
          `Detección de Vehículo - ${actionCapitalized}`,
          `Se detectó la ${action} del vehículo con patente ${plate}. Decisión: ${decision}. ${reason}`,
          { priority },
        );

        this.logger.log(
          `Notificación enviada a conserjes para detección ${maskPlate(plate)}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error al enviar notificaciones de detección: ${errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      // No lanzar el error para no interrumpir el flujo de detección
    }
  }

  /**
   * Crear una detección pendiente que requiere aprobación del conserje
   */
  private async createPendingDetectionForConcierge(
    detection: PlateDetection,
    reason: string,
    passage: VehiclePassage,
  ) {
    // Fase 4 · P7.L: sin `reason` (puede traer el nombre del visitante) y con
    // la patente parcial.
    this.logger.log(
      `🔔 Creando detección pendiente para la detección ${detection.id} (patente ${maskPlate(detection.plate)})`,
    );

    // Calcular tiempo de respuesta: tiempo desde detección hasta envío de notificación al conserje
    const t1 = detection.detectionTimestamp || detection.createdAt.getTime();
    const responseTimeMs = Date.now() - t1;

    // Crear AccessAttempt con decisión "Pendiente" (expira en 5 minutos)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    const attempt = this.attemptsRepo.create({
      detection,
      decision: 'Pendiente',
      reason,
      method: 'Patente - Requiere Aprobación',
      residente: null,
      expiresAt,
      respondedBy: null,
      respondedAt: null,
      responseTimeMs, // Tiempo hasta notificación al conserje
      organizationId: detection.organizationId, // Tarea #19: hereda de la detección
    });

    // El `method` de un pendiente no depende de la dirección.
    const result = await this.passages.saveAttempt(attempt, passage, {
      decidesAccess: true,
      followsDirection: false,
      unknownMethod: 'Patente - Requiere Aprobación',
    });
    if (!result.written) {
      return this.asEvidence(detection, result.attempt, passage);
    }
    const savedAttempt = result.attempt;

    // Log de rendimiento si el tiempo supera el umbral de 5 segundos
    if (responseTimeMs > 5000) {
      this.logger.warn(
        `⚠️ Tiempo de respuesta alto para notificación pendiente: ${responseTimeMs}ms para detección ${detection.id} (${maskPlate(detection.plate)})`,
      );
    }

    // Fix cross-tenant (follow-up post-auditoría Fase 0/1): notificar SOLO a
    // los conserjes del condominio de la detección (vía `notifyByRoleForOrganization`,
    // que filtra por la tabla `member`) — antes se usaba `notifyByRole`, que
    // notifica a TODOS los conserjes de la plataforma sin importar su
    // organización, filtrando conserjes de otros condominios con la
    // detección pendiente de otro.
    const notifications =
      await this.notificationsService.notifyByRoleForOrganization(
        'Conserje',
        detection.organizationId,
        NotificationType.UNKNOWN_VEHICLE,
        'Vehículo No Reconocido - Requiere Aprobación',
        `Se detectó el vehículo con patente ${detection.plate}. ${reason}. Por favor, revisa y toma una decisión.`,
        {
          priority: NotificationPriority.HIGH,
          data: {
            attemptId: savedAttempt.id,
            detectionId: detection.id,
            plate: detection.plate,
            reason,
            expiresAt: expiresAt.toISOString(),
            fullFramePath: detection.full_frame_path,
            requiresAction: true,
          },
        },
      );

    // Guardar el ID de la notificación (tomamos la primera ya que notifyByRole devuelve array)
    if (notifications && notifications.length > 0) {
      savedAttempt.notificationId = notifications[0].id;
      await this.attemptsRepo.save(savedAttempt);
    }

    this.logger.log(`✅ Detección pendiente creada con ID ${savedAttempt.id}`);

    return {
      detection,
      attempt: savedAttempt,
      requiresApproval: true,
      passage: this.passages.summarize(passage),
      deduplicated: false,
    };
  }

  /**
   * Responder a una detección pendiente (aprobar o rechazar).
   *
   * Fase 4 · P5.B: el intento debe ser del condominio del actor
   * (`tenantScope`, super-admin: cualquiera); uno de otro condominio responde
   * 404, igual que uno inexistente. `responder` es el usuario de la sesión
   * (lo pasa el controller): `respondedBy` se guarda y se devuelve solo con
   * `id` y `name`.
   *
   * Fase 4 · P5.C: claim ATÓMICO. La respuesta se escribe con un único
   * `UPDATE … WHERE id AND decision = 'Pendiente' AND no vencido AND
   * condominio`: si dos conserjes responden a la vez, solo uno afecta la fila
   * y el otro recibe 409 (antes ambos leían "Pendiente" y el segundo
   * sobrescribía la decisión del primero). Uno vencido responde 400 y queda
   * `Expirado`.
   */
  async respondToPendingDetection(
    attemptId: string,
    responder: PendingDetectionResponder,
    dto: RespondPendingDetectionDto,
    tenantScope: TenantContext,
  ) {
    const scopedWhere = scopeWhere({ id: attemptId }, tenantScope);
    const attempt = await this.attemptsRepo.findOne({
      where: scopedWhere,
      relations: ['detection'],
    });

    if (!attempt) {
      throw new NotFoundException('Intento de acceso no encontrado');
    }

    if (attempt.decision !== 'Pendiente') {
      throw this.alreadyProcessed(attempt.decision);
    }

    const decision = dto.decision === 'approved' ? 'Permitido' : 'Denegado';
    const finalReason =
      dto.response ||
      (dto.decision === 'approved'
        ? 'Aprobado manualmente por conserje'
        : 'Rechazado manualmente por conserje');
    const respondedAt = new Date();

    const claimed = await this.claimPendingAttempt(
      attempt,
      tenantScope,
      {
        decision,
        reason: `${attempt.reason} - ${finalReason}`,
        method: 'Manual - Conserje',
        respondedBy: { id: responder.id },
        respondedAt,
      },
      respondedAt,
    );
    if (!claimed) {
      await this.rejectLostClaim(attempt, tenantScope, respondedAt);
    }

    // Usuario que responde (conserje): solo id (FK) y nombre.
    attempt.decision = decision;
    attempt.reason = `${attempt.reason} - ${finalReason}`;
    attempt.method = 'Manual - Conserje';
    attempt.respondedBy = { id: responder.id, name: responder.name } as User;
    attempt.respondedAt = respondedAt;

    this.logger.log(
      `✅ Detección ${attemptId} ${dto.decision === 'approved' ? 'aprobada' : 'rechazada'} por el usuario ${responder.id}`,
    );

    return {
      attempt,
      decision: dto.decision,
    };
  }

  /** 409: el intento ya tiene una decisión (otra respuesta ganó el claim). */
  private alreadyProcessed(decision: string): ConflictException {
    return new ConflictException(
      `Este intento ya fue procesado con decisión: ${decision}`,
    );
  }

  /**
   * `UPDATE` condicional del claim: solo si sigue `Pendiente`, no venció y es
   * del condominio del actor. `true` si esta respuesta ganó.
   */
  private async claimPendingAttempt(
    attempt: AccessAttempt,
    tenantScope: TenantContext,
    patch: Pick<
      AccessAttempt,
      'decision' | 'reason' | 'method' | 'respondedAt'
    > & {
      respondedBy: { id: string };
    },
    now: Date,
  ): Promise<boolean> {
    const query = this.attemptsRepo
      .createQueryBuilder()
      .update(AccessAttempt)
      .set(patch)
      .where('id = :attemptId', { attemptId: attempt.id })
      .andWhere('decision = :pending', { pending: 'Pendiente' })
      .andWhere('("expiresAt" IS NULL OR "expiresAt" >= :now)', { now });
    if (!tenantScope.isSuperAdmin) {
      query.andWhere('"organizationId" = :claimOrgId', {
        claimOrgId: attempt.organizationId,
      });
    }
    const result = await query.execute();
    return Boolean(result.affected);
  }

  /**
   * El claim no afectó la fila: lee el estado real y responde. Otra respuesta
   * ganó → 409; venció → se marca `Expirado` (condicionado a que siga
   * `Pendiente`) y 400; desapareció → 404.
   */
  private async rejectLostClaim(
    attempt: AccessAttempt,
    tenantScope: TenantContext,
    now: Date,
  ): Promise<never> {
    const current = await this.attemptsRepo.findOne({
      where: scopeWhere({ id: attempt.id }, tenantScope),
    });
    if (!current) {
      throw new NotFoundException('Intento de acceso no encontrado');
    }
    if (current.decision !== 'Pendiente') {
      throw this.alreadyProcessed(current.decision);
    }
    if (current.expiresAt && now > current.expiresAt) {
      await this.attemptsRepo.update(
        { id: current.id, decision: 'Pendiente' },
        { decision: 'Expirado', reason: 'Tiempo de decisión expirado' },
      );
      throw new BadRequestException('Esta detección ha expirado');
    }
    throw new ConflictException(
      'La detección cambió mientras se respondía; vuelve a intentarlo',
    );
  }

  /**
   * Listar detecciones pendientes del condominio del actor (super-admin:
   * todas).
   *
   * Fase 4 · P5.B: el listado se acota con `tenantScope` y `respondedBy` sale
   * solo con `id` y `name` (antes era el `User` completo). El UPDATE previo
   * que marca las vencidas como `Expirado` sigue GLOBAL a propósito: es
   * mantenimiento idempotente (solo toca filas `Pendiente` con `expiresAt`
   * pasado, sin devolver nada) y da igual qué condominio lo dispare.
   */
  async listPendingDetections(tenantScope: TenantContext) {
    const now = new Date();

    // Primero marcar las expiradas (global, ver docstring)
    await this.attemptsRepo
      .createQueryBuilder()
      .update(AccessAttempt)
      .set({
        decision: 'Expirado',
        reason: 'Tiempo de decisión expirado',
      })
      .where('decision = :decision', { decision: 'Pendiente' })
      .andWhere('expiresAt < :now', { now })
      .execute();

    // Luego obtener las que siguen pendientes, del condominio del actor
    const query = this.attemptsRepo
      .createQueryBuilder('attempt')
      .leftJoinAndSelect('attempt.detection', 'detection')
      .leftJoin('attempt.respondedBy', 'respondedBy')
      .addSelect(['respondedBy.id', 'respondedBy.name'])
      .where('attempt.decision = :pending', { pending: 'Pendiente' })
      .orderBy('attempt.createdAt', 'DESC');

    applyTenantFilter(query, 'attempt', tenantScope);

    return query.getMany();
  }

  /**
   * Verificar estado de una detección pendiente.
   *
   * Fase 4 · P5.B: acotado al condominio del actor; uno de otro condominio
   * responde igual que uno inexistente.
   */
  async checkPendingDetectionStatus(
    attemptId: string,
    tenantScope: TenantContext,
  ) {
    const attempt = await this.attemptsRepo.findOne({
      where: scopeWhere({ id: attemptId }, tenantScope),
    });

    if (!attempt) {
      return { active: false, reason: 'Intento de acceso no encontrado' };
    }

    if (attempt.decision !== 'Pendiente') {
      return {
        active: false,
        reason: `Intento ya procesado: ${attempt.decision}`,
      };
    }

    if (attempt.expiresAt && new Date() > attempt.expiresAt) {
      // Marcar como expirado
      attempt.decision = 'Expirado';
      attempt.reason = 'Tiempo de decisión expirado';
      await this.attemptsRepo.save(attempt);
      return { active: false, reason: 'Detección expirada' };
    }

    return { active: true };
  }
}
