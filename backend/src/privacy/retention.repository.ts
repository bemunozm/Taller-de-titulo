import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { parseLprPassageWindowSeconds } from '../config/env.validation';
import { MASKED_PLATE } from './privacy-identifiers';
import {
  batchStatement,
  countStatement,
  type SetBasedSweep,
} from './retention-sql';
import {
  firstNumber,
  requiredString,
  rowsOf,
  stringOrNull,
  type SqlStatement,
} from './sql-rows';

/** Detección con imágenes por purgar (o por anonimizar). */
export interface DetectionFrameRow {
  id: string;
  /** Ruta local o URL de Cloudinary del frame completo. */
  fullFramePath: string | null;
}

/** Usuario deshabilitado pendiente de anonimizar (o con fotos por borrar). */
export interface DisabledUserRow {
  id: string;
}

/** Resultado de anonimizar un lote de detecciones. */
export interface AnonymizedDetections {
  detections: number;
  accessAttempts: number;
}

/**
 * Clave del advisory lock de Postgres que serializa las corridas de
 * retención (también entre instancias, aunque hoy se despliega una sola).
 */
const RETENTION_LOCK_SQL = `SELECT pg_try_advisory_lock(hashtext('vigilia.privacy.retention')) AS "locked"`;
const RETENTION_UNLOCK_SQL = `SELECT pg_advisory_unlock(hashtext('vigilia.privacy.retention')) AS "unlocked"`;

/** Detecciones con alguna imagen (recorte en `meta` o frame completo). */
const HAS_DETECTION_IMAGE_SQL = `("full_frame_path" IS NOT NULL OR (jsonb_typeof("meta") = 'object' AND "meta" ? 'snapshot_jpeg_b64'))`;

/** Quita el recorte en base64 de `meta` (si `meta` es un objeto). */
const META_WITHOUT_SNAPSHOT_SQL = `CASE WHEN jsonb_typeof("meta") = 'object' THEN "meta" - 'snapshot_jpeg_b64' ELSE "meta" END`;

/**
 * Detección "vigente": tiene un intento esperando la decisión del conserje,
 * propio o de su PASADA (las lecturas de otras cámaras son evidencia del mismo
 * intento pendiente). No se anonimiza hasta que se resuelva o expire
 * (ExpirationService).
 */
export const DETECTION_HAS_PENDING_ATTEMPT_SQL = `(EXISTS (SELECT 1 FROM "access_attempts" a WHERE a."detectionId" = d."id" AND a."decision" = 'Pendiente') OR (d."passageId" IS NOT NULL AND EXISTS (SELECT 1 FROM "access_attempts" ap WHERE ap."passageId" = d."passageId" AND ap."decision" = 'Pendiente')))`;

/**
 * Imágenes por purgar: vencidas (plazo de imágenes) o de una detección ya
 * anonimizada (la supresión deja sus frames de Cloudinary encolados acá para
 * no llamar a Cloudinary dentro del request; corrección P7, cyber B7).
 */
const DETECTION_IMAGES_WHERE = `("createdAt" < now() - make_interval(days => $1::int) OR "anonymizedAt" IS NOT NULL) AND ${HAS_DETECTION_IMAGE_SQL}`;
const DETECTIONS_TO_ANONYMIZE_WHERE = `d."anonymizedAt" IS NULL AND d."createdAt" < now() - make_interval(days => $1::int) AND NOT ${DETECTION_HAS_PENDING_ATTEMPT_SQL}`;
/**
 * Cuentas deshabilitadas por anonimizar (pasado el plazo) o ya anonimizadas
 * con una foto pendiente en Cloudinary (falló antes, o la supresión la dejó
 * encolada sin esperar el plazo; corrección P7, cyber B7).
 */
const DISABLED_USERS_WHERE = `"deletedAt" IS NOT NULL AND (("anonymizedAt" IS NULL AND "deletedAt" < now() - make_interval(days => $1::int)) OR ("anonymizedAt" IS NOT NULL AND ("profilePicture" IS NOT NULL OR "image" IS NOT NULL)))`;

/**
 * Fase 4 · P7.R: acceso a la BD del barrido de retención
 * (`RetentionService`). Las categorías set-based ejecutan el SQL de
 * retention-sql.ts; las que borran archivos en Cloudinary (frames de
 * detecciones, fotos de usuarios) leen primero el lote y escriben después,
 * con los ids cuyo archivo ya se pudo borrar.
 */
