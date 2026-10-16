import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ANONYMIZED_MARKER,
  plateKeySql,
  rutKeySql,
} from './privacy-identifiers';
import {
  anonymizeDetectionsWith,
  type AnonymizedDetections,
  type SqlExecutor,
} from './retention.repository';
import {
  ANONYMIZE_SESSION_SET_SQL,
  anonymizeVisitSetSql,
  orphanVisitorVehicleSql,
  TERMINAL_SESSION_STATUSES,
  TERMINAL_VISIT_STATUSES,
} from './retention-sql';
import { firstNumber, requiredString, rowsOf, stringOrNull } from './sql-rows';
import type { SubjectErasureRequest } from './erasure-request';
import { VehicleAccessLevel } from '../vehicles/vehicle-access';

/**
 * Qué parte de las coincidencias se pide: las que se pueden suprimir ya
 * (`erasable`: visitas y sesiones terminales, detecciones sin intento
 * pendiente, vehículos de visita huérfanos) o las vigentes (`kept`), que no
 * se tocan y solo se informan.
 */
export type MatchScope = 'erasable' | 'kept';

/** Registro que coincide con el titular. */
export interface MatchedRecord {
  id: string;
}

/** Sesión del conserje que coincide (con su `sessionId`, que usan las notificaciones). */
export interface MatchedSession extends MatchedRecord {
  sessionKey: string;
}

/** Detección que coincide con la patente. */
export interface MatchedDetection extends MatchedRecord {
  fullFramePath: string | null;
}

/** Vínculos de una notificación con registros (en `data`). */
export interface NotificationLinks {
  visitIds: readonly string[];
  sessionKeys: readonly string[];
  detectionIds: readonly string[];
}

/** Operaciones de la supresión dentro de UNA transacción. */
export interface ErasureTransaction {
  findVisits: (
    request: SubjectErasureRequest,
    scope: MatchScope,
    limit: number,
  ) => Promise<MatchedRecord[]>;
  anonymizeVisits: (ids: readonly string[]) => Promise<number>;
  findSessions: (
    request: SubjectErasureRequest,
    visitIds: readonly string[],
    scope: MatchScope,
    limit: number,
  ) => Promise<MatchedSession[]>;
  anonymizeSessions: (ids: readonly string[]) => Promise<number>;
  findDetections: (
    request: SubjectErasureRequest,
    scope: MatchScope,
    limit: number,
  ) => Promise<MatchedDetection[]>;
  anonymizeDetections: (
    ids: readonly string[],
    clearedFrameIds: readonly string[],
  ) => Promise<AnonymizedDetections>;
  findVisitorVehicles: (
    request: SubjectErasureRequest,
    scope: MatchScope,
    limit: number,
  ) => Promise<MatchedRecord[]>;
  deleteVisitorVehicles: (ids: readonly string[]) => Promise<number>;
  deleteNotifications: (
    request: SubjectErasureRequest,
    erased: NotificationLinks,
    kept: NotificationLinks,
    limit: number,
  ) => Promise<number>;
  deletePendingActions: (
    organizationId: string,
    sessionKeys: readonly string[],
    limit: number,
  ) => Promise<number>;
}

/**
 * Coincidencia de una visita con el titular (alias `v`; patente: también la
 * del vehículo asociado, alias `ve`). `$1` = condominio, `$2` = clave.
 */
const VISIT_MATCH_SQL: Record<SubjectErasureRequest['kind'], string> = {
  rut: `${rutKeySql('v."visitorRut"')} = $2`,
  plate: `(${plateKeySql('v."requestedPlate"')} = $2 OR ${plateKeySql('ve."plate"')} = $2)`,
};

/** Coincidencia de una sesión del conserje (alias `s`). */
const SESSION_MATCH_SQL: Record<SubjectErasureRequest['kind'], string> = {
  rut: `${rutKeySql('s."visitorRut"')} = $2`,
  plate: `${plateKeySql('s."vehiclePlate"')} = $2`,
};

/**
 * Coincidencia directa de una notificación por los datos del visitante que
 * copia en `data` (alias `n`; la clave va en `$5`).
 */
const NOTIFICATION_MATCH_SQL: Record<SubjectErasureRequest['kind'], string> = {
  rut: `${rutKeySql(`n."data" -> 'visitor' ->> 'rut'`)} = $5`,
  plate: `(${plateKeySql(`n."data" ->> 'plate'`)} = $5 OR ${plateKeySql(`n."data" -> 'visitor' ->> 'plate'`)} = $5)`,
};

