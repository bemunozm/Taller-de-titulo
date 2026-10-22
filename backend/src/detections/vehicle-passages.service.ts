import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  In,
  IsNull,
  MoreThanOrEqual,
  Raw,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  parseLprPassageFuzzySeconds,
  parseLprPassageOrphanSeconds,
  parseLprPassageReverseMinSeconds,
  parseLprPassageWindowSeconds,
} from '../config/env.validation';
import { errorMessage } from '../common/utils/error-message.util';
import { maskPlate } from '../common/privacy/pii-mask';
import { AccessAttempt } from './entities/access-attempt.entity';
import { REGISTERED_ACCESS_DECISION } from './access-decision';
import { PlateDetection } from './entities/plate-detection.entity';
import {
  differsByOneSubstitution,
  directionsCompatibleForVariant,
} from './plate-variant';
import { VehiclePassage } from './entities/vehicle-passage.entity';
import {
  methodForDirection,
  readDirection,
  shouldUpgradeDirection,
  startsNewPassage,
  type DirectionReading,
  type PassageDirection,
  type PassageDirectionSource,
} from './vehicle-passage-direction';

/** Resumen de la pasada que acompaña la respuesta de `POST /detections/plates`. */
export interface PassageSummary {
  id: string;
  direction: PassageDirection;
  directionSource: PassageDirectionSource;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Lecturas reales de la pasada (puede superar las `sightings` expuestas). */
  sightingCount: number;
}

/** Una lectura (detección) de la pasada, para la trazabilidad. */
export interface PassageSightingView {
  detectionId: string;
  cameraId: string;
  /** ISO 8601 (recepción en el backend). */
  at: string;
  direction: PassageDirection;
  directionSource: PassageDirectionSource;
  full_frame_path: string | null;
  /** Solo si la lectura no tiene un frame https (no se duplica la imagen). */
  snapshot_jpeg_b64: string | null;
}

/** Forma con la que `GET /detections/plates/attempts` expone la pasada de un intento. */
export interface PassageView extends PassageSummary {
  /** Las últimas `MAX_SIGHTINGS_PER_PASSAGE` lecturas, ordenadas por `at`. */
  sightings: PassageSightingView[];
}

/** Intento de acceso con su pasada expandida (`passage: null` si no tiene). */
export type AttemptWithPassage<T extends AccessAttempt = AccessAttempt> = Omit<
  T,
  'passage'
> & { passage: PassageView | null };

/**
 * Resultado de reclamar la pasada de una lectura:
 *  - `leader`: esta petición decide el acceso. O bien se creó una pasada nueva
 *    (o se tomó una huérfana), o bien se PROMOVIÓ una pasada de solo registro
 *    (`promoted`).
 *  - `sighting`: la lectura es evidencia de una pasada abierta. No decide
 *    nada: `attempt` es el intento de la pasada (o `null` si el líder aún no
 *    lo ha guardado).
 */
export type PassageClaim =
  | {
      kind: 'leader';
      detection: PlateDetection;
      passage: VehiclePassage;
      /**
       * `true`: la pasada existía, liderada por una cámara de solo registro, y
       * esta lectura (de una cámara de acceso) la promovió: debe decidir el
       * acceso y actualizar el intento existente.
       */
      promoted: boolean;
    }
  | {
      kind: 'sighting';
      detection: PlateDetection;
      passage: VehiclePassage;
      attempt: AccessAttempt | null;
    };

/** Rol de la cámara que originó la lectura. */
export interface ClaimAccess {
  /** `false` en una cámara de solo registro (`lprSettings.action = register`). */
  decidesAccess: boolean;
}

export interface SaveAttemptOptions {
  /**
   * El intento es la DECISIÓN de acceso (cámara de acceso). Si la pasada ya
   * tiene un intento (`Registrado` de una cámara de solo registro) lo
   * sobrescribe; con `false` (solo registro) nunca pisa un intento existente.
   */
  decidesAccess: boolean;
  /**
   * El `method` del intento sale de la dirección de la pasada (solo registro
   * y residentes). `false` si lo fija otra lógica (visitas, conserje).
   */
  followsDirection: boolean;
  /** `method` cuando la dirección de la pasada es `unknown`. */
  unknownMethod: string;
}

