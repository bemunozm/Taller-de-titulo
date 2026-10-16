import { PendingActionStatus } from '../agent/entities/pending-action.entity';
import { SessionStatus } from '../digital-concierge/entities/concierge-session.entity';
import { VehicleAccessLevel } from '../vehicles/vehicle-access';
import { VisitStatus } from '../visits/entities/visit.entity';
import type { RetentionPeriodName } from '../config/env.validation';
import { ANONYMIZED_MARKER } from './privacy-identifiers';
import type { SqlStatement } from './sql-rows';

/**
 * Fase 4 · P7.R (docs/modulos/privacidad-ley-21719.md §3): SQL de las
 * categorías de retención que se resuelven en la BD sin pasos externos (las
 * que borran archivos en Cloudinary viven en `RetentionRepository`).
 *
 * Reglas comunes:
 *  - El corte se calcula en Postgres (`now() - make_interval(days => $1)`),
 *    igual que los defaults `now()` con los que se escribieron las filas
 *    (algunas columnas son `timestamp` sin zona).
 *  - Cada lote toma sus candidatos con `FOR UPDATE SKIP LOCKED`: una fila
 *    que otra transacción está escribiendo se salta y queda para la próxima
 *    corrida; el `WHERE` se reevalúa sobre la versión bloqueada.
 *  - Idempotentes: el `WHERE` excluye lo ya procesado (`anonymizedAt`,
 *    imagen ya vacía o fila ya borrada).
 *  - El UPDATE/DELETE va en un CTE y la sentencia termina en `SELECT
 *    count(*)`: así `DataSource.query` devuelve filas (ver sql-rows.ts).
 */

/** Visitas que ya no cambian: las únicas que se anonimizan. */
export const TERMINAL_VISIT_STATUSES: readonly VisitStatus[] = Object.freeze([
  VisitStatus.COMPLETED,
  VisitStatus.CANCELLED,
  VisitStatus.EXPIRED,
  VisitStatus.DENIED,
]);

/** Sesiones del conserje cerradas: nunca se toca una `ACTIVE`. */
export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] =
  Object.freeze([
    SessionStatus.COMPLETED,
    SessionStatus.CANCELLED,
    SessionStatus.TIMEOUT,
  ]);

/**
 * Acciones del agente que se borran al cumplir el plazo: TODAS, también
 * `PENDING` (corrección P7, QA M2). Una acción solo se ejecuta dentro de
 * `PENDING_ACTION_MAX_AGE_MS` (15 min) desde su creación, así que con el
 * plazo de retención (días) ninguna puede aprobarse ni reanudarse.
 */
export const DELETABLE_PENDING_ACTION_STATUSES: readonly PendingActionStatus[] =
  Object.freeze(Object.values(PendingActionStatus));

/** Antigüedad (ms) desde la que se borra una fila de `rateLimit` (1 día). */
export const RATE_LIMIT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Fecha de cierre de una visita (misma expresión que el índice parcial
 * `IDX_visits_retention_candidates`): la salida, o lo que ocurra primero
 * entre el fin de la validez y la última escritura (corrección P7, QA M5:
 * una visita cancelada o rechazada se cierra cuando se cancela, no al final
 * de una validez que puede estar lejos en el futuro).
 */
export const VISIT_CLOSED_AT_SQL = `COALESCE("exitTime", LEAST("validUntil", "updatedAt"))`;

/** Fecha de cierre de una sesión del conserje (misma expresión que el índice parcial). */
export const SESSION_CLOSED_AT_SQL = `COALESCE("endTime", "updatedAt")`;

/** `residentsNotified` sin nombres: `[{ id, name: null }]` (las entradas que no son objeto se descartan). */
export const ANONYMIZED_RESIDENTS_NOTIFIED_SQL = `CASE WHEN jsonb_typeof(t."residentsNotified") = 'array' THEN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.value -> 'id', 'name', NULL) ORDER BY e.ordinality), '[]'::jsonb)
    FROM jsonb_array_elements(t."residentsNotified") WITH ORDINALITY AS e(value, ordinality)
    WHERE jsonb_typeof(e.value) = 'object'
  ) ELSE NULL END`;

/**
 * SET que anonimiza una visita (alias de la tabla: `t`). También suelta el
 * vehículo (`vehicleId` = NULL; corrección P7, QA B1): la patente del
 * visitante vive en `vehicles` y la UI la mostraba por esa relación. El
 * vehículo de visita que queda huérfano lo borra `visitorVehicles`.
 */
export function anonymizeVisitSetSql(markerParam: string): string {
  return `"visitorName" = ${markerParam}, "visitorRut" = NULL, "visitorPhone" = NULL, "requestedPlate" = NULL, "reason" = NULL, "qrCode" = NULL, "vehicleId" = NULL, "anonymizedAt" = COALESCE(t."anonymizedAt", now())`;
}