/** Detección "vigente": un intento espera la decisión del conserje. */
const DETECTION_PENDING_SQL = `EXISTS (SELECT 1 FROM "access_attempts" a WHERE a."detectionId" = d."id" AND a."decision" = 'Pendiente')`;

/** `$n::text[]` de estados terminales: `= ANY` (erasable) o `<> ALL` (kept). */
function statusFilter(
  column: string,
  scope: MatchScope,
  param: string,
): string {
  return scope === 'erasable'
    ? `${column}::text = ANY(${param}::text[])`
    : `${column}::text <> ALL(${param}::text[])`;
}

/**
 * Fase 4 · P7.R (docs/modulos/privacidad-ley-21719.md §4): consultas de la
 * supresión por RUT o patente (`POST /privacy/erasure`). Todo va acotado al
 * condominio (`organizationId`); las filas sin condominio no se tocan. Los
 * identificadores se comparan normalizados (privacy-identifiers.ts). Cada
 * consulta lleva un `LIMIT`: la supresión procesa un lote acotado por
 * request (corrección P7, cyber B7).
 */
@Injectable()
export class ErasureRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Corre `work` en una transacción con las operaciones de la supresión. */
  async inTransaction<T>(
    work: (tx: ErasureTransaction) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction((manager) =>
      work(
        createErasureTransaction((sql, params) => manager.query(sql, params)),
      ),
    );
  }
}