/**
 * Resultado de `saveAttempt`. `written: true` solo si ESTA llamada escribió el
 * intento; con `false` (perdió el liderazgo, o la pasada ya tiene una decisión
 * de acceso) el llamador NO debe abrir, notificar ni tocar visitas: su lectura
 * es evidencia, y `attempt` es el que ya existía (o `null` si aún no hay).
 */
export type SaveAttemptResult =
  | { written: true; attempt: AccessAttempt }
  | { written: false; attempt: AccessAttempt | null };

/** Fila de lectura de `loadViews`. */
interface SightingRow {
  id: string;
  passageId: string;
  cameraId: string;
  createdAt: Date | string;
  full_frame_path: string | null;
  direction: string | null;
  source: string | null;
  snapshot: string | null;
}

/** Máximo de lecturas por pasada que se exponen en la trazabilidad. */
export const MAX_SIGHTINGS_PER_PASSAGE = 10;

/** Cuántas pasadas abiertas se consideran al buscar una compatible. */
const OPEN_PASSAGES_CONSIDERED = 5;
/** Cuántas pasadas recientes del condominio se traen al buscar una variante. */
const FUZZY_CANDIDATES_CONSIDERED = 20;
const LOCK_NAMESPACE = 'vigilia.lpr.passage:';
/**
 * Segunda clave del lock a nivel de condominio de la búsqueda difusa. Lleva
 * `~`, que una patente normalizada (alfanumérica) nunca contiene: no puede
 * coincidir con la clave de ninguna patente.
 */
const FUZZY_LOCK_KEY = '~fuzzy';

/**
 * Pasadas de vehículos (plan dirección + pasadas multicámara, E6).
 *
 * Garantía central: para una misma (condominio, patente) las decisiones de
 * "¿esta lectura es una pasada nueva?" se SERIALIZAN con
 * `pg_advisory_xact_lock(hashtext(condominio), hashtext(patente))`. Dos
 * peticiones concurrentes de la misma patente no pueden crear dos pasadas:
 * la primera crea la pasada y confirma; la segunda espera el lock, ve la
 * pasada ya confirmada (READ COMMITTED) y queda como evidencia. Solo la
 * primera (el "líder") crea el intento, notifica y abre el portón.
 *
 * El lock cubre únicamente la decisión de reclamo (unas pocas consultas
 * indexadas) y el guardado del intento; el flujo lento (búsqueda de
 * vehículo/visita, notificaciones, apertura) corre FUERA de él. Dos claves
 * `int4` (condominio, patente) en vez de un solo `bigint`: otros condominios
 * nunca comparten clave y una colisión de hash solo serializa de más, jamás
 * deja pasar dos aperturas.
 *
 * Variantes de OCR (lecturas de la misma patente con UN carácter distinto
 * entre cámaras): la búsqueda cruza patentes, así que el lock por patente no
 * basta. ORDEN DE LOCKS (único en todo el servicio): 1) lock de condominio de
 * la búsqueda difusa (`hashtext(condominio), hashtext('~fuzzy')`), 2) lock de
 * la patente entrante y 3) solo si hay una variante candidata, lock de la
 * patente DESTINO (y se relee la pasada). Solo `claim` toma el de condominio
 * y puede tener dos de patente a la vez, y como todas las `claim` se
 * serializan por el de condominio, entre ellas no hay ciclos. `saveAttempt`,
 * `release` y `demote` toman un único lock de patente y nunca esperan otro
 * advisory lock, así que una `claim` que espera la patente destino solo espera
 * a que esas transacciones terminen. La lectura exacta y su variante se
 * serializan: la segunda ve la pasada que la primera confirmó. Solo una cámara
 * de solo registro puede sumarse como variante.
 */
