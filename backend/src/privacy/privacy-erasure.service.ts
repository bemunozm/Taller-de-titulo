import { Injectable } from '@nestjs/common';
import type { TenantActor } from '../common/tenant/tenant-actor';
import { UsersService } from '../users/users.service';
import { isRemoteUrl } from './cloudinary-url';
import { DisabledUserAnonymizer } from './disabled-user-anonymizer.service';
import type { PrivacyErasureDto } from './dto/privacy-erasure.dto';
import {
  type ErasureRequest,
  resolveErasureRequest,
  type SubjectErasureRequest,
  type UserErasureRequest,
} from './erasure-request';
import {
  ErasureRepository,
  type ErasureTransaction,
  type MatchedSession,
} from './erasure.repository';

/**
 * Filas por categoría que procesa UN request de supresión (corrección P7,
 * cyber B7). Si alguna categoría tiene más, la respuesta trae
 * `complete: false` y basta repetir el mismo pedido (es idempotente: lo ya
 * anonimizado no vuelve a coincidir).
 */
export const ERASURE_MAX_ROWS_PER_CATEGORY = 500;

/**
 * Respuesta de `POST /privacy/erasure` (contrato, Fase 4 · P7.R). Solo
 * conteos: nunca el RUT ni la patente (la auditoría guarda esta respuesta).
 */
export interface PrivacyErasureResult {
  criterion: ErasureRequest['kind'];
  /**
   * Solo con `userId`: el id de la cuenta anonimizada. La auditoría lo toma
   * como `entityId` (corrección P7, cyber B3).
   */
  id?: string;
  /** Condominio donde se suprimió; `null` en una cuenta pedida por el super-admin. */
  organizationId: string | null;
  anonymized: {
    visits: number;
    conciergeSessions: number;
    detections: number;
    accessAttempts: number;
    users: number;
  };
  deleted: {
    notifications: number;
    pendingActions: number;
    /** Vehículos de visita (sin dueño) que ya ninguna visita usaba. */
    visitorVehicles: number;
  };
  /** Registros vigentes que coinciden y NO se tocaron (siguen su curso). */
  skipped: {
    visits: number;
    conciergeSessions: number;
    detections: number;
    /** Vehículos de visita que todavía usa una visita (vigente). */
    visitorVehicles: number;
  };
  /**
   * Imágenes en Cloudinary que quedaron encoladas: la supresión no llama a
   * Cloudinary dentro del request; las borra la próxima corrida de
   * retención (privacy/README.md).
   */
  imagesPendingDeletion: number;
  /**
   * `false` si alguna categoría superó `ERASURE_MAX_ROWS_PER_CATEGORY`: se
   * procesó un lote y hay que repetir el pedido para completar.
   */
  complete: boolean;
}

function emptyResult(
  criterion: ErasureRequest['kind'],
  organizationId: string | null,
): PrivacyErasureResult {
  return {
    criterion,
    organizationId,
    anonymized: {
      visits: 0,
      conciergeSessions: 0,
      detections: 0,
      accessAttempts: 0,
      users: 0,
    },
    deleted: { notifications: 0, pendingActions: 0, visitorVehicles: 0 },
    skipped: {
      visits: 0,
      conciergeSessions: 0,
      detections: 0,
      visitorVehicles: 0,
    },
    imagesPendingDeletion: 0,
    complete: true,
  };
}

function idsOf(records: readonly { id: string }[]): string[] {
  return records.map((record) => record.id);
}

/**
 * Lote acotado: pide `limit + 1` filas para saber si sobran. Devuelve las
 * primeras `limit` y si quedó algo fuera.
 */
async function boundedBatch<T>(
  find: (limit: number) => Promise<T[]>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows = await find(ERASURE_MAX_ROWS_PER_CATEGORY + 1);
  return {
    rows: rows.slice(0, ERASURE_MAX_ROWS_PER_CATEGORY),
    truncated: rows.length > ERASURE_MAX_ROWS_PER_CATEGORY,
  };
}

/**
 * Fase 4 · P7.R (Ley 21.719, docs/modulos/privacidad-ley-21719.md §4):
 * supresión u oposición ejercida ante la administración del condominio.
 * Runbook: privacy/README.md.
 *
 *  - Por RUT o patente: en UNA transacción y en el condominio, anonimiza las
 *    visitas y sesiones del conserje terminales (las visitas sueltan su
 *    vehículo), las detecciones sin intento pendiente (con sus intentos),
 *    borra los vehículos de visita que quedan huérfanos y las notificaciones
 *    y acciones del agente que copian esos datos. Lo vigente (visitas no
 *    terminales, sesiones activas, detecciones esperando al conserje y los
 *    vehículos que ellas usan) se informa en `skipped` y no se toca.
 *  - No llama a Cloudinary: los frames remotos quedan encolados para la
 *    retención (`imagesPendingDeletion`). Las rutas locales y los recortes en
 *    base64 se borran en el acto.
 *  - Procesa a lo más `ERASURE_MAX_ROWS_PER_CATEGORY` filas por categoría
 *    (`complete: false` si sobran).
 *  - Por usuario: lo anonimiza sin esperar el plazo de retención, si está
 *    deshabilitado (409 si no) y el actor puede administrarlo (una cuenta de
 *    personal, solo el super-admin).
 */