/**
 * Vehículo de VISITA huérfano (alias opcional `alias`): nivel visitante,
 * sin dueño y sin ninguna visita que lo use. Los de residentes (con dueño) no
 * entran: se van con la cuenta (`UsersService.anonymizeDisabledUser`).
 */
export function orphanVisitorVehicleSql(alias: string): string {
  return `${alias}."accessLevel" = '${VehicleAccessLevel.VISITOR}' AND ${alias}."ownerId" IS NULL AND NOT EXISTS (SELECT 1 FROM "visits" vv WHERE vv."vehicleId" = ${alias}."id")`;
}

/** SET que anonimiza una sesión del conserje (alias de la tabla: `t`). */
export const ANONYMIZE_SESSION_SET_SQL = `"visitorName" = NULL, "visitorRut" = NULL, "visitorPhone" = NULL, "vehiclePlate" = NULL, "visitReason" = NULL, "residentsNotified" = ${ANONYMIZED_RESIDENTS_NOTIFIED_SQL}, "transcript" = '[]'::jsonb, "functionCalls" = '[]'::jsonb, "anonymizedAt" = COALESCE(t."anonymizedAt", now())`;

/** Corte de un plazo en días; `param` es el placeholder de los días. */
function cutoff(param: string): string {
  return `now() - make_interval(days => ${param}::int)`;
}

export type SetBasedCategory =
  | 'anomalyImages'
  | 'visits'
  | 'conciergeSessions'
  | 'visitorVehicles'
  | 'anomalies'
  | 'notifications'
  | 'pendingActions'
  | 'auditLogs'
  | 'systemLogs'
  | 'authSessions'
  | 'authVerifications'
  | 'authRateLimits';

export type RetentionAction = 'delete' | 'anonymize' | 'purge-images';

/**
 * `personal`: datos personales, los gobierna `RETENTION_ENABLED`.
 * `technical`: limpieza técnica (logs del sistema y tablas de better-auth),
 * corre siempre (decisión de Nova, QA M4).
 */
export type RetentionKind = 'personal' | 'technical';

/** Categoría que se barre con una sola sentencia por lote. */
export interface SetBasedSweep {
  readonly category: SetBasedCategory;
  readonly action: RetentionAction;
  readonly kind: RetentionKind;
  /** Plazo que la gobierna; `null` = vencimiento propio (better-auth). */
  readonly period: RetentionPeriodName | null;
  readonly table: string;
  /** `WHERE` de los candidatos (columnas sin alias). */
  readonly where: string;
  /** Parámetros del `WHERE` (`$1`...), a partir de los días del plazo. */
  readonly params: (days: number) => unknown[];
  readonly orderBy: string;
  /** SET del UPDATE (solo `anonymize`/`purge-images`; alias `t`). */
  readonly set?: string;
  /** Parámetros extra del SET, a continuación de los del `WHERE`. */
  readonly setParams?: readonly unknown[];
}

const DAYS_PARAM = (days: number): unknown[] => [days];

/**
 * Categorías set-based, en el orden en que corren: primero imágenes (el
 * plazo más corto), después anonimizaciones y al final los borrados (los
 * técnicos al final).
 */
