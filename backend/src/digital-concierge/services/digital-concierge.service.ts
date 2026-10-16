import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Equal, IsNull, Or, Repository } from 'typeorm';
import {
  ConciergeSession,
  SessionStatus,
} from '../entities/concierge-session.entity';
import { RealtimeVoiceTokenService } from './realtime-voice-token.service';
import { UsersService } from '../../users/users.service';
import { FamiliesService } from '../../families/families.service';
import {
  VisitsService,
  type ResolveRequestOptions,
  type TenantScopeOptions,
} from '../../visits/visits.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  NotificationPriority,
  NotificationType,
  type Notification,
} from '../../notifications/entities/notification.entity';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import {
  VisitType,
  VisitStatus,
  type Visit,
} from '../../visits/entities/visit.entity';
import { VisitEntryAlreadyRegisteredException } from '../../visits/visit-entry-already-registered.exception';
import { randomBytes } from 'crypto';
import { SmsService } from '../../common/services/sms.service';
import { errorMessage } from '../../common/utils/error-message.util';
import { QRCodeService } from '../../common/services/qrcode.service';
import { HubGateway } from '../../hub/hub.gateway';
import {
  CONCIERGE_MANAGE_PERMISSION,
  type ConciergeActor,
  type DeviceConciergeActor,
  type HumanConciergeActor,
} from '../concierge-actor';
import { User } from '../../users/entities/user.entity';
import {
  buildHouseContext,
  EMPTY_HOUSE_CONTEXT,
  type HouseContext,
} from '../house-context';
import type { TenantScope } from '../../common/tenant/tenant-context.types';
import { parseVisitConciergeValidityHours } from '../../config/env.validation';
import {
  formatRut,
  isValidChileanPhone,
  isValidChileanPlate,
  isValidPassport,
  isValidRut,
  looksLikeRut,
  normalizeChileanPhone,
  normalizeChileanPlate,
} from '../../common/utils/chilean-format.util';
import { isInTenantScope } from '../../common/tenant/tenant-context.util';

/**
 * Origen de una sesión, resuelto por el controller a partir de
 * `ConciergeAuthGuard` (Fase 1, Bloque A1) ANTES de llegar acá — este
 * servicio no conoce headers ni request, solo recibe el resultado ya
 * resuelto (hub autenticado, o sesión humana vía tenantContext).
 */
export interface ConciergeSessionOrigin {
  hubId: string | null;
  source: 'web' | 'hub';
  organizationId: string | null;
}

/**
 * Datos parciales del visitante que `guardar_datos_visitante` (Fase 1,
 * Bloque A2b) va acumulando de a uno en la `ConciergeSession` — el modelo
 * llama esta tool repetidamente con un campo a la vez (ver
 * `agent/prompts/sofia.prompt.ts`).
 */
export interface SaveVisitorDataInput {
  nombre?: string;
  rut?: string;
  telefono?: string;
  patente?: string;
  motivo?: string;
  casa?: string;
}

/** Campos de `SaveVisitorDataInput` que pasan por validación/normalización de dominio. */
export type SaveVisitorDataField = 'rut' | 'telefono' | 'patente';

/** Columnas de la sesión que puede escribir `saveVisitorData`. */
type VisitorDataPatch = Partial<
  Pick<
    ConciergeSession,
    | 'visitorName'
    | 'visitorRut'
    | 'visitorPhone'
    | 'vehiclePlate'
    | 'visitReason'
    | 'destinationHouse'
  >
>;

/**
 * Resultado de `saveVisitorData` (cierre de brecha Fase 1 → Fase 2: revive en
 * el backend la validación/formateo que el frontend hacía antes de
 * adelgazarse — ver `common/utils/chilean-format.util.ts`).
 *
 * Extiende (no rompe) la forma anterior `{ message, saved }`: agrega `ok` y,
 * cuando `ok` es `false`, `campo`/`mensaje` para que la tool se lo devuelva
 * al modelo (Sofía) y este le pida al visitante que repita el dato en vez de
 * fallar duro (ver `agent/prompts/sofia.prompt.ts`).
 */
export interface SaveVisitorDataResult {
  message: string;
  saved: {
    nombre: string | null;
    rut: string | null;
    telefono: string | null;
    patente: string | null;
    motivo: string | null;
    casa: string | null;
  };
  ok: boolean;
  campo?: SaveVisitorDataField;
  mensaje?: string;
}

/**
 * Re-exportado para no romper a los consumidores que ya importaban
 * `TenantScope` desde este módulo (p.ej. specs de tools) — limpieza post-
 * auditoría (dedup DUP3): la interface ahora vive en
 * `common/tenant/tenant-context.types.ts`, compartida con
 * `PendingActionsService`, en vez de declararse localmente acá.
 */
export type { TenantScope };

/**
 * Resultado de `respondToVisitor`. `entryRegistered` es el acceso EFECTIVO
 * (Fase 4 · P4): `true` solo si esta respuesta registró el ingreso (check-in)
 * Y un hub físico recibió la orden de apertura (`hub:door_open`). En
 * cualquier otro caso (rechazo, check-in fallido, ingreso ya registrado por
 * otra vía, sin hub físico) es `false`.
 */
export interface RespondToVisitorResult {
  success: boolean;
  message: string;
  entryRegistered: boolean;
}

/** Respuesta a una solicitud de visita, ya validada (`RespondToVisitorDto`). */
export interface RespondToVisitorInput {
  approved: boolean;
  /** La solicitud que vio quien responde: debe ser la vigente de la sesión. */
  visitId: string;
}

/** Valor de `ConciergeSession.residentResponse`. */
export type ResidentResponse = 'approved' | 'denied' | 'pending' | null;

/**
 * Resultado de `getSessionStatus` (`POST /concierge/session/:id/status`, Fase
 * 4 · P4): respaldo por polling del kiosko. Sin QR ni datos del visitante.
 */
export interface SessionStatusResult {
  active: boolean;
  reason?: string;
  visitId: string | null;
  residentResponse: ResidentResponse;
  /** `true`/`false` solo con respuesta aprobada; `null` en otro caso. */
  entryRegistered: boolean | null;
}

/** Actividad de una sesión (vigente y sin respuesta). */
interface SessionActivity {
  active: boolean;
  reason?: string;
}

/** Cómo terminó el check-in de una visita recién aprobada. */
type ApprovedEntryOutcome = 'registered' | 'already_registered' | 'failed';

/** Alerta a los conserjes por una visita aprobada que no se pudo completar. */
interface ConserjeAlert {
  title: string;
  message: string;
}

const ENTRY_NOT_REGISTERED_ALERT: ConserjeAlert = {
  title: 'Visita aprobada sin ingreso registrado',
  message:
    'El residente aprobó la visita, pero no se pudo registrar el ingreso ni abrir el acceso. Verifica al visitante, abre manualmente y registra la entrada.',
};

const DOOR_NOT_ORDERED_ALERT: ConserjeAlert = {
  title: 'Visita aprobada sin apertura automática',
  message:
    'El residente aprobó la visita y el ingreso quedó registrado, pero ningún hub físico del condominio recibió la orden de apertura. Abre el acceso manualmente.',
};

const ENTRY_ALREADY_REGISTERED_ALERT: ConserjeAlert = {
  title: 'Visita aprobada con ingreso ya registrado',
  message:
    'El residente aprobó la visita, pero su ingreso ya estaba registrado por otra vía (p. ej. el LPR o un registro manual) y no se ordenó la apertura. Verifica al visitante en portería.',
};

/** Mensaje para el agente cuando ya hay una solicitud esperando al residente. */
export const REQUEST_ALREADY_AWAITING_MESSAGE =
  'Ya hay una solicitud en espera; usa reenviar_notificacion';

/**
 * Notificación de "visitante en portería" de ESTA sesión que todavía espera
 * respuesta del residente. `Notification.data` es jsonb sin tipo: se lee como
 * `unknown` y se valida antes de comparar.
 */