@Injectable()
export class RetentionRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Corre `work` con el advisory lock de retención tomado en una conexión
   * dedicada. Si otra corrida lo tiene, devuelve `null` sin correr nada.
   */
  async withRunLock<T>(work: () => Promise<T>): Promise<T | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [row] = rowsOf(await runner.query(RETENTION_LOCK_SQL));
      if (row?.locked !== true) {
        return null;
      }
      try {
        return await work();
      } finally {
        await runner.query(RETENTION_UNLOCK_SQL);
      }
    } finally {
      await runner.release();
    }
  }

  async countSetBased(sweep: SetBasedSweep, days: number): Promise<number> {
    return this.number(countStatement(sweep, days), 'count');
  }

  async runSetBasedBatch(
    sweep: SetBasedSweep,
    days: number,
    limit: number,
  ): Promise<number> {
    return this.number(batchStatement(sweep, days, limit), 'affected');
  }

  // --- Imágenes de detecciones (RETENTION_IMAGES_DAYS) ---------------------

  async countDetectionImages(days: number): Promise<number> {
    return this.number(
      {
        sql: `SELECT count(*)::int AS "count" FROM "plate_detections" WHERE ${DETECTION_IMAGES_WHERE}`,
        params: [days],
      },
      'count',
    );
  }

  /**
   * Lote de detecciones con imágenes vencidas. `excludeIds`: las que en esta
   * corrida no se pudieron borrar de Cloudinary (conservan la URL para
   * reintentar en la próxima).
   */
  async findDetectionImageBatch(
    days: number,
    limit: number,
    excludeIds: readonly string[],
  ): Promise<DetectionFrameRow[]> {
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT "id", "full_frame_path" AS "fullFramePath" FROM "plate_detections" WHERE ${DETECTION_IMAGES_WHERE} AND NOT ("id" = ANY($2::uuid[])) ORDER BY "createdAt" LIMIT $3`,
        [days, [...excludeIds], limit],
      ),
    );
    return rows.map(toDetectionFrameRow);
  }

  /**
   * Quita el recorte de `meta` de `ids` y el frame (`full_frame_path`) solo
   * de `clearedFrameIds` (sin archivo en Cloudinary o ya borrado). Devuelve
   * cuántas filas cambiaron.
   */
  async clearDetectionImages(
    ids: readonly string[],
    clearedFrameIds: readonly string[],
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    return this.number(
      {
        sql: `WITH affected AS (UPDATE "plate_detections" SET "meta" = ${META_WITHOUT_SNAPSHOT_SQL}, "full_frame_path" = CASE WHEN "id" = ANY($2::uuid[]) THEN NULL ELSE "full_frame_path" END WHERE "id" = ANY($1::uuid[]) RETURNING 1) SELECT count(*)::int AS "affected" FROM affected`,
        params: [[...ids], [...clearedFrameIds]],
      },
      'affected',
    );
  }

  // --- Detecciones e intentos (RETENTION_ACCESS_LOG_DAYS) ------------------

  async countDetectionsToAnonymize(days: number): Promise<number> {
    return this.number(
      {
        sql: `SELECT count(*)::int AS "count" FROM "plate_detections" d WHERE ${DETECTIONS_TO_ANONYMIZE_WHERE}`,
        params: [days],
      },
      'count',
    );
  }

  async findDetectionsToAnonymize(
    days: number,
    limit: number,
  ): Promise<DetectionFrameRow[]> {
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT d."id", d."full_frame_path" AS "fullFramePath" FROM "plate_detections" d WHERE ${DETECTIONS_TO_ANONYMIZE_WHERE} ORDER BY d."createdAt" LIMIT $2`,
        [days, limit],
      ),
    );
    return rows.map(toDetectionFrameRow);
  }

  /**
   * Anonimiza las detecciones `ids` (patente enmascarada, `plate_raw` y
   * recorte a null; frame a null solo en `clearedFrameIds`) y, en sus
   * intentos, `reason` y el residente. Revalida en el UPDATE que sigan sin
   * anonimizar y sin intentos pendientes.
   */
  async anonymizeDetections(
    ids: readonly string[],
    clearedFrameIds: readonly string[],
  ): Promise<AnonymizedDetections> {
    if (ids.length === 0) {
      return { detections: 0, accessAttempts: 0 };
    }
    return anonymizeDetectionsWith(
      (sql, params) => this.dataSource.query(sql, params),
      ids,
      clearedFrameIds,
    );
  }

  /**
   * Enmascara la patente de las pasadas que ya salieron de su ventana y cuyas
   * detecciones ya están todas anonimizadas (o no tienen ninguna), para no
   * dejar pasadas huérfanas en claro (p. ej. una supresión o una corrida que
   * las pilló dentro de la ventana). Respeta las pasadas con un intento
   * pendiente del conserje. Devuelve cuántas enmascaró.
   */
  async anonymizeStalePassages(): Promise<number> {
    return this.number(
      {
        sql: `WITH affected AS (
          UPDATE "vehicle_passages" p SET "plate" = $1, "anonymizedAt" = now()
          WHERE p."anonymizedAt" IS NULL
            AND p."lastSeenAt" < now() - make_interval(secs => $2::int)
            AND NOT EXISTS (SELECT 1 FROM "plate_detections" d WHERE d."passageId" = p."id" AND d."anonymizedAt" IS NULL)
            AND NOT EXISTS (SELECT 1 FROM "access_attempts" a WHERE a."passageId" = p."id" AND a."decision" = 'Pendiente')
          RETURNING 1
        ) SELECT count(*)::int AS "affected" FROM affected`,
        params: [
          MASKED_PLATE,
          parseLprPassageWindowSeconds(process.env.LPR_PASSAGE_WINDOW_SECONDS),
        ],
      },
      'affected',
    );
  }

  // --- Usuarios deshabilitados (RETENTION_DISABLED_USERS_DAYS) -------------

  async countDisabledUsersToAnonymize(days: number): Promise<number> {
    return this.number(
      {
        sql: `SELECT count(*)::int AS "count" FROM "user" WHERE ${DISABLED_USERS_WHERE}`,
        params: [days],
      },
      'count',
    );
  }

  async findDisabledUsersToAnonymize(
    days: number,
    limit: number,
    excludeIds: readonly string[],
  ): Promise<DisabledUserRow[]> {
    const rows = rowsOf(
      await this.dataSource.query(
        `SELECT "id" FROM "user" WHERE ${DISABLED_USERS_WHERE} AND NOT ("id" = ANY($2::uuid[])) ORDER BY "deletedAt" LIMIT $3`,
        [days, [...excludeIds], limit],
      ),
    );
    return rows.map((row) => ({ id: requiredString(row.id, 'id') }));
  }

  private async number(
    statement: SqlStatement,
    column: string,
  ): Promise<number> {
    return firstNumber(
      await this.dataSource.query(statement.sql, [...statement.params]),
      column,
    );
  }
}