/** Operaciones de la supresión sobre un ejecutor (exportada para los tests de SQL). */
export function createErasureTransaction(
  execute: SqlExecutor,
): ErasureTransaction {
  const affected = async (sql: string, params: unknown[]): Promise<number> =>
    firstNumber(await execute(sql, params), 'affected');
  const ids = async (sql: string, params: unknown[]): Promise<string[]> =>
    rowsOf(await execute(sql, params)).map((row) =>
      requiredString(row.id, 'id'),
    );

  return {
    async findVisits(request, scope, limit) {
      const found = await ids(
        `SELECT v."id"
         FROM "visits" v LEFT JOIN "vehicles" ve ON ve."id" = v."vehicleId"
         WHERE v."organizationId" = $1 AND v."anonymizedAt" IS NULL AND ${VISIT_MATCH_SQL[request.kind]}
           AND ${statusFilter('v."status"', scope, '$3')}
         ORDER BY v."createdAt" LIMIT $4`,
        [
          request.organizationId,
          request.key,
          [...TERMINAL_VISIT_STATUSES],
          limit,
        ],
      );
      return found.map((id) => ({ id }));
    },

    async anonymizeVisits(visitIds) {
      if (visitIds.length === 0) {
        return 0;
      }
      return affected(
        `WITH affected AS (
           UPDATE "visits" t SET ${anonymizeVisitSetSql('$3')}
           WHERE t."id" = ANY($1::uuid[]) AND t."status"::text = ANY($2::text[])
           RETURNING 1
         ) SELECT count(*)::int AS "affected" FROM affected`,
        [[...visitIds], [...TERMINAL_VISIT_STATUSES], ANONYMIZED_MARKER],
      );
    },

    async findSessions(request, visitIds, scope, limit) {
      const rows = rowsOf(
        await execute(
          `SELECT s."id", s."sessionId"
           FROM "concierge_sessions" s
           WHERE s."organizationId" = $1 AND s."anonymizedAt" IS NULL
             AND (${SESSION_MATCH_SQL[request.kind]} OR s."createdVisitId" = ANY($3::uuid[]))
             AND ${statusFilter('s."status"', scope, '$4')}
           ORDER BY s."createdAt" LIMIT $5`,
          [
            request.organizationId,
            request.key,
            [...visitIds],
            [...TERMINAL_SESSION_STATUSES],
            limit,
          ],
        ),
      );
      return rows.map((row) => ({
        id: requiredString(row.id, 'id'),
        sessionKey: requiredString(row.sessionId, 'sessionId'),
      }));
    },

    async anonymizeSessions(sessionIds) {
      if (sessionIds.length === 0) {
        return 0;
      }
      return affected(
        `WITH affected AS (
           UPDATE "concierge_sessions" t SET ${ANONYMIZE_SESSION_SET_SQL}
           WHERE t."id" = ANY($1::uuid[]) AND t."status"::text = ANY($2::text[])
           RETURNING 1
         ) SELECT count(*)::int AS "affected" FROM affected`,
        [[...sessionIds], [...TERMINAL_SESSION_STATUSES]],
      );
    },

    async findDetections(request, scope, limit) {
      if (request.kind !== 'plate') {
        return [];
      }
      const rows = rowsOf(
        await execute(
          `SELECT d."id", d."full_frame_path" AS "fullFramePath"
           FROM "plate_detections" d
           WHERE d."organizationId" = $1 AND d."anonymizedAt" IS NULL
             AND (${plateKeySql('d."plate"')} = $2 OR ${plateKeySql('d."plate_raw"')} = $2)
             AND ${scope === 'erasable' ? 'NOT ' : ''}${DETECTION_PENDING_SQL}
           ORDER BY d."createdAt" LIMIT $3`,
          [request.organizationId, request.key, limit],
        ),
      );
      return rows.map((row) => ({
        id: requiredString(row.id, 'id'),
        fullFramePath: stringOrNull(row.fullFramePath),
      }));
    },

    async anonymizeDetections(detectionIds, clearedFrameIds) {
      if (detectionIds.length === 0) {
        return { detections: 0, accessAttempts: 0 };
      }
      return anonymizeDetectionsWith(execute, detectionIds, clearedFrameIds);
    },

    async findVisitorVehicles(request, scope, limit) {
      if (request.kind !== 'plate') {
        return [];
      }
      // `erasable`: huérfano (ninguna visita lo usa); `kept`: lo usa una
      // visita (vigente, o fuera del lote de este request).
      const usage =
        scope === 'erasable'
          ? orphanVisitorVehicleSql('ve')
          : `ve."ownerId" IS NULL AND EXISTS (SELECT 1 FROM "visits" vv WHERE vv."vehicleId" = ve."id")`;
      const found = await ids(
        `SELECT ve."id" FROM "vehicles" ve
         WHERE ve."organizationId" = $1 AND ${plateKeySql('ve."plate"')} = $2
           AND ve."accessLevel" = $3 AND ${usage}
         ORDER BY ve."createdAt" LIMIT $4`,
        [
          request.organizationId,
          request.key,
          VehicleAccessLevel.VISITOR,
          limit,
        ],
      );
      return found.map((id) => ({ id }));
    },

    async deleteVisitorVehicles(vehicleIds) {
      if (vehicleIds.length === 0) {
        return 0;
      }
      // Revalida que siga huérfano (una visita pudo tomarlo entre medio).
      return affected(
        `WITH affected AS (
           DELETE FROM "vehicles" ve
           WHERE ve."id" = ANY($1::uuid[]) AND ${orphanVisitorVehicleSql('ve')}
           RETURNING 1
         ) SELECT count(*)::int AS "affected" FROM affected`,
        [[...vehicleIds]],
      );
    },

    async deleteNotifications(request, erased, kept, limit) {
      // Se borran las que apuntan a un registro ya anonimizado o copian el
      // identificador, salvo las de un registro vigente que se omitió (p. ej.
      // la solicitud que el residente todavía tiene que aprobar).
      return affected(
        `WITH candidates AS (
           SELECT n."id" FROM "notifications" n
           WHERE n."organizationId" = $1
             AND (
               n."data" ->> 'visitId' = ANY($2::text[])
               OR n."data" ->> 'sessionId' = ANY($3::text[])
               OR n."data" ->> 'detectionId' = ANY($4::text[])
               OR ${NOTIFICATION_MATCH_SQL[request.kind]}
             )
             AND NOT (
               coalesce(n."data" ->> 'visitId', '') = ANY($6::text[])
               OR coalesce(n."data" ->> 'sessionId', '') = ANY($7::text[])
               OR coalesce(n."data" ->> 'detectionId', '') = ANY($8::text[])
             )
           LIMIT $9
         ), affected AS (
           DELETE FROM "notifications" t USING candidates c WHERE t."id" = c."id"
           RETURNING 1
         ) SELECT count(*)::int AS "affected" FROM affected`,
        [
          request.organizationId,
          [...erased.visitIds],
          [...erased.sessionKeys],
          [...erased.detectionIds],
          request.key,
          [...kept.visitIds],
          [...kept.sessionKeys],
          [...kept.detectionIds],
          limit,
        ],
      );
    },

    async deletePendingActions(organizationId, sessionKeys, limit) {
      if (sessionKeys.length === 0) {
        return 0;
      }
      // Todas las de esas sesiones (ya terminales: ninguna se puede ejecutar).
      return affected(
        `WITH candidates AS (
           SELECT p."id" FROM "pending_actions" p
           WHERE p."tenantId" = $1 AND p."sessionId"::text = ANY($2::text[])
           LIMIT $3
         ), affected AS (
           DELETE FROM "pending_actions" t USING candidates c WHERE t."id" = c."id"
           RETURNING 1
         ) SELECT count(*)::int AS "affected" FROM affected`,
        [organizationId, [...sessionKeys], limit],
      );
    },
  };
}