function findPendingSessionNotification(
  notifications: readonly Notification[],
  sessionId: string,
): Notification | undefined {
  return notifications.find((notification) => {
    const data: unknown = notification.data;
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { sessionId?: unknown }).sessionId === sessionId &&
      notification.requiresAction &&
      !notification.actionTaken
    );
  });
}

@Injectable()
export class DigitalConciergeService {
  private readonly logger = new Logger(DigitalConciergeService.name);
  /** Validez de la visita que crea el conserje (ms, VISIT_CONCIERGE_VALIDITY_HOURS). */
  private readonly requestValidityMs: number;

  constructor(
    @InjectRepository(ConciergeSession)
    private readonly sessionRepository: Repository<ConciergeSession>,
    private readonly tokenService: RealtimeVoiceTokenService,
    private readonly usersService: UsersService,
    private readonly familiesService: FamiliesService,
    private readonly visitsService: VisitsService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly hubGateway: HubGateway, // Para comunicarse con la Raspberry Pi
    private readonly smsService: SmsService,
    private readonly qrcodeService: QRCodeService,
    configService: ConfigService,
  ) {
    this.requestValidityMs =
      parseVisitConciergeValidityHours(
        configService.get<string>('VISIT_CONCIERGE_VALIDITY_HOURS'),
      ) *
      60 *
      60 *
      1000;
  }

  /**
   * Inicia una nueva sesión del conserje digital
   *
   * Fase 1, Bloque A1: `origin` estampa el tenant (`organizationId`) y, si
   * aplica, el hub físico que originó la sesión — resuelto por el
   * controller a partir de `ConciergeAuthGuard`. Con `organizationId`
   * poblado, `executeTool` → `buscar_residente`/`notificar_residente` quedan
   * automáticamente scopeados por condominio (vía `TenantContextService`,
   * que lee `request.tenantContext` — mismo request, sin lógica adicional acá).
   */
  async startSession(
    socketId: string | undefined,
    origin: ConciergeSessionOrigin,
  ) {
    this.logger.log('Starting new concierge session...');
    if (socketId) {
      this.logger.log(`Socket ID del visitante: ${socketId}`);
    }
    if (!origin.organizationId) {
      this.logger.warn(
        `Sesión iniciada sin organizationId resuelto (source=${origin.source}, hubId=${origin.hubId ?? 'n/a'}) — quedará en el "cajón nulo".`,
      );
    }

    // Generar token efímero de OpenAI
    const { token, expiresAt } =
      await this.tokenService.generateEphemeralToken();

    // Crear sesión en BD
    const sessionId = randomBytes(16).toString('hex');
    const session = this.sessionRepository.create({
      sessionId,
      status: SessionStatus.ACTIVE,
      startTime: new Date(),
      transcript: [],
      functionCalls: [],
      visitorSocketId: socketId || null,
      hubId: origin.hubId,
      source: origin.source,
      organizationId: origin.organizationId,
    });

    await this.sessionRepository.save(session);

    this.logger.log(
      `Session created: ${sessionId} (source=${origin.source}, organizationId=${origin.organizationId ?? 'null'})`,
    );

    return {
      sessionId,
      ephemeralToken: token,
      expiresAt,
    };
  }