/** Ejecuta una sentencia y devuelve sus filas (DataSource o EntityManager). */
export type SqlExecutor = (sql: string, params: unknown[]) => Promise<unknown>;

/**
 * Anonimización de detecciones compartida por la retención y la supresión
 * (`ErasureRepository`, dentro de su transacción). Ver
 * `RetentionRepository.anonymizeDetections`. Enmascara también la patente de
 * las pasadas (`vehicle_passages`) de las detecciones anonimizadas, salvo las
 * que siguen dentro de su ventana (`LPR_PASSAGE_WINDOW_SECONDS`).
 */
export async function anonymizeDetectionsWith(
  execute: SqlExecutor,
  ids: readonly string[],
  clearedFrameIds: readonly string[],
  options: { ignorePassageWindow?: boolean } = {},
): Promise<AnonymizedDetections> {
  const [row] = rowsOf(
    await execute(
      `WITH updated AS (
        UPDATE "plate_detections" d
        SET "plate" = $3, "plate_raw" = NULL, "meta" = ${META_WITHOUT_SNAPSHOT_SQL},
            "full_frame_path" = CASE WHEN d."id" = ANY($2::uuid[]) THEN NULL ELSE d."full_frame_path" END,
            "anonymizedAt" = now()
        WHERE d."id" = ANY($1::uuid[]) AND d."anonymizedAt" IS NULL AND NOT ${DETECTION_HAS_PENDING_ATTEMPT_SQL}
        RETURNING d."id", d."passageId", ((d."meta" ->> 'plate_variant_of_passage') IS NOT NULL) AS "isVariant"
      ), passages AS (
        UPDATE "vehicle_passages" p SET "plate" = $3, "anonymizedAt" = now()
        WHERE p."anonymizedAt" IS NULL
          AND ($4::int = 0 OR p."lastSeenAt" < now() - make_interval(secs => $4::int))
          AND p."id" IN (
            SELECT u."passageId" FROM updated u
            -- Supresión ($4 = 0): anonimizar una lectura VARIANTE no enmascara la
            -- pasada, cuya patente puede ser de otra persona. La pasada del
            -- titular se enmascara por sus propias lecturas y por anonymizePassages.
            WHERE u."passageId" IS NOT NULL AND ($4::int > 0 OR NOT u."isVariant")
          )
          -- Supresión: tampoco si quedan lecturas variante por anonimizar (las
          -- de esta misma sentencia no cuentan: ya vienen en updated).
          AND ($4::int > 0 OR NOT EXISTS (
            SELECT 1 FROM "plate_detections" v
            WHERE v."passageId" = p."id" AND v."anonymizedAt" IS NULL
              AND (v."meta" ->> 'plate_variant_of_passage') IS NOT NULL
              AND v."id" NOT IN (SELECT u2."id" FROM updated u2)
          ))
        RETURNING 1
      ), attempts AS (
        UPDATE "access_attempts" a SET "reason" = NULL, "residente_id" = NULL
        FROM updated u WHERE a."detectionId" = u."id"
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM updated)::int AS "detections", (SELECT count(*) FROM attempts)::int AS "accessAttempts"`,
      [
        [...ids],
        [...clearedFrameIds],
        MASKED_PLATE,
        // Retención: una pasada aún dentro de su ventana puede recibir lecturas y
        // no se enmascara. La SUPRESIÓN (derecho del titular) la enmascara
        // siempre (0 = sin excepción de ventana).
        options.ignorePassageWindow
          ? 0
          : parseLprPassageWindowSeconds(
              process.env.LPR_PASSAGE_WINDOW_SECONDS,
            ),
      ],
    ),
  );
  return {
    detections: firstNumber([row], 'detections'),
    accessAttempts: firstNumber([row], 'accessAttempts'),
  };
}

function toDetectionFrameRow(row: Record<string, unknown>): DetectionFrameRow {
  return {
    id: requiredString(row.id, 'id'),
    fullFramePath: stringOrNull(row.fullFramePath),
  };
}