@Injectable()
export class PrivacyErasureService {
  constructor(
    private readonly repository: ErasureRepository,
    private readonly usersService: UsersService,
    private readonly userAnonymizer: DisabledUserAnonymizer,
  ) {}

  async erase(
    dto: PrivacyErasureDto,
    actor: TenantActor,
  ): Promise<PrivacyErasureResult> {
    const request = resolveErasureRequest(dto, actor);
    return request.kind === 'userId'
      ? this.eraseUser(request, actor)
      : this.repository.inTransaction((tx) => this.eraseSubject(tx, request));
  }

  private async eraseUser(
    request: UserErasureRequest,
    actor: TenantActor,
  ): Promise<PrivacyErasureResult> {
    await this.usersService.assertCanAnonymizeForActor(request.userId, actor);
    const outcome = await this.userAnonymizer.anonymize(request.userId, {
      deferPictures: true,
    });
    const result = emptyResult(
      'userId',
      actor.isSuperAdmin ? null : actor.organizationId,
    );
    result.id = request.userId;
    result.anonymized.users = outcome.alreadyAnonymized ? 0 : 1;
    result.imagesPendingDeletion = outcome.picturePending ? 1 : 0;
    return result;
  }

  private async eraseSubject(
    tx: ErasureTransaction,
    request: SubjectErasureRequest,
  ): Promise<PrivacyErasureResult> {
    const result = emptyResult(request.kind, request.organizationId);
    const limit = ERASURE_MAX_ROWS_PER_CATEGORY;
    let truncated = false;

    // Visitas: las terminales se anonimizan (y sueltan su vehículo).
    const visits = await boundedBatch((n) =>
      tx.findVisits(request, 'erasable', n),
    );
    const keptVisits = await tx.findVisits(request, 'kept', limit);
    truncated ||= visits.truncated;
    result.anonymized.visits = await tx.anonymizeVisits(idsOf(visits.rows));
    result.skipped.visits = keptVisits.length;

    // Sesiones: por identificador o por la visita que crearon.
    const visitIds = [...idsOf(visits.rows), ...idsOf(keptVisits)];
    const sessions = await boundedBatch((n) =>
      tx.findSessions(request, visitIds, 'erasable', n),
    );
    const keptSessions = await tx.findSessions(
      request,
      visitIds,
      'kept',
      limit,
    );
    truncated ||= sessions.truncated;
    result.anonymized.conciergeSessions = await tx.anonymizeSessions(
      idsOf(sessions.rows),
    );
    result.skipped.conciergeSessions = keptSessions.length;

    // Detecciones (solo por patente). Los frames remotos quedan encolados.
    const detections = await boundedBatch((n) =>
      tx.findDetections(request, 'erasable', n),
    );
    const keptDetections = await tx.findDetections(request, 'kept', limit);
    truncated ||= detections.truncated;
    const remoteFrames = detections.rows.filter(
      (d) => d.fullFramePath !== null && isRemoteUrl(d.fullFramePath),
    );
    const clearedFrameIds = detections.rows
      .filter((d) => !remoteFrames.includes(d))
      .map((d) => d.id);
    const anonymizedDetections = await tx.anonymizeDetections(
      idsOf(detections.rows),
      clearedFrameIds,
    );
    result.anonymized.detections = anonymizedDetections.detections;
    result.anonymized.accessAttempts = anonymizedDetections.accessAttempts;
    result.skipped.detections = keptDetections.length;
    result.imagesPendingDeletion = remoteFrames.length;

    // Vehículos de visita con esa patente: después de soltar las visitas.
    const vehicles = await boundedBatch((n) =>
      tx.findVisitorVehicles(request, 'erasable', n),
    );
    const keptVehicles = await tx.findVisitorVehicles(request, 'kept', limit);
    truncated ||= vehicles.truncated;
    result.deleted.visitorVehicles = await tx.deleteVisitorVehicles(
      idsOf(vehicles.rows),
    );
    result.skipped.visitorVehicles = keptVehicles.length;

    result.deleted.notifications = await tx.deleteNotifications(
      request,
      {
        visitIds: idsOf(visits.rows),
        sessionKeys: sessionKeysOf(sessions.rows),
        detectionIds: idsOf(detections.rows),
      },
      {
        visitIds: idsOf(keptVisits),
        sessionKeys: sessionKeysOf(keptSessions),
        detectionIds: idsOf(keptDetections),
      },
      limit,
    );
    result.deleted.pendingActions = await tx.deletePendingActions(
      request.organizationId,
      sessionKeysOf(sessions.rows),
      limit,
    );
    truncated ||=
      result.deleted.notifications >= limit ||
      result.deleted.pendingActions >= limit;

    result.complete = !truncated;
    return result;
  }
}

/**
 * Claves con las que otras tablas apuntan a una sesión: las notificaciones
 * usan `sessionId` (texto) y `pending_actions.sessionId` puede ser ese valor o
 * el `id` de la fila; se envían ambos.
 */
function sessionKeysOf(sessions: readonly MatchedSession[]): string[] {
  return [...new Set(sessions.flatMap((s) => [s.id, s.sessionKey]))];
}