export const SET_BASED_SWEEPS: readonly SetBasedSweep[] = Object.freeze([
  {
    category: 'anomalyImages',
    kind: 'personal',
    action: 'purge-images',
    period: 'RETENTION_IMAGES_DAYS',
    table: 'anomaly_events',
    where: `"snapshotJpegB64" IS NOT NULL AND "timestamp" < ${cutoff('$1')}`,
    params: DAYS_PARAM,
    orderBy: '"timestamp"',
    set: '"snapshotJpegB64" = NULL',
  },
  {
    category: 'visits',
    kind: 'personal',
    action: 'anonymize',
    period: 'RETENTION_VISITS_DAYS',
    table: 'visits',
    where: `"anonymizedAt" IS NULL AND "status"::text = ANY($2::text[]) AND ${VISIT_CLOSED_AT_SQL} < ${cutoff('$1')}`,
    params: (days) => [days, [...TERMINAL_VISIT_STATUSES]],
    orderBy: VISIT_CLOSED_AT_SQL,
    // El marcador va como parámetro ($4: días, estados y límite antes).
    set: anonymizeVisitSetSql('$4'),
    setParams: [ANONYMIZED_MARKER],
  },
  {
    category: 'conciergeSessions',
    kind: 'personal',
    action: 'anonymize',
    period: 'RETENTION_VISITS_DAYS',
    table: 'concierge_sessions',
    where: `"anonymizedAt" IS NULL AND "status"::text = ANY($2::text[]) AND ${SESSION_CLOSED_AT_SQL} < ${cutoff('$1')}`,
    params: (days) => [days, [...TERMINAL_SESSION_STATUSES]],
    orderBy: SESSION_CLOSED_AT_SQL,
    set: ANONYMIZE_SESSION_SET_SQL,
  },
  {
    // Corrección P7 (QA B1): vehículos de visita huérfanos (después de
    // anonimizar las visitas, que sueltan su `vehicleId`). `updatedAt`: un
    // vehículo que una visita nueva reutiliza sigue referenciado y no entra.
    category: 'visitorVehicles',
    kind: 'personal',
    action: 'delete',
    period: 'RETENTION_VISITS_DAYS',
    table: 'vehicles',
    where: `"updatedAt" < ${cutoff('$1')} AND ${orphanVisitorVehicleSql('"vehicles"')}`,
    params: DAYS_PARAM,
    orderBy: '"updatedAt"',
  },
  {
    category: 'anomalies',
    kind: 'personal',
    action: 'delete',
    period: 'RETENTION_ANOMALIES_DAYS',
    table: 'anomaly_events',
    where: `"timestamp" < ${cutoff('$1')}`,
    params: DAYS_PARAM,
    orderBy: '"timestamp"',
  },
  {
    category: 'notifications',
    kind: 'personal',
    action: 'delete',
    period: 'RETENTION_NOTIFICATIONS_DAYS',
    table: 'notifications',
    where: `"createdAt" < ${cutoff('$1')}`,
    params: DAYS_PARAM,
    orderBy: '"createdAt"',
  },
  {
    category: 'pendingActions',
    kind: 'personal',
    action: 'delete',
    period: 'RETENTION_PENDING_ACTIONS_DAYS',
    table: 'pending_actions',
    // Todas, también PENDING (ver DELETABLE_PENDING_ACTION_STATUSES).
    where: `"createdAt" < ${cutoff('$1')}`,
    params: DAYS_PARAM,
    orderBy: '"createdAt"',
  },
  {
    category: 'auditLogs',
    kind: 'personal',
    action: 'delete',
    period: 'RETENTION_AUDIT_DAYS',
    table: 'audit_logs',
    where: `"createdAt" < ${cutoff('$1')}`,
    params: DAYS_PARAM,
    orderBy: '"createdAt"',
  },
  {
    category: 'systemLogs',
    kind: 'technical',
    action: 'delete',
    period: 'RETENTION_SYSTEM_LOGS_DAYS',
    table: 'system_logs',
    where: `"created_at" < ${cutoff('$1')}`,
    params: DAYS_PARAM,
    orderBy: '"created_at"',
  },
  {
    category: 'authSessions',
    kind: 'technical',
    action: 'delete',
    period: null,
    table: 'session',
    where: `"expiresAt" < now()`,
    params: () => [],
    orderBy: '"expiresAt"',
  },
  {
    category: 'authVerifications',
    kind: 'technical',
    action: 'delete',
    period: null,
    table: 'verification',
    where: `"expiresAt" < now()`,
    params: () => [],
    orderBy: '"expiresAt"',
  },
  {
    category: 'authRateLimits',
    kind: 'technical',
    action: 'delete',
    period: null,
    table: 'rateLimit',
    // `lastRequest` es epoch en ms (bigint).
    where: `"lastRequest" < (extract(epoch from now()) * 1000)::bigint - $1::bigint`,
    params: () => [RATE_LIMIT_MAX_AGE_MS],
    orderBy: '"lastRequest"',
  },
]);

/** Cuántas filas procesaría la categoría (dry-run). */
export function countStatement(
  sweep: SetBasedSweep,
  days: number,
): SqlStatement {
  return {
    sql: `SELECT count(*)::int AS "count" FROM "${sweep.table}" WHERE ${sweep.where}`,
    params: sweep.params(days),
  };
}

/** Un lote de la categoría: procesa hasta `limit` filas y devuelve `affected`. */
export function batchStatement(
  sweep: SetBasedSweep,
  days: number,
  limit: number,
): SqlStatement {
  const params = sweep.params(days);
  const limitParam = `$${params.length + 1}`;
  const candidates = `SELECT "id" FROM "${sweep.table}" WHERE ${sweep.where} ORDER BY ${sweep.orderBy} LIMIT ${limitParam} FOR UPDATE SKIP LOCKED`;
  const mutation =
    sweep.action === 'delete'
      ? `DELETE FROM "${sweep.table}" t USING candidates c WHERE t."id" = c."id" RETURNING 1`
      : `UPDATE "${sweep.table}" t SET ${requireSet(sweep)} FROM candidates c WHERE t."id" = c."id" RETURNING 1`;
  return {
    sql: `WITH candidates AS (${candidates}), affected AS (${mutation}) SELECT count(*)::int AS "affected" FROM affected`,
    params: [...params, limit, ...(sweep.setParams ?? [])],
  };
}

function requireSet(sweep: SetBasedSweep): string {
  if (!sweep.set) {
    throw new Error(`La categoría ${sweep.category} no define su SET`);
  }
  return sweep.set;
}