  /**
   * Finaliza la sesión.
   *
   * Fase 4 · P4 (B6): escribe SOLO `status` y `endTime` (`update`, no un
   * `save()` de la sesión completa), así un cierre no pisa la respuesta
   * (`residentResponse`/`entryRegistered`) que `respondToVisitor` guardó en
   * el medio.
   */
  async endSession(sessionId: string, finalStatus?: SessionStatus) {
    this.logger.log(`Ending session: ${sessionId}`);

    const session = await this.findSessionById(sessionId);

    session.status = finalStatus || SessionStatus.COMPLETED;
    session.endTime = new Date();

    await this.sessionRepository.update(
      { id: session.id },
      { status: session.status, endTime: session.endTime },
    );

    // QA B4: la solicitud que sigue esperando al residente expira con la
    // sesión (antes quedaba AWAITING_APPROVAL hasta el TTL del cron).
    await this.expireAwaitingRequest(session, 'fin de la sesión');

    // Si la sesión termina sin que los residentes hayan respondido, marcar las notificaciones como expiradas
    if (
      session.residentsNotified &&
      session.residentsNotified.length > 0 &&
      session.residentResponse === 'pending'
    ) {
      this.logger.log(
        `Sesión terminada sin respuesta de los residentes. Marcando notificaciones como expiradas...`,
      );

      try {
        // Marcar notificaciones de TODOS los residentes
        for (const resident of session.residentsNotified) {
          const notifications = await this.notificationsService.findAll(
            {
              read: false,
            },
            resident.id,
          );

          const relevantNotification = findPendingSessionNotification(
            notifications.notifications,
            sessionId,
          );

          if (relevantNotification) {
            await this.notificationsService.markVisitorActionTaken(
              relevantNotification.id,
              false, // No aprobada (sesión terminada sin respuesta)
              'session_ended', // Razón adicional
            );
            this.logger.log(
              `✅ Notificación ${relevantNotification.id} marcada como expirada para el residente ${resident.id}`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `⚠️ No se pudo marcar las notificaciones como expiradas: ${errorMessage(error)}`,
        );
        // No es crítico, continuar
      }
    }

    const duration = Math.floor(
      (session.endTime.getTime() - session.startTime.getTime()) / 1000,
    );

    return {
      sessionId,
      status: session.status,
      duration,
      visitCreated: !!session.createdVisit,
    };
  }

  /**
   * Actividad de una sesión ya cargada (vigente y sin respuesta). Si pasó el timeout (15 min), la marca
   * `TIMEOUT` y expira su solicitud sin respuesta: llamarla solo después de
   * autorizar a quien pregunta.
   */
  private async evaluateSessionActivity(
    session: ConciergeSession,
  ): Promise<SessionActivity> {
    const sessionId = session.sessionId;
    try {
      // Verificar estado de la sesión
      if (session.status !== SessionStatus.ACTIVE) {
        return {
          active: false,
          reason: `La sesión ya no está activa (estado: ${session.status})`,
        };
      }

      // Verificar si ya se respondió
      if (session.residentResponse && session.residentResponse !== 'pending') {
        return {
          active: false,
          reason: `Ya se respondió a esta solicitud (respuesta: ${session.residentResponse})`,
        };
      }

      // Verificar timeout (15 minutos)
      const sessionAge = Date.now() - session.startTime.getTime();
      const maxAge = 15 * 60 * 1000; // 15 minutos

      if (sessionAge > maxAge) {
        // Marcar sesión como expirada. Fase 4 · P4 (B6): solo la columna
        // `status` y solo si sigue ACTIVE (no pisa un cierre ni una respuesta
        // concurrentes, como haría un `save()` de la sesión completa).
        session.status = SessionStatus.TIMEOUT;
        await this.sessionRepository.update(
          { id: session.id, status: SessionStatus.ACTIVE },
          { status: SessionStatus.TIMEOUT },
        );

        // QA B4: la solicitud sin respuesta expira con la sesión.
        await this.expireAwaitingRequest(session, 'timeout de la sesión');

        // Si los residentes no respondieron, marcar las notificaciones como expiradas
        if (
          session.residentsNotified &&
          session.residentsNotified.length > 0 &&
          session.residentResponse === 'pending'
        ) {
          try {
            for (const resident of session.residentsNotified) {
              const notifications = await this.notificationsService.findAll(
                {
                  read: false,
                },
                resident.id,
              );

              const relevantNotification = findPendingSessionNotification(
                notifications.notifications,
                sessionId,
              );

              if (relevantNotification) {
                await this.notificationsService.markVisitorActionTaken(
                  relevantNotification.id,
                  false,
                  'session_timeout',
                );
                this.logger.log(
                  `⏱️ Notificación ${relevantNotification.id} marcada como expirada por timeout para el residente ${resident.id}`,
                );
              }
            }
          } catch (error) {
            this.logger.warn(
              `⚠️ No se pudo marcar las notificaciones como expiradas: ${errorMessage(error)}`,
            );
          }
        }

        return {
          active: false,
          reason: 'La sesión ha expirado (máximo 15 minutos)',
        };
      }

      return { active: true };
    } catch (error) {
      this.logger.warn(
        `No se pudo evaluar la actividad de la sesión ${sessionId}: ${errorMessage(error)}`,
      );
      return {
        active: false,
        reason: 'No se pudo verificar el estado de la sesión',
      };
    }
  }

  /**
   * Responde a una solicitud de visita (aprobación o rechazo).
   *
   * Fase 4 · P4 (D5): solo una sesión humana (`/respond` va con `AuthGuard`).
   * Antes de cualquier escritura:
   *  1. Autorización: quien responde está en `residentsNotified` o tiene
   *     `digital-concierge.manage` en el condominio de la sesión (o es
   *     super-admin). Si no → 403. La pertenencia a `residentsNotified` basta
   *     para el residente: `notifyResident` solo agrega residentes del
   *     condominio de la sesión (fix M1).
   *  2. Sesión sin condominio → 403 (fail-closed: no hay contra qué acotar el
   *     claim ni el check-in).
   *  3. `visitId` distinto de la solicitud vigente de la sesión → 409.
   *  4. Sesión ya respondida, terminada o vencida → 409 (igual que perder el
   *     claim de la visita).
   *
   * Fase 4 · P3 (D2): la visita que creó `notifyResident` está en
   * `AWAITING_APPROVAL`; la respuesta es una transición con claim atómico
   * (`VisitsService.approve`/`deny`), así que una segunda respuesta sobre la
   * misma visita recibe 409 y no repite efectos (check-in, apertura).
   *  - Aprobada (peatonal o vehicular, decisión de Benjamin del 2026-10-08):
   *    `approve` (AWAITING_APPROVAL → PENDING) y check-in (PENDING → ACTIVE)
   *    en el mismo evento que abre la puerta o el portón. Así el LPR, que no
   *    sabe si mira la entrada o la salida, nunca confunde la salida con la
   *    entrada perdida.
   *  - Rechazada: `deny` (→ DENIED).
   * Quién respondió (`respondedById`/`respondedAt`) y, si es un residente
   * notificado, el anfitrión, se escriben en el mismo `UPDATE` condicionado
   * del claim, nunca con el `update()` genérico (seguridad M1).
   *
   * Si `approve` funciona pero el check-in falla, la aprobación se mantiene
   * (la visita queda PENDING, con QR válido) y la respuesta se registra, pero
   * NO se ordena la apertura: abrir sin ingreso registrado repetiría el
   * problema de la entrada perdida. Se alerta a los conserjes del condominio
   * para que abran y registren el ingreso a mano. Si el check-in falla porque
   * la entrada ya estaba registrada (p. ej. el LPR la registró en el medio),
   * es idempotente: tampoco se repite la apertura.
   *
   * Orden (QA N2/N4, Fase 4 · P4): `hub:door_open` sale apenas termina el
   * check-in y, después, `visitor:response` con el acceso EFECTIVO
   * (`entryRegistered`): `true` solo si esta respuesta registró el ingreso y
   * un hub físico recibió la orden. Con el ingreso ya registrado por otra vía
   * (sin apertura) o sin hubs físicos conectados es `false` y se alerta a los
   * conserjes. Después, y sin poder impedir la apertura, se guardan la
   * respuesta y `entryRegistered` en la sesión (best-effort), se envía el SMS
   * con el QR (sin bloquear) y se marcan las notificaciones de los
   * residentes.
   */
  async respondToVisitor(
    sessionId: string,
    input: RespondToVisitorInput,
    responder: HumanConciergeActor,
  ): Promise<RespondToVisitorResult> {
    const { approved } = input;
    this.logger.log(
      `Responding to visitor for session: ${sessionId}, approved: ${approved}, responder: ${responder.userId}`,
    );

    const session = await this.findSessionById(sessionId);

    // 1. Autorización ANTES de cualquier escritura. El residente notificado
    // debe seguir siendo miembro activo del condominio (P5 · D11).
    const isNotifiedResident = await this.isActiveNotifiedResident(
      session,
      responder.userId,
    );
    if (!isNotifiedResident && !this.isConciergeManager(session, responder)) {
      this.logger.warn(
        `Usuario ${responder.userId} sin autorización para responder la sesión ${sessionId}`,
      );
      throw new ForbiddenException(
        'No estás autorizado para responder esta solicitud de visita',
      );
    }

    // 2. Fail-closed (seguridad, bypass por contexto nulo).
    const organizationId = session.organizationId;
    if (!organizationId) {
      this.logger.warn(
        `Sesión ${sessionId} sin condominio: no se puede responder la solicitud`,
      );
      throw new ForbiddenException(
        'La sesión no pertenece a ningún condominio: no se puede responder la solicitud',
      );
    }

    // 3. Se responde exactamente la solicitud que se mostró.
    const visitId = session.createdVisit?.id;
    if (!visitId || visitId !== input.visitId) {
      throw new ConflictException(
        'La solicitud de visita indicada no es la vigente de esta sesión',
      );
    }

    // 4. Sesión vigente y sin respuesta. Un timeout acá expira la solicitud.
    const activity = await this.evaluateSessionActivity(session);
    if (!activity.active) {
      throw new ConflictException(
        activity.reason ?? 'La sesión no está activa',
      );
    }

    // Tenant resource-derived: el de la sesión del citófono.
    const tenantScope = this.sessionTenantScope(session);
    const visitScope: TenantScopeOptions = { organizationId };
    const resolveOptions: ResolveRequestOptions = {
      respondedById: responder.userId,
      hostId: isNotifiedResident ? responder.userId : undefined,
    };

    let approvedVisit: Visit | null = null;
    let entryOutcome: ApprovedEntryOutcome | null = null;
    try {
      if (approved) {
        approvedVisit = await this.visitsService.approve(
          visitId,
          tenantScope,
          resolveOptions,
        );
        this.logger.log(
          `Visita ${visitId} aprobada (AWAITING_APPROVAL -> PENDING)`,
        );
        entryOutcome = await this.registerApprovedEntry(visitId, visitScope);
      } else {
        await this.visitsService.deny(visitId, tenantScope, resolveOptions);
        this.logger.log(`Visita ${visitId} rechazada (DENIED)`);
      }
    } catch (error) {
      // 409: otra respuesta ya resolvió la solicitud, o ya no está esperando
      // aprobación (p. ej. expiró por TTL). Se propaga tal cual: no se abre
      // nada ni se marca la sesión como respondida.
      if (error instanceof ConflictException) {
        throw error;
      }
      // Fase 4 · P4 (M1): si el claim de ESTA respuesta igual quedó
      // confirmado (p. ej. un commit ambiguo), no se responde un 400 genérico:
      // se sigue como respuesta resuelta y, si era aprobación, como ingreso
      // no registrado (sin apertura, con alerta y `entryRegistered=false`).
      const confirmed = await this.isClaimConfirmedFor(
        visitId,
        tenantScope,
        responder.userId,
        approved,
      );
      if (!confirmed) {
        this.logger.error(
          `Error updating visit status: ${errorMessage(error)}`,
        );
        throw new BadRequestException(
          'Error al actualizar el estado de la visita',
        );
      }
      // Fase 4 · P4.B (cyber B3): con dos respuestas en paralelo del MISMO
      // usuario, el claim confirmado puede ser el de la OTRA request, que ya
      // resolvió la sesión (apertura y aviso incluidos). En ese caso este
      // camino no emite `visitor:response`, no alerta ni persiste nada.
      const resolved = await this.persistedResolution(sessionId);
      if (resolved) {
        this.logger.warn(
          `Visita ${visitId}: la respuesta ya la resolvió otra request (${resolved.residentResponse}); este camino no emite ni alerta`,
        );
        const alreadyRegistered = resolved.entryRegistered === true;
        return {
          success: true,
          message: this.responseMessage(approved, alreadyRegistered, null),
          entryRegistered: alreadyRegistered,
        };
      }
      this.logger.error(
        `Visita ${visitId}: la respuesta quedó confirmada, pero falló después (${errorMessage(error)}); se trata como ingreso no registrado`,
      );
      entryOutcome = approved ? 'failed' : null;
    }

    // La respuesta queda resuelta por el claim: solo la request que ganó la
    // transición llega acá (una concurrente recibió 409).
    session.residentResponse = approved ? 'approved' : 'denied';

    // 1. Apertura apenas termina el check-in (QA N2) y, recién después, el
    //    aviso al dispositivo con el acceso EFECTIVO: "pase" solo si esta
    //    respuesta registró el ingreso Y un hub físico recibió la orden.
    const doorOrdered =
      entryOutcome === 'registered' && this.emitDoorOpen(session, visitId);
    const entryRegistered = doorOrdered;
    session.entryRegistered = approved ? entryRegistered : null;
    this.emitResidentResponse(session, approved, visitId, entryRegistered);

    // 2. Todo lo demás va después de la apertura y no la puede impedir.
    await this.persistResidentResponse(session);
    const alert = this.entryAlert(entryOutcome, doorOrdered);
    if (alert) {
      await this.alertConserjes(session, visitId, alert);
    }
    if (approvedVisit) {
      this.sendAccessQRInBackground(approvedVisit);
    }
    await this.markResidentNotificationsProcessed(session, approved);

    return {
      success: true,
      message: this.responseMessage(approved, entryRegistered, entryOutcome),
      entryRegistered,
    };
  }

  /**
   * ¿El claim de esta respuesta quedó confirmado en la BD? (Fase 4 · P4, M1.)
   * La visita salió de `AWAITING_APPROVAL` hacia el estado de la respuesta y
   * `respondedById` es quien respondió. Ante cualquier error de lectura:
   * `false` (el caller responde el 400 de siempre).
   */
  private async isClaimConfirmedFor(
    visitId: string,
    tenantScope: TenantScope,
    responderId: string,
    approved: boolean,
  ): Promise<boolean> {
    try {
      const resolution = await this.visitsService.findResolution(
        visitId,
        tenantScope,
      );
      if (!resolution || resolution.respondedById !== responderId) {
        return false;
      }
      if (!approved) {
        return resolution.status === VisitStatus.DENIED;
      }
      return (
        resolution.status !== VisitStatus.AWAITING_APPROVAL &&
        resolution.status !== VisitStatus.DENIED
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo verificar si la respuesta a la visita ${visitId} quedó confirmada: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * Alerta a conserjería cuando una visita aprobada no terminó en una apertura
   * automática, o `null` si no hace falta (rechazada o abierta).
   */
  private entryAlert(
    entryOutcome: ApprovedEntryOutcome | null,
    doorOrdered: boolean,
  ): ConserjeAlert | null {
    switch (entryOutcome) {
      case 'failed':
        return ENTRY_NOT_REGISTERED_ALERT;
      case 'already_registered':
        return ENTRY_ALREADY_REGISTERED_ALERT;
      case 'registered':
        return doorOrdered ? null : DOOR_NOT_ORDERED_ALERT;
      default:
        return null;
    }
  }

  /**
   * Estado de una sesión para `POST /concierge/session/:id/status` (Fase 4 ·
   * P4): el respaldo por polling del kiosko.
   *
   * Autoriza solo (si no → 403):
   *  - al dispositivo dueño de la sesión (`session.hubId`, y que siga en el
   *    condominio de la sesión);
   *  - a los residentes de `residentsNotified` que sigan siendo miembros
   *    activos del condominio de la sesión (P5 · D11);
   *  - a quien tiene `digital-concierge.manage` en el condominio de la sesión
   *    (o es super-admin).
   */
  async getSessionStatus(
    sessionId: string,
    actor: ConciergeActor,
  ): Promise<SessionStatusResult> {
    const session = await this.findSessionById(sessionId);

    if (!(await this.canReadSession(session, actor))) {
      throw new ForbiddenException(
        'No estás autorizado para consultar el estado de esta sesión',
      );
    }

    const activity = await this.evaluateSessionActivity(session);
    const residentResponse = this.effectiveResidentResponse(session);

    return {
      ...activity,
      visitId: session.createdVisit?.id ?? null,
      residentResponse,
      // El acceso efectivo que persistió `respondToVisitor`: `null` mientras
      // la respuesta aprobada se procesa (nunca un `false` transitorio).
      entryRegistered:
        residentResponse === 'approved'
          ? (session.entryRegistered ?? null)
          : null,
    };
  }

  /**
   * Respuesta de la sesión: la del claim de la visita (`respondedAt` +
   * estado) cuando existe, que es la fuente de verdad; si no, la informativa
   * de la sesión.
   */
  private effectiveResidentResponse(
    session: ConciergeSession,
  ): ResidentResponse {
    const visit = session.createdVisit;
    if (visit?.respondedAt) {
      return visit.status === VisitStatus.DENIED ? 'denied' : 'approved';
    }
    return session.residentResponse;
  }

  private async canReadSession(
    session: ConciergeSession,
    actor: ConciergeActor,
  ): Promise<boolean> {
    if (actor.kind === 'device') {
      return this.isOwningDevice(session, actor);
    }
    return (
      this.isConciergeManager(session, actor) ||
      (await this.isActiveNotifiedResident(session, actor.userId))
    );
  }

  /**
   * ¿El dispositivo es el dueño de la sesión? (Fase 4 · P4.) Es el hub que la
   * inició (`session.hubId`) Y sigue en el condominio de la sesión: un hub
   * movido de condominio no opera sobre sus sesiones viejas, y otro hub o
   * kiosko del mismo condominio tampoco.
   */
  private isOwningDevice(
    session: ConciergeSession,
    device: DeviceConciergeActor,
  ): boolean {
    return (
      session.hubId !== null &&
      session.hubId === device.hubId &&
      session.organizationId === device.organizationId
    );
  }

  /**
   * Sesión sobre la que actúa un dispositivo en `/concierge/session/:id/*`
   * (`execute-tool`, `end`). Solo el dispositivo dueño (ver
   * `isOwningDevice`); si no → 403. El camino humano sigue en
   * `findSessionForTenant`.
   */
  async findSessionForDevice(
    sessionId: string,
    device: DeviceConciergeActor,
  ): Promise<ConciergeSession> {
    const session = await this.findSessionById(sessionId);
    if (!this.isOwningDevice(session, device)) {
      this.logger.warn(
        `Dispositivo ${device.hubId} intentó operar la sesión ${sessionId}, que no le pertenece`,
      );
      throw new ForbiddenException(
        `La sesión "${sessionId}" no pertenece a este dispositivo`,
      );
    }
    return session;
  }

  /** ¿El usuario está entre los residentes notificados de la sesión? */
  private isNotifiedResident(
    session: ConciergeSession,
    userId: string,
  ): boolean {
    return (session.residentsNotified ?? []).some(
      (resident) => resident.id === userId,
    );
  }

  /**
   * Residente notificado que SIGUE siendo miembro activo del condominio de la
   * sesión (Fase 4 · P5, D11): `residentsNotified` es una foto del momento de
   * la notificación; si después lo sacaron del condominio o deshabilitaron su
   * cuenta, ya no responde ni consulta. Sin condominio en la sesión, nunca.
   */
  private async isActiveNotifiedResident(
    session: ConciergeSession,
    userId: string,
  ): Promise<boolean> {
    if (!this.isNotifiedResident(session, userId) || !session.organizationId) {
      return false;
    }
    return this.usersService.isActiveMemberOfOrganization(
      userId,
      session.organizationId,
    );
  }

  /**
   * ¿El usuario gestiona la conserjería del condominio de la sesión?
   * (`digital-concierge.manage` y mismo condominio, o super-admin.)
   */
  private isConciergeManager(
    session: ConciergeSession,
    actor: HumanConciergeActor,
  ): boolean {
    if (!actor.scopes.includes(CONCIERGE_MANAGE_PERMISSION)) {
      return false;
    }
    return (
      actor.isSuperAdmin ||
      (session.organizationId !== null &&
        session.organizationId === actor.tenantId)
    );
  }

  /**
   * `visitor:response:<sessionId>` SOLO al dispositivo dueño de la sesión
   * (Fase 4 · P4, D7): sin caída al condominio, que filtraría la respuesta a
   * otros hubs o kioskos. Si no está conectado, el kiosko se respalda con el
   * polling de `/status`.
   */
  private emitResidentResponse(
    session: ConciergeSession,
    approved: boolean,
    visitId: string,
    entryRegistered: boolean,
  ): void {
    let delivered = false;
    try {
      delivered = this.hubGateway.sendVisitorResponse(session, {
        approved,
        entryRegistered,
        residentResponse: session.residentResponse,
        visitId,
        timestamp: new Date(),
      });
    } catch (error) {
      // Best-effort: el kiosko se respalda con el polling de /status.
      this.logger.error(
        `No se pudo emitir visitor:response de la sesión ${session.sessionId}: ${errorMessage(error)}`,
      );
    }
    this.logger.log(
      `Respuesta del residente ${delivered ? 'enviada' : 'NO entregada'} al dispositivo de la sesión ${session.sessionId} (aprobada=${approved}, ingreso=${entryRegistered})`,
    );
  }

  /**
   * `hub:door_open` SOLO si esta respuesta registró el ingreso (ver docstring
   * de `respondToVisitor`): ni sin check-in, ni dos veces para el mismo
   * ingreso. Fase 4 · P4 (D7): `sendDoorOpen` entrega solo a hubs físicos (el
   * de la sesión o, si no, los del condominio), nunca a un kiosko.
   *
   * @returns `true` si al menos un hub físico recibió la orden.
   */
  private emitDoorOpen(session: ConciergeSession, visitId: string): boolean {
    const type =
      session.createdVisit?.type === VisitType.VEHICULAR
        ? 'vehicular'
        : 'pedestrian';
    this.logger.log(
      `Emitiendo comando de apertura al hub (${type}) para la visita ${visitId}`,
    );
    try {
      return this.hubGateway.sendDoorOpen(session, { type, visitId }) > 0;
    } catch (error) {
      // Sin apertura confirmada: el caller lo trata como "sin hub físico"
      // (`entryRegistered=false` y alerta a conserjería).
      this.logger.error(
        `No se pudo emitir la orden de apertura de la visita ${visitId}: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  /**
   * Respuesta ya persistida en la sesión por otra request (Fase 4 · P4.B,
   * cyber B3), o `null` si sigue sin resolver o no se pudo leer (en ese caso
   * el camino recuperado sigue como antes: fail-closed, sin apertura).
   */
  private async persistedResolution(
    sessionId: string,
  ): Promise<Pick<
    ConciergeSession,
    'residentResponse' | 'entryRegistered'
  > | null> {
    try {
      const current = await this.findSessionById(sessionId);
      const resolved =
        current.residentResponse === 'approved' ||
        current.residentResponse === 'denied';
      return resolved
        ? {
            residentResponse: current.residentResponse,
            entryRegistered: current.entryRegistered ?? null,
          }
        : null;
    } catch (error) {
      this.logger.warn(
        `No se pudo releer la sesión ${sessionId} para verificar si ya estaba resuelta: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Guarda la respuesta del residente y su acceso efectivo
   * (`entryRegistered`, Fase 4 · P4) en la sesión (QA N4), después de decidir
   * la apertura. Best-effort: el claim de la visita es la fuente de verdad de
   * la respuesta y la apertura ya salió, así que un fallo acá solo se
   * registra. Escribe SOLO esas columnas: un `save()` de la sesión completa
   * podría pisar un cierre concurrente (p. ej. el hub termina la sesión al
   * recibir la respuesta).
   *
   * Fase 4 · P4.B (cyber B3): `UPDATE ... WHERE "entryRegistered" IS NULL`.
   * Un `true` ya persistido (la apertura efectiva) nunca se pisa; un `true`
   * sí corrige un `false` que escribió antes el camino recuperado de una
   * respuesta paralela.
   */
  private async persistResidentResponse(
    session: ConciergeSession,
  ): Promise<void> {
    try {
      await this.sessionRepository.update(
        {
          id: session.id,
          entryRegistered:
            session.entryRegistered === true
              ? Or(IsNull(), Equal(false))
              : IsNull(),
        },
        {
          residentResponse: session.residentResponse,
          entryRegistered: session.entryRegistered,
        },
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo guardar la respuesta del residente en la sesión ${session.sessionId}: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * SMS con el QR de la visita aprobada, sin bloquear la respuesta (QA N2).
   * Usa los datos de la SOLICITUD aprobada (seguridad M2), no los de la
   * sesión, que el agente puede seguir editando: el QR es una credencial de
   * acceso y no debe ir a un teléfono distinto del que vio el residente.
   *
   * Corrección P7 (cyber B6): solo con `VISITOR_QR_SMS_ENABLED=true` (ver
   * `SmsService`). Apagado no se genera el QR ni se registra nada del
   * teléfono.
   */
  private sendAccessQRInBackground(visit: Visit): void {
    if (!this.smsService.isEnabled()) {
      this.logger.debug(
        `Visita ${visit.id}: envío del QR por SMS desactivado (VISITOR_QR_SMS_ENABLED)`,
      );
      return;
    }
    if (!visit.visitorPhone) {
      this.logger.warn(
        `Visita ${visit.id}: sin teléfono del visitante, no se envía el QR`,
      );
      return;
    }
    if (!visit.qrCode) {
      this.logger.warn(
        `Visita ${visit.id} aprobada sin código QR: no se envía el SMS`,
      );
      return;
    }
    void this.sendQRToVisitor(
      visit.id,
      visit.qrCode,
      visit.visitorName,
      visit.visitorPhone,
    ).catch((error: unknown) => {
      this.logger.warn(
        `No se pudo enviar por SMS el QR de la visita ${visit.id}: ${errorMessage(error)}`,
      );
    });
  }

  /**
   * Marca como procesadas las notificaciones de "visitante en portería" de
   * esta sesión para TODOS los residentes notificados. Best-effort.
   */
  private async markResidentNotificationsProcessed(
    session: ConciergeSession,
    approved: boolean,
  ): Promise<void> {
    try {
      for (const resident of session.residentsNotified ?? []) {
        const notifications = await this.notificationsService.findAll(
          {
            read: false,
          },
          resident.id,
        );

        const relevantNotification = findPendingSessionNotification(
          notifications.notifications,
          session.sessionId,
        );

        if (relevantNotification) {
          await this.notificationsService.markVisitorActionTaken(
            relevantNotification.id,
            approved,
          );
          this.logger.log(
            `Notificación ${relevantNotification.id} marcada como procesada para el residente ${resident.id}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo marcar las notificaciones como procesadas: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Check-in de una visita recién aprobada (ver docstring de
   * `respondToVisitor`). Nunca lanza: la aprobación ya está confirmada. Si
   * falla, el caller alerta a los conserjes DESPUÉS de avisar al hub.
   */
  private async registerApprovedEntry(
    visitId: string,
    visitScope: TenantScopeOptions,
  ): Promise<ApprovedEntryOutcome> {
    try {
      await this.visitsService.checkIn(visitId, visitScope);
      this.logger.log(`Visita ${visitId} con check-in registrado (ACTIVE)`);
      return 'registered';
    } catch (error) {
      if (error instanceof VisitEntryAlreadyRegisteredException) {
        this.logger.warn(
          `Visita ${visitId}: la entrada ya estaba registrada por otra vía; no se repite la apertura`,
        );
        return 'already_registered';
      }
      this.logger.error(
        `Visita ${visitId} aprobada, pero no se pudo registrar la entrada: ${errorMessage(error)}`,
      );
      return 'failed';
    }
  }

  /**
   * Alerta (best-effort) a los conserjes del condominio de la sesión: la
   * visita se aprobó, pero el ingreso no quedó registrado o la orden de
   * apertura no llegó a ningún hub físico. Sin condominio no se notifica a
   * nadie (mismo fail-closed que las detecciones).
   */
  private async alertConserjes(
    session: ConciergeSession,
    visitId: string,
    alert: ConserjeAlert,
  ): Promise<void> {
    if (!session.organizationId) {
      this.logger.warn(
        `Sesión ${session.sessionId} sin condominio: no se alerta a conserjes por la visita ${visitId}`,
      );
      return;
    }
    try {
      await this.notificationsService.notifyByRoleForOrganization(
        'Conserje',
        session.organizationId,
        NotificationType.SYSTEM_ALERT,
        alert.title,
        alert.message,
        {
          priority: NotificationPriority.HIGH,
          data: { visitId, sessionId: session.sessionId },
        },
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo alertar a los conserjes por la visita ${visitId}: ${errorMessage(error)}`,
      );
    }
  }

  private responseMessage(
    approved: boolean,
    entryRegistered: boolean,
    entryOutcome: ApprovedEntryOutcome | null,
  ): string {
    if (!approved) {
      return 'Visita rechazada exitosamente';
    }
    if (entryRegistered) {
      return 'Visita aprobada exitosamente';
    }
    if (entryOutcome === 'failed') {
      return 'Visita aprobada, pero no se pudo registrar el ingreso: el conserje debe abrir manualmente';
    }
    return 'Visita aprobada, pero el acceso no se abrió automáticamente: se avisó a conserjería';
  }

  /** Scope de tenant de una sesión del citófono (resource-derived). */
  private sessionTenantScope(session: ConciergeSession): TenantScope {
    return { tenantId: session.organizationId, isSuperAdmin: false };
  }

  /**
   * Expira la solicitud AWAITING_APPROVAL de una sesión que terminó sin
   * respuesta (QA B4). Best-effort: si falla, el TTL del cron la expira
   * igual (`ExpirationService.expireAwaitingApprovalVisits`).
   */
  private async expireAwaitingRequest(
    session: ConciergeSession,
    reason: string,
  ): Promise<void> {
    const visit = session.createdVisit;
    if (visit?.status !== VisitStatus.AWAITING_APPROVAL) {
      return;
    }
    try {
      const expired = await this.visitsService.expireRequest(
        visit.id,
        this.sessionTenantScope(session),
      );
      if (expired) {
        this.logger.log(
          `Solicitud ${visit.id} expirada por ${reason} sin respuesta del residente`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo expirar la solicitud ${visit.id} (${reason}): ${errorMessage(error)}`,
      );
    }
  }

  // ========== HERRAMIENTAS ==========
  //
  // Fase 1, Bloque A2b (docs/modulos/agente-cerebro.md §5/§7/§10.2 paso 4):
  // estos métodos eran `private`, invocados solo desde el `switch` de
  // `executeTool` (ya eliminado). Ahora son `public` porque los adaptadores
  // `VigiliaTool` en `agent/tools/*.tool.ts` los invocan directamente — la
  // lógica de negocio NO se reescribe, solo cambia quién la llama (el
  // `ToolDispatcherService`, vía el adaptador, en vez del switch). Ver
  // `findSessionForTenant` más abajo para cómo el adaptador resuelve la
  // `ConciergeSession` de forma tenant-aware antes de llamar a cualquiera de
  // estos métodos.

  /**
   * Guarda datos del visitante en la sesión.
   *
   * Cierre de brecha Fase 1 → Fase 2: el frontend adelgazado dejó de validar
   * y formatear RUT/teléfono/patente antes de mandarlos — este método ahora
   * es la ÚNICA línea de defensa (dominio, no UI) para esos tres campos, vía
   * `common/utils/chilean-format.util.ts`.
   *
   * Diseño "fail-soft" a propósito: un dato inválido NUNCA lanza una
   * excepción (esto es una llamada telefónica en curso, no un formulario) —
   * simplemente no se persiste ese campo, y el resultado devuelve
   * `ok: false` + `campo`/`mensaje` para que la tool `guardar_datos_visitante`
   * se lo entregue al modelo (Sofía), que le pide al visitante que repita el
   * dato (ver `agent/prompts/sofia.prompt.ts`, pasos 2b/2c/2d). Si llegan
   * varios campos en la misma llamada y más de uno es inválido, se reporta
   * el primero (rut > telefono > patente) — el flujo normal de Sofía llama
   * esta tool con un campo a la vez, así que en la práctica siempre hay como
   * máximo uno.
   */
  async saveVisitorData(
    session: ConciergeSession,
    data: SaveVisitorDataInput,
  ): Promise<SaveVisitorDataResult> {
    // No se loguea `data` — contiene PII del visitante en claro (nombre,
    // rut, telefono, patente) y `main.ts` no fija `logLevels`, así que
    // `debug` corre también en producción (hallazgo de limpieza post-
    // auditoría, MENOR 1). `auditToolCall` (tool-audit.util.ts) sigue siendo
    // la auditoría intencional que SÍ persiste estos campos en
    // `system_logs` — esto es solo el log de diagnóstico, no se toca esa vía.
    this.logger.debug('Saving visitor data...');

    let campoInvalido: SaveVisitorDataField | undefined;
    let mensajeInvalido: string | undefined;
    // Fase 4 · P4.B: solo las columnas que esta llamada escribe (ver el
    // `update` de abajo).
    const patch: VisitorDataPatch = {};

    if (data.nombre) {
      session.visitorName = data.nombre;
      patch.visitorName = session.visitorName;
    }

    if (data.rut) {
      if (looksLikeRut(data.rut)) {
        if (isValidRut(data.rut)) {
          session.visitorRut = formatRut(data.rut);
          patch.visitorRut = session.visitorRut;
        } else {
          campoInvalido = 'rut';
          mensajeInvalido = `El RUT "${data.rut}" no tiene un dígito verificador válido.`;
        }
      } else if (isValidPassport(data.rut)) {
        session.visitorRut = data.rut.trim().toUpperCase();
        patch.visitorRut = session.visitorRut;
      } else {
        campoInvalido = 'rut';
        mensajeInvalido = `"${data.rut}" no parece un RUT ni un pasaporte válido.`;
      }
    }

    if (data.telefono) {
      const normalizedPhone = normalizeChileanPhone(data.telefono);
      if (isValidChileanPhone(normalizedPhone)) {
        session.visitorPhone = normalizedPhone;
        patch.visitorPhone = normalizedPhone;
      } else if (!campoInvalido) {
        campoInvalido = 'telefono';
        mensajeInvalido = `El teléfono "${data.telefono}" no parece un número chileno válido.`;
      }
    }

    if (data.patente) {
      const normalizedPlate = normalizeChileanPlate(data.patente);
      if (isValidChileanPlate(normalizedPlate)) {
        session.vehiclePlate = normalizedPlate;
        patch.vehiclePlate = normalizedPlate;
      } else if (!campoInvalido) {
        campoInvalido = 'patente';
        mensajeInvalido = `La patente "${data.patente}" no tiene un formato chileno válido.`;
      }
    }

    if (data.motivo) {
      session.visitReason = data.motivo;
      patch.visitReason = data.motivo;
    }
    if (data.casa) {
      session.destinationHouse = data.casa;
      patch.destinationHouse = data.casa;
    }

    // Fase 4 · P4.B: `update` de las columnas escritas, no un `save()` de la
    // sesión completa: ese pisaría `residentResponse`/`entryRegistered` (u
    // otro cierre) escritos en paralelo por `respondToVisitor`/`endSession`.
    if (Object.keys(patch).length > 0) {
      await this.sessionRepository.update({ id: session.id }, patch);
    }

    return {
      message: campoInvalido
        ? 'Uno de los datos entregados no es válido, no se guardó ese campo'
        : 'Datos guardados correctamente',
      saved: {
        nombre: session.visitorName,
        rut: session.visitorRut,
        telefono: session.visitorPhone,
        patente: session.vehiclePlate,
        motivo: session.visitReason,
        casa: session.destinationHouse,
      },
      ok: !campoInvalido,
      ...(campoInvalido
        ? { campo: campoInvalido, mensaje: mensajeInvalido }
        : {}),
    };
  }

  /**
   * Notifica a TODOS los residentes de la familia sobre la visita y crea la
   * visita como SOLICITUD (`AWAITING_APPROVAL`, Fase 4 · P3): no es válida
   * para QR ni LPR, no tiene `Vehicle` y expira por TTL si nadie responde.
   * Solo `respondToVisitor` la aprueba o rechaza.
   *
   * Fix M1 (Fase 1, Bloque A2b — docs/modulos/agente-cerebro.md §6/§11):
   * antes, `usersService.findOne(id)` cargaba CUALQUIER usuario por id, sin
   * verificar que perteneciera al condominio de la sesión — un id de OTRO
   * condominio (adivinado, filtrado desde otra sesión, o inyectado por un
   * modelo comprometido) se notificaba/asignaba como host igual. Ahora se
   * exige que `user.family.organizationId` coincida con el condominio de la
   * sesión ANTES de aceptarlo como destinatario válido; un id que no matchea
   * se descarta igual que un id inexistente (mismo log + mismo comportamiento
   * observable para el modelo).
   *
   * Fase 4 · P3 (seguridad ALTO, bypass por contexto nulo): la visita se crea
   * con el condominio EXPLÍCITO de la sesión (`CreateVisitOptions`), nunca
   * derivado de un contexto nulo. Una sesión sin condominio, o de un
   * condominio distinto al del contexto autorizado, no crea nada. La visita
   * vale `VISIT_CONCIERGE_VALIDITY_HOURS` desde la solicitud (QA N1).
   */
  async notifyResident(
    session: ConciergeSession,
    params: { residentes_ids: string[] },
    tenantScope: TenantScope,
  ) {
    this.logger.debug(
      `Notifying ${params.residentes_ids?.length ?? 0} resident(s) for session ${session.sessionId}`,
    );

    // Seguridad M2: con una solicitud ya esperando al residente, NO se crea
    // otra ni se sobrescribe `session.createdVisit` (la respuesta del
    // residente resolvería una visita distinta de la que vio). El agente debe
    // reenviar la notificación de la solicitud existente.
    if (session.createdVisit?.status === VisitStatus.AWAITING_APPROVAL) {
      this.logger.warn(
        `Sesión ${session.sessionId}: ya hay una solicitud en espera (visita ${session.createdVisit.id}); no se crea otra`,
      );
      return {
        notificado: false,
        mensaje: REQUEST_ALREADY_AWAITING_MESSAGE,
      };
    }

    const organizationId = this.requestOrganizationId(session, tenantScope);
    if (!organizationId) {
      return {
        notificado: false,
        mensaje:
          'Esta llamada no está asociada a un condominio: no se puede notificar ni crear la solicitud de visita.',
      };
    }

    try {
      // Validar que hay al menos un residente
      if (!params.residentes_ids || params.residentes_ids.length === 0) {
        throw new BadRequestException('No se proporcionaron IDs de residentes');
      }

      // Obtener todos los residentes, ignorando los que no se encuentren (ej.
      // usuarios eliminados) o no pertenezcan al condominio de esta sesión
      // (fix M1, ver docstring del método).
      const validResidents: User[] = [];
      for (const id of params.residentes_ids) {
        try {
          const user = await this.usersService.findOne(id);
          if (!user) {
            continue;
          }

          const userOrganizationId = user.family?.organizationId ?? null;
          if (userOrganizationId !== organizationId) {
            this.logger.warn(
              `Fix M1: residente ${id} pertenece a otro condominio (organizationId=${userOrganizationId ?? 'null'}, esperado=${organizationId}) — se ignora.`,
            );
            continue;
          }

          validResidents.push(user);
        } catch (error) {
          this.logger.warn(
            `No se pudo cargar el residente con ID ${id}: ${errorMessage(error)}`,
          );
        }
      }

      if (validResidents.length === 0) {
        throw new NotFoundException(
          'No se encontraron residentes válidos para notificar',
        );
      }

      // Guardar residentes notificados en la sesión
      session.residentsNotified = validResidents.map((r) => ({
        id: r.id,
        name: r.name,
      }));
      session.residentResponse = 'pending';
      // Una solicitud nueva en la misma sesión no hereda el acceso de la
      // anterior (si no, `/status` lo mostraría al aprobarse esta).
      session.entryRegistered = null;

      // Crear la visita como solicitud pendiente de aprobación
      // Validar datos requeridos
      if (!session.visitorName || !session.destinationHouse) {
        throw new BadRequestException(
          'Faltan datos requeridos del visitante (nombre, casa)',
        );
      }

      // IMPORTANTE: Usar el primer residente solo como PLACEHOLDER temporal
      // El host definitivo se asignará cuando algún residente apruebe la visita
      const temporaryHost = validResidents[0];

      // Crear la solicitud (AWAITING_APPROVAL). La patente queda como
      // `requestedPlate`: el Vehicle recién se crea al aprobar.
      const visitType = session.vehiclePlate
        ? VisitType.VEHICULAR
        : VisitType.PEDESTRIAN;

      const requestedAt = Date.now();
      const visit = await this.visitsService.create(
        {
          visitorName: session.visitorName,
          visitorRut: session.visitorRut ?? undefined,
          visitorPhone: session.visitorPhone ?? undefined,
          vehiclePlate: session.vehiclePlate ?? undefined,
          reason: session.visitReason || 'Visita',
          type: visitType,
          hostId: temporaryHost.id, // Host temporal - se actualizará al aprobar
          // familyId se asigna automáticamente desde el anfitrión
          validFrom: new Date(requestedAt).toISOString(),
          // QA N1: ventana corta (VISIT_CONCIERGE_VALIDITY_HOURS, default 4 h).
          validUntil: new Date(
            requestedAt + this.requestValidityMs,
          ).toISOString(),
          maxUses: 1,
        },
        { initialStatus: VisitStatus.AWAITING_APPROVAL, organizationId },
      );

      // Guardar la visita creada en la sesión. Fase 4 · P4.B: `update` de
      // las columnas de la solicitud, no un `save()` de la sesión completa
      // (pisaría datos del visitante o un cierre escritos en paralelo).
      session.createdVisit = visit;
      await this.sessionRepository.update(
        { id: session.id },
        {
          residentsNotified: session.residentsNotified,
          residentResponse: session.residentResponse,
          entryRegistered: session.entryRegistered,
          createdVisit: { id: visit.id },
        },
      );

      this.logger.log(
        `Visita ${visit.id} creada en estado AWAITING_APPROVAL (host temporal ${temporaryHost.id})`,
      );

      // NUEVO: Enviar notificación a TODOS los residentes de la familia, con
      // los datos de la SOLICITUD (lo que el residente aprueba), no de la
      // sesión.
      const notifications = await Promise.all(
        validResidents.map((resident) =>
          this.notificationsService.notifyVisitorArrival(
            resident.id,
            { sessionId: session.sessionId, visitId: visit.id },
            this.requestNotificationData(visit),
          ),
        ),
      );

      this.logger.log(
        `📬 ${notifications.length} notificaciones creadas para todos los miembros de la familia`,
      );

      return {
        notificado: true,
        residentes_notificados: validResidents.map((r) => r.name),
        cantidad_notificados: validResidents.length,
        visita_creada: true,
        visita_id: visit.id,
        mensaje: `Notificación enviada a ${validResidents.length} residente(s) y solicitud de visita creada, pendiente de aprobación del residente. Esperando respuesta...`,
      };
    } catch (error) {
      this.logger.error(`Error notifying resident: ${errorMessage(error)}`);
      return {
        notificado: false,
        mensaje:
          'Error al enviar la notificación. Por favor intente nuevamente.',
      };
    }
  }

  /**
   * Condominio de la solicitud que crea `notifyResident`: el de la sesión del
   * citófono (lo estampa `startSession` desde el hub o la sesión humana).
   * `null` si la sesión no tiene condominio o si no coincide con el del
   * contexto autorizado (defensa en profundidad: `findSessionForTenant` ya lo
   * exige, salvo super-admin). Con `null` no se crea nada.
   */
  private requestOrganizationId(
    session: ConciergeSession,
    tenantScope: TenantScope,
  ): string | null {
    const organizationId = session.organizationId;
    if (!organizationId) {
      this.logger.warn(
        `Sesión ${session.sessionId} sin condominio: no se crea la solicitud de visita`,
      );
      return null;
    }
    if (!tenantScope.isSuperAdmin && tenantScope.tenantId !== organizationId) {
      this.logger.warn(
        `Sesión ${session.sessionId}: su condominio no coincide con el del contexto autorizado; no se crea la solicitud de visita`,
      );
      return null;
    }
    return organizationId;
  }

  /**
   * Datos del visitante que ve el residente en la notificación: los de la
   * SOLICITUD (`requestedPlate` es la patente que `approve` asocia), nunca
   * los de la sesión, que el agente puede seguir editando (seguridad M2).
   */
  private requestNotificationData(visit: Visit): {
    name: string;
    rut?: string;
    phone?: string;
    plate?: string;
    reason?: string;
  } {
    return {
      name: visit.visitorName || 'Visitante',
      rut: visit.visitorRut ?? undefined,
      phone: visit.visitorPhone ?? undefined,
      plate: visit.requestedPlate ?? undefined,
      reason: visit.reason ?? undefined,
    };
  }

  /**
   * Reenvía la notificación de la solicitud que sigue esperando al residente
   * a los residentes que ya estaban en la lista (si hubo timeout). Usa los
   * datos de la visita en espera, no los de la sesión (seguridad M2). Sin
   * una solicitud AWAITING_APPROVAL no hay nada que reenviar: una expirada o
   * ya respondida no se puede aprobar.
   */
  async resendNotification(session: ConciergeSession) {
    this.logger.debug(
      `Resending notification for session: ${session.sessionId}`,
    );

    if (!session.residentsNotified || session.residentsNotified.length === 0) {
      return {
        reenviado: false,
        mensaje:
          'No hay residentes previos a quienes reenviar la notificación.',
      };
    }

    const request = session.createdVisit;
    if (request?.status !== VisitStatus.AWAITING_APPROVAL) {
      return {
        reenviado: false,
        mensaje:
          'No hay una solicitud esperando la respuesta del residente. Si el visitante sigue esperando, usa notificar_residente para crear una nueva.',
      };
    }

    try {
      await Promise.all(
        session.residentsNotified.map((resident) =>
          this.notificationsService.notifyVisitorArrival(
            resident.id,
            { sessionId: session.sessionId, visitId: request.id },
            this.requestNotificationData(request),
          ),
        ),
      );

      this.logger.log(
        `📬 Notificaciones reenviadas a ${session.residentsNotified.length} residentes`,
      );

      return {
        reenviado: true,
        mensaje:
          'Notificación reenviada. Diles que vas a seguir esperando un momento.',
      };
    } catch (error) {
      this.logger.error(`Error resending notification: ${errorMessage(error)}`);
      return {
        reenviado: false,
        mensaje: 'Hubo un error al intentar reenviar la notificación.',
      };
    }
  }

  /**
   * Contexto de la casa para el conserje de voz (Fase 4 · P6.M): solo las
   * visitas pre-aprobadas vigentes (`PENDING` dentro de su ventana). Ya no
   * hay "visitantes frecuentes" (perfilado) ni frases con autoridad ("pase
   * directo"): son datos, y nunca otorgan acceso. Corrección P7 (cyber B8):
   * solo la CANTIDAD, sin nombres (ver house-context.ts). Ante un error se
   * devuelve 0 (el flujo normal notifica al residente igual).
   */
  async getHouseContext(houseNumber: string): Promise<HouseContext> {
    try {
      const family = await this.familiesService.findByDepartment(houseNumber);
      if (!family) {
        return { ...EMPTY_HOUSE_CONTEXT };
      }

      // Sin sesión de usuario (ver comentario en respondToVisitor) — ya está
      // acotado a UNA familia resource-derived (familyId), que a su vez
      // pertenece a un único condominio, así que el bypass no reabre el leak
      // cross-tenant que motivó esta tarea. Solo PENDING (aprobada y sin uso):
      // una solicitud AWAITING_APPROVAL NO es pre-aprobada (Fase 4 · P3).
      const visits = await this.visitsService.findAll(
        { familyId: family.id, status: VisitStatus.PENDING },
        { skipTenantScope: true },
      );
      const now = new Date();
      const expected = visits.filter(
        (v) =>
          v.status === VisitStatus.PENDING &&
          new Date(v.validFrom) <= now &&
          new Date(v.validUntil) >= now,
      );

      return buildHouseContext(expected.length);
    } catch (e) {
      this.logger.warn(
        `Error al obtener contexto de casa ${houseNumber}: ${errorMessage(e)}`,
      );
      return { ...EMPTY_HOUSE_CONTEXT };
    }
  }

  // ========== HELPERS ==========

  async findSessionById(sessionId: string): Promise<ConciergeSession> {
    const session = await this.sessionRepository.findOne({
      where: { sessionId },
      relations: ['createdVisit'],
    });

    if (!session) {
      throw new NotFoundException(`Session not found: ${sessionId}`);
    }

    return session;
  }

  /**
   * Resuelve una `ConciergeSession` Y verifica que pertenezca al condominio
   * de `tenantScope` (Fase 1, Bloque A2b — docs/modulos/agente-cerebro.md
   * §6: "toda tool y todo lookup filtran por el condominio activo"). Punto
   * de entrada único que usan los adaptadores `VigiliaTool` de
   * `agent/tools/*.tool.ts` que operan sobre una sesión de citófono
   * (`guardar_datos_visitante`, `notificar_residente`, `reenviar_notificacion`,
   * `finalizar_llamada`) — evita que el contexto del condominio A pueda leer
   * o mutar una `ConciergeSession` que originó el condominio B, aunque
   * conozca (o adivine) su `sessionId`.
   */
  async findSessionForTenant(
    sessionId: string,
    tenantScope: TenantScope,
  ): Promise<ConciergeSession> {
    const session = await this.findSessionById(sessionId);

    // Fase 4 · P5.C: un scope sin condominio no alcanza ninguna sesión.
    if (!isInTenantScope(session.organizationId, tenantScope)) {
      throw new ForbiddenException(
        `La sesión "${sessionId}" no pertenece al condominio del contexto autorizado`,
      );
    }

    return session;
  }

  /**
   * Genera el QR de la visita y lo envía por SMS al visitante (lo escanea el
   * guardia, p. ej. para registrar la salida).
   *
   * QA N2: el QR codifica `visit.qrCode`, el mismo valor que muestra
   * `QRCodeModal` y que busca `GET /visits/qr/:qrCode`. Antes codificaba
   * `{visitId, action}` en JSON y el escáner no encontraba la visita.
   */
  private async sendQRToVisitor(
    visitId: string,
    qrCode: string,
    visitorName: string,
    visitorPhone: string,
  ): Promise<void> {
    const qrDataUrl = await this.qrcodeService.generateAccessQR(qrCode);
    const sent = await this.smsService.sendQRCodeSMS({
      phone: visitorPhone,
      visitorName,
      qrDataUrl,
      visitId,
    });
    if (sent) {
      this.logger.log(`QR enviado por SMS para la visita ${visitId}`);
    }
  }
}