@Injectable()
export class VehiclePassagesService {
  private readonly logger = new Logger(VehiclePassagesService.name);
  private readonly windowMs: number;
  private readonly reverseMinMs: number;
  private readonly orphanMs: number;
  /** 0 = búsqueda de variantes desactivada. */
  private readonly fuzzyMs: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.windowMs =
      parseLprPassageWindowSeconds(
        configService.get<string>('LPR_PASSAGE_WINDOW_SECONDS'),
      ) * 1000;
    this.reverseMinMs =
      parseLprPassageReverseMinSeconds(
        configService.get<string>('LPR_PASSAGE_REVERSE_MIN_SECONDS'),
      ) * 1000;
    this.orphanMs =
      parseLprPassageOrphanSeconds(
        configService.get<string>('LPR_PASSAGE_ORPHAN_SECONDS'),
      ) * 1000;
    this.fuzzyMs = Math.min(
      parseLprPassageFuzzySeconds(
        configService.get<string>('LPR_PASSAGE_FUZZY_SECONDS'),
      ) * 1000,
      this.windowMs,
    );
  }

  /**
   * Guarda la detección y la enlaza a una pasada: la abierta compatible o
   * una nueva (ver `PassageClaim`). Todo en una transacción bajo el lock.
   *
   * Sobre una pasada abierta compatible, la lectura puede además TOMAR EL
   * LIDERAZGO (con un UPDATE condicional bajo el lock, así que solo una gana):
   *  - promoción: la pasada la lidera una cámara de solo registro y la lectura
   *    viene de una de acceso;
   *  - pasada huérfana: sin intento y con el líder tomado hace más de
   *    `LPR_PASSAGE_ORPHAN_SECONDS` (el líder cayó o se colgó).
   */
  async claim(
    detection: PlateDetection,
    reading: DirectionReading,
    access: ClaimAccess,
  ): Promise<PassageClaim> {
    const organizationId = detection.organizationId;
    if (!organizationId) {
      throw new Error('La detección no tiene condominio: no se puede agrupar');
    }
    return this.dataSource.transaction(async (manager) => {
      // Orden de locks: condominio (difuso) y luego patente. Ver la doc de la clase.
      if (this.fuzzyMs > 0) {
        await this.lockFuzzy(manager, organizationId);
      }
      await this.lock(manager, organizationId, detection.plate);
      const now = new Date();
      const open = await this.findCompatibleOpenPassage(
        manager,
        organizationId,
        detection.plate,
        now,
        reading,
      );
      if (!open) {
        const variant = await this.findVariantPassage(
          manager,
          organizationId,
          detection,
          now,
          reading,
          access,
        );
        if (variant) {
          // Variante de OCR de una pasada abierta: evidencia pura (sin toma de
          // liderazgo, intento, notificación ni apertura, y sin tocar la
          // dirección de la pasada). Se guarda el id de la pasada y no su
          // patente: no replica una patente en `meta`, que la retención no
          // enmascara.
          detection.meta = {
            ...(detection.meta ?? {}),
            plate_variant_of_passage: variant.id,
          };
          const touched = await this.addVariantSighting(
            manager,
            variant,
            detection,
            now,
          );
          return { kind: 'sighting', ...touched };
        }
        const passage = await manager.save(
          VehiclePassage,
          manager.create(VehiclePassage, {
            organizationId,
            plate: detection.plate,
            direction: reading.direction,
            directionSource: reading.source,
            firstSeenAt: now,
            lastSeenAt: now,
            leaderClaimedAt: now,
            leaderToken: randomUUID(),
            sightingCount: 1,
            decidesAccess: access.decidesAccess,
            methodFollowsDirection: false,
          }),
        );
        detection.passageId = passage.id;
        const saved = await manager.save(PlateDetection, detection);
        return { kind: 'leader', detection: saved, passage, promoted: false };
      }
      const leaderToken = randomUUID();
      const takeover = await this.takeLeadership(
        manager,
        open,
        access,
        now,
        leaderToken,
      );
      const touched = await this.addSighting(
        manager,
        open,
        detection,
        reading,
        now,
      );
      if (takeover) {
        return {
          kind: 'leader',
          detection: touched.detection,
          passage: {
            ...touched.passage,
            decidesAccess:
              takeover === 'promoted' ? true : access.decidesAccess,
            leaderClaimedAt: now,
            leaderToken,
          },
          promoted: takeover === 'promoted',
        };
      }
      return { kind: 'sighting', ...touched };
    });
  }

  /**
   * Guarda el intento de la pasada bajo el mismo lock que `claim`. Solo escribe
   * el LÍDER VIGENTE (`passage.leaderToken` debe seguir siendo el de la pasada
   * en la BD): un líder lento que ya perdió la pasada (huérfana tomada por
   * otra lectura, promoción) devuelve `written: false` y no abre nada.
   *  - sin intento: lo inserta;
   *  - con intento `Registrado` y decisión de acceso (promoción): lo ACTUALIZA;
   *  - cualquier otro caso (el intento ya tiene una decisión de acceso, o es
   *    una cámara de solo registro): no escribe.
   * Así una pasada nunca tiene dos intentos ni dos decisiones.
   */
  async saveAttempt(
    attempt: AccessAttempt,
    passage: VehiclePassage,
    options: SaveAttemptOptions,
  ): Promise<SaveAttemptResult> {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, passage.organizationId, passage.plate);
      const current = await manager.findOne(VehiclePassage, {
        where: { id: passage.id },
      });
      if (!current) {
        throw new Error(`La pasada ${passage.id} ya no existe`);
      }
      const existing = await manager.findOne(AccessAttempt, {
        where: { passageId: current.id },
      });
      if (current.leaderToken !== passage.leaderToken) {
        return { attempt: existing, written: false };
      }
      const promotion =
        existing !== null &&
        options.decidesAccess &&
        existing.decision === REGISTERED_ACCESS_DECISION;
      if (existing && !promotion) {
        return { attempt: existing, written: false };
      }
      attempt.passageId = current.id;
      if (options.followsDirection) {
        attempt.method = methodForDirection(
          current.direction,
          options.unknownMethod,
        );
      }
      let saved: AccessAttempt;
      if (existing) {
        Object.assign(existing, {
          decision: attempt.decision,
          reason: attempt.reason,
          method: attempt.method,
          residente: attempt.residente ?? null,
          responseTimeMs: attempt.responseTimeMs,
          expiresAt: attempt.expiresAt ?? null,
          respondedBy: null,
          respondedAt: null,
        });
        saved = await manager.save(AccessAttempt, existing);
      } else {
        saved = await manager.save(AccessAttempt, attempt);
      }
      if (current.methodFollowsDirection !== options.followsDirection) {
        await manager.update(
          VehiclePassage,
          { id: current.id },
          { methodFollowsDirection: options.followsDirection },
        );
      }
      return { attempt: saved, written: true };
    });
  }

  /**
   * Compensación: si el líder falló antes de guardar su intento, descarta la
   * pasada para que la próxima lectura vuelva a decidir (si no, quedaría
   * "ocupada" sin intento durante toda la ventana). No toca una pasada que
   * ya tiene intento ni una que otro líder ya tomó (token distinto). Mejor
   * esfuerzo: nunca lanza.
   */
  async release(passage: VehiclePassage): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.lock(manager, passage.organizationId, passage.plate);
        await manager.query(
          `DELETE FROM "vehicle_passages" p WHERE p."id" = $1 AND p."leaderToken" = $2 AND NOT EXISTS (SELECT 1 FROM "access_attempts" a WHERE a."passageId" = p."id")`,
          [passage.id, passage.leaderToken],
        );
      });
    } catch (error) {
      this.logger.error(
        `No se pudo liberar la pasada ${passage.id} (${maskPlate(passage.plate)}): ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Compensación de una PROMOCIÓN fallida: la pasada vuelve a ser de solo
   * registro (su intento `Registrado` queda intacto) y otra cámara de acceso
   * puede promoverla. Mejor esfuerzo: nunca lanza.
   */
  async demote(passage: VehiclePassage): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.lock(manager, passage.organizationId, passage.plate);
        await manager.update(
          VehiclePassage,
          {
            id: passage.id,
            decidesAccess: true,
            leaderToken: passage.leaderToken,
          },
          { decidesAccess: false },
        );
      });
    } catch (error) {
      this.logger.error(
        `No se pudo revertir la promoción de la pasada ${passage.id} (${maskPlate(passage.plate)}): ${errorMessage(error)}`,
      );
    }
  }

  /** Resumen de una pasada para la respuesta de la ingesta. */
  summarize(passage: VehiclePassage): PassageSummary {
    return {
      id: passage.id,
      direction: passage.direction,
      directionSource: passage.directionSource,
      firstSeenAt: passage.firstSeenAt.toISOString(),
      lastSeenAt: passage.lastSeenAt.toISOString(),
      sightingCount: passage.sightingCount,
    };
  }

  /**
   * Adjunta `passage` (con sus últimas lecturas, ordenadas por `at`) a cada
   * intento que pertenece a una pasada; `null` para los demás. Dos consultas
   * en total (pasadas + lecturas), sin importar cuántos intentos haya.
   */
  async attachPassages<T extends AccessAttempt>(
    attempts: readonly T[],
  ): Promise<Array<AttemptWithPassage<T>>> {
    const ids = [
      ...new Set(
        attempts
          .map((attempt) => attempt.passageId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const views =
      ids.length > 0
        ? await this.loadViews(ids)
        : new Map<string, PassageView>();
    return attempts.map((attempt) => ({
      ...attempt,
      passage: (attempt.passageId && views.get(attempt.passageId)) || null,
    }));
  }

  private async loadViews(ids: string[]): Promise<Map<string, PassageView>> {
    const [passages, rows] = await Promise.all([
      this.dataSource.getRepository(VehiclePassage).find({
        where: { id: In(ids) },
      }),
      // Últimas N lecturas por pasada. La dirección sale de `meta` sin traer el
      // JSON entero, y el recorte base64 solo si la lectura no tiene un frame
      // https (no se duplica la imagen que el frontend ya puede cargar).
      this.dataSource.query<SightingRow[]>(
        `SELECT r."id", r."passageId", r."cameraId", r."createdAt", r."full_frame_path", r."direction", r."source", r."snapshot"
         FROM (
           SELECT d."id", d."passageId", d."cameraId", d."createdAt", d."full_frame_path",
                  d."meta" ->> 'direction' AS "direction",
                  d."meta" ->> 'direction_source' AS "source",
                  CASE WHEN d."full_frame_path" ~* '^https://' THEN NULL ELSE d."meta" ->> 'snapshot_jpeg_b64' END AS "snapshot",
                  row_number() OVER (PARTITION BY d."passageId" ORDER BY d."createdAt" DESC, d."id" DESC) AS "rn"
           FROM "plate_detections" d
           WHERE d."passageId" = ANY($1::uuid[])
         ) r
         WHERE r."rn" <= $2
         ORDER BY r."createdAt" ASC, r."id" ASC`,
        [ids, MAX_SIGHTINGS_PER_PASSAGE],
      ),
    ]);
    const sightings = new Map<string, PassageSightingView[]>();
    for (const row of rows) {
      const list = sightings.get(row.passageId) ?? [];
      list.push(this.toSighting(row));
      sightings.set(row.passageId, list);
    }
    return new Map(
      passages.map((passage) => [
        passage.id,
        {
          ...this.summarize(passage),
          sightings: sightings.get(passage.id) ?? [],
        },
      ]),
    );
  }

  private toSighting(row: SightingRow): PassageSightingView {
    const reading = readDirection(
      row.direction as PassageDirection | null,
      row.source as PassageDirectionSource | null,
    );
    return {
      detectionId: row.id,
      cameraId: row.cameraId,
      at: new Date(row.createdAt).toISOString(),
      direction: reading.direction,
      directionSource: reading.source,
      full_frame_path: row.full_frame_path ?? null,
      snapshot_jpeg_b64: row.snapshot ?? null,
    };
  }

  private async lock(
    manager: EntityManager,
    organizationId: string,
    plate: string,
  ): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [`${LOCK_NAMESPACE}${organizationId}`, plate],
    );
  }

  private async lockFuzzy(
    manager: EntityManager,
    organizationId: string,
  ): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [`${LOCK_NAMESPACE}${organizationId}`, FUZZY_LOCK_KEY],
    );
  }

  /**
   * Pasada abierta de OTRA patente que esta lectura puede sumar como variante
   * de OCR (ver la doc de la clase). Corre bajo el lock del condominio y el de
   * la patente entrante.
   *
   * SOLO una cámara de solo registro puede sumarse como variante: una cámara
   * de acceso nunca (su lectura debe poder decidir por sí misma; si la
   * primera lectura era errónea y se denegó, la correcta aún debe abrir).
   *
   * Candidatas: mismo condominio, última lectura dentro de
   * `LPR_PASSAGE_FUZZY_SECONDS`, mismo largo, patente distinta y sin
   * enmascarar; de ahí, las que difieren en un carácter y tienen dirección
   * compatible. Si hay candidatas de patentes DISTINTAS es ambiguo y no se
   * agrupa. Tampoco se agrupa si la cámara entrante ya tiene lecturas en esa
   * pasada (una variante en la misma cámara es otro auto).
   *
   * Elegida la candidata se toma el lock de SU patente y se relee la pasada
   * (puede haberse anonimizado, vencido o cambiado de dirección mientras se
   * esperaba): si ya no cumple, camino normal.
   */
  private async findVariantPassage(
    manager: EntityManager,
    organizationId: string,
    detection: PlateDetection,
    now: Date,
    incoming: DirectionReading,
    access: ClaimAccess,
  ): Promise<VehiclePassage | null> {
    if (this.fuzzyMs <= 0 || access.decidesAccess) {
      return null;
    }
    const since = new Date(now.getTime() - this.fuzzyMs);
    const candidates = await manager.find(VehiclePassage, {
      where: {
        organizationId,
        lastSeenAt: MoreThanOrEqual(since),
        anonymizedAt: IsNull(),
        // Misma longitud y patente distinta, filtrado en SQL; la distancia de
        // Hamming se resuelve en TypeScript sobre un puñado de filas.
        plate: Raw(
          (column) => `${column} <> :plate AND length(${column}) = :length`,
          {
            plate: detection.plate,
            length: detection.plate.length,
          },
        ),
      },
      order: { lastSeenAt: 'DESC' },
      take: FUZZY_CANDIDATES_CONSIDERED,
    });
    const matches = candidates.filter((passage) =>
      this.isVariantOf(passage, detection.plate, incoming, since),
    );
    const [best] = matches;
    if (!best || matches.some((match) => match.plate !== best.plate)) {
      return null;
    }
    // Lock de la patente destino (orden: condominio -> entrante -> destino) y
    // relectura: lo decidido arriba pudo cambiar mientras se esperaba.
    await this.lock(manager, organizationId, best.plate);
    const fresh = await manager.findOne(VehiclePassage, {
      where: { id: best.id, organizationId },
    });
    if (!fresh || !this.isVariantOf(fresh, detection.plate, incoming, since)) {
      return null;
    }
    // Misma cámara que ya leyó la pasada: las variantes de un mismo auto en una
    // cámara las resuelve el voto por vehículo del worker; aquí sería otro auto.
    const sameCamera = await manager.exists(PlateDetection, {
      where: { passageId: fresh.id, cameraId: detection.cameraId },
    });
    return sameCamera ? null : fresh;
  }

  /** ¿`passage` sigue abierta, sin enmascarar y es variante compatible de `plate`? */
  private isVariantOf(
    passage: VehiclePassage,
    plate: string,
    incoming: DirectionReading,
    since: Date,
  ): boolean {
    return (
      !passage.anonymizedAt &&
      passage.lastSeenAt.getTime() >= since.getTime() &&
      differsByOneSubstitution(passage.plate, plate) &&
      directionsCompatibleForVariant(
        readDirection(passage.direction, passage.directionSource).direction,
        incoming.direction,
      )
    );
  }

  /**
   * Suma una variante de OCR a la pasada: solo cuenta y enlaza (`sightingCount`,
   * `lastSeenAt`, `passageId`). NO cambia la dirección de la pasada ni el
   * `method` del intento: una variante no es la fuente autorizada de nada.
   */
  private async addVariantSighting(
    manager: EntityManager,
    open: VehiclePassage,
    detection: PlateDetection,
    now: Date,
  ): Promise<{
    detection: PlateDetection;
    passage: VehiclePassage;
    attempt: AccessAttempt | null;
  }> {
    await manager.update(
      VehiclePassage,
      { id: open.id },
      { lastSeenAt: now, sightingCount: () => '"sightingCount" + 1' },
    );
    detection.passageId = open.id;
    const saved = await manager.save(PlateDetection, detection);
    const attempt = await manager.findOne(AccessAttempt, {
      where: { passageId: open.id },
    });
    return {
      detection: saved,
      passage: {
        ...open,
        lastSeenAt: now,
        sightingCount: open.sightingCount + 1,
      },
      attempt,
    };
  }

  /**
   * La pasada abierta más reciente que la lectura NO contradice con una
   * dirección por línea (y tras la brecha mínima de reversa).
   */
  private async findCompatibleOpenPassage(
    manager: EntityManager,
    organizationId: string,
    plate: string,
    now: Date,
    incoming: DirectionReading,
  ): Promise<VehiclePassage | null> {
    const since = new Date(now.getTime() - this.windowMs);
    const open = await manager.find(VehiclePassage, {
      where: { organizationId, plate, lastSeenAt: MoreThanOrEqual(since) },
      order: { lastSeenAt: 'DESC' },
      take: OPEN_PASSAGES_CONSIDERED,
    });
    return (
      open.find(
        (passage) =>
          !startsNewPassage(
            readDirection(passage.direction, passage.directionSource),
            incoming,
            now.getTime() - passage.firstSeenAt.getTime(),
            this.reverseMinMs,
          ),
      ) ?? null
    );
  }

  /**
   * ¿Esta lectura toma el liderazgo de la pasada abierta? UPDATE condicional
   * bajo el lock: si dos lecturas compiten, solo una afecta la fila.
   *  - `orphan`: la pasada no tiene intento y su líder la tomó hace más de
   *    `orphanMs`;
   *  - `promoted`: la lectura es de una cámara de acceso y la pasada la lidera
   *    una de solo registro (`decidesAccess = false`).
   */
  private async takeLeadership(
    manager: EntityManager,
    open: VehiclePassage,
    access: ClaimAccess,
    now: Date,
    leaderToken: string,
  ): Promise<'orphan' | 'promoted' | null> {
    const orphanCutoff = now.getTime() - this.orphanMs;
    if (open.leaderClaimedAt.getTime() <= orphanCutoff) {
      const hasAttempt = await manager.exists(AccessAttempt, {
        where: { passageId: open.id },
      });
      if (!hasAttempt) {
        await manager.update(
          VehiclePassage,
          { id: open.id },
          {
            leaderClaimedAt: now,
            leaderToken,
            decidesAccess: access.decidesAccess,
          },
        );
        return 'orphan';
      }
    }
    if (access.decidesAccess && !open.decidesAccess) {
      const result = await manager.update(
        VehiclePassage,
        { id: open.id, decidesAccess: false },
        { decidesAccess: true, leaderClaimedAt: now, leaderToken },
      );
      if (result.affected) {
        return 'promoted';
      }
    }
    return null;
  }

  /** Suma la lectura a la pasada (contador, ventana, dirección) y la guarda. */
  private async addSighting(
    manager: EntityManager,
    open: VehiclePassage,
    detection: PlateDetection,
    reading: DirectionReading,
    now: Date,
  ): Promise<{
    detection: PlateDetection;
    passage: VehiclePassage;
    attempt: AccessAttempt | null;
  }> {
    const upgrade = shouldUpgradeDirection(
      readDirection(open.direction, open.directionSource),
      reading,
    );
    const patch: QueryDeepPartialEntity<VehiclePassage> = {
      lastSeenAt: now,
      sightingCount: () => '"sightingCount" + 1',
    };
    if (upgrade) {
      patch.direction = reading.direction;
      patch.directionSource = reading.source;
    }
    await manager.update(VehiclePassage, { id: open.id }, patch);
    if (upgrade && open.methodFollowsDirection) {
      await manager.update(
        AccessAttempt,
        { passageId: open.id },
        { method: methodForDirection(reading.direction, '') },
      );
    }
    detection.passageId = open.id;
    const saved = await manager.save(PlateDetection, detection);
    const attempt = await manager.findOne(AccessAttempt, {
      where: { passageId: open.id },
    });
    const passage: VehiclePassage = {
      ...open,
      lastSeenAt: now,
      sightingCount: open.sightingCount + 1,
      direction: upgrade ? reading.direction : open.direction,
      directionSource: upgrade ? reading.source : open.directionSource,
    };
    return { detection: saved, passage, attempt };
  }
}
