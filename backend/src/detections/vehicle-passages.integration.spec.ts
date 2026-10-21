import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DataSource, type Repository } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import {
  buildTypeOrmOptions,
  readerFromEnv,
} from '../database/typeorm-options';
import { DetectionsService } from './detections.service';
import { VehiclePassagesService } from './vehicle-passages.service';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { VehiclePassage } from './entities/vehicle-passage.entity';
import type { Camera } from '../cameras/entities/camera.entity';
import type { LprSettings } from '../cameras/lpr-settings';
import type { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import type { VehiclesService } from '../vehicles/vehicles.service';
import type { VisitsService } from '../visits/visits.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { UsersService } from '../users/users.service';
import type { HubGateway } from '../hub/hub.gateway';
import type { Vehicle } from '../vehicles/entities/vehicle.entity';
import { VisitStatus, type Visit } from '../visits/entities/visit.entity';
import {
  anonymizeDetectionsWith,
  DETECTION_HAS_PENDING_ATTEMPT_SQL,
  RetentionRepository,
} from '../privacy/retention.repository';
import { createErasureTransaction } from '../privacy/erasure.repository';
import { plateKey } from '../privacy/privacy-identifiers';

/**
 * Pasadas contra un Postgres REAL (advisory lock, índice único parcial,
 * FKs, SQL de retención). Se salta sin `PASSAGES_IT_DB`: apunta a una BD
 * TEMPORAL con las migraciones aplicadas (`node scripts/gate-db.cjs create` +
 * `npm run migration:run` con `DB_NAME` de esa BD). Nunca a la de desarrollo.
 * Los e2e (`test/e2e/lpr-passages.e2e-spec.ts`) cubren lo mismo por HTTP en el
 * gate; este archivo permite probarlo en caliente, sin compilar ni levantar
 * la app.
 *
 * Cada cámara tiene su propia `lprSettings` (ver `settingsFor`):
 *  - `cam-*`     acceso, con línea de dirección;
 *  - `reg-*`     solo registro, con línea de dirección;
 *  - `fixed-in` / `fixed-out`  acceso con dirección FIJA entrada / salida;
 *  - `reg-fixed-out`  solo registro con dirección fija de salida;
 *  - `no-line`   acceso SIN línea (su `direction_source: line` no se respalda).
 */
const databaseName = process.env.PASSAGES_IT_DB;
const suite = databaseName ? describe : describe.skip;

const noConfig = { get: () => undefined } as unknown as ConfigService;

const LINE = {
  from: { x: 0.1, y: 0.5 },
  to: { x: 0.9, y: 0.5 },
  exitSide: 'left',
} as const;

function settingsFor(cameraId: string): LprSettings {
  if (cameraId === 'reg-fixed-out') {
    return { action: 'register', direction: 'exit' };
  }
  if (cameraId.startsWith('reg')) {
    return { action: 'register', directionLine: LINE };
  }
  if (cameraId === 'fixed-in') return { direction: 'entry' };
  if (cameraId === 'fixed-out') return { direction: 'exit' };
  if (cameraId === 'no-line') return {};
  return { directionLine: LINE };
}

suite('Pasadas de vehículos (Postgres real)', () => {
  let dataSource: DataSource;
  let detections: Repository<PlateDetection>;
  let attempts: Repository<AccessAttempt>;
  let passagesRepo: Repository<VehiclePassage>;

  let orgId: string;
  let plate: string;
  let vehicle: Vehicle | null;
  let findByPlate: jest.Mock;
  let validateAccess: jest.Mock;
  let checkOut: jest.Mock;
  let sendDoorOpen: jest.Mock;
  let notify: jest.Mock;
  let service: DetectionsService;
  let passages: VehiclePassagesService;
  let hostIds: string[];

  beforeAll(async () => {
    const options = buildTypeOrmOptions(
      readerFromEnv({ ...process.env, DB_NAME: databaseName }),
    );
    dataSource = new DataSource(options);
    await dataSource.initialize();
    detections = dataSource.getRepository(PlateDetection);
    attempts = dataSource.getRepository(AccessAttempt);
    passagesRepo = dataSource.getRepository(VehiclePassage);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(() => {
    orgId = randomUUID();
    hostIds = [];
    plate = `T${randomUUID()
      .replace(/[^0-9A-F]/gi, '')
      .slice(0, 5)
      .toUpperCase()}`;
    vehicle = {
      id: randomUUID(),
      active: true,
      accessLevel: 'residente',
      ownerId: randomUUID(),
      owner: null,
    } as unknown as Vehicle;
    findByPlate = jest.fn(() => Promise.resolve(vehicle));
    validateAccess = jest
      .fn()
      .mockResolvedValue({ valid: false, message: 'sin visita' });
    checkOut = jest.fn().mockResolvedValue(undefined);
    sendDoorOpen = jest.fn().mockReturnValue(1);
    notify = jest.fn().mockResolvedValue([]);
    passages = new VehiclePassagesService(dataSource, noConfig);
    service = new DetectionsService(
      detections,
      attempts,
      {
        findOne: jest.fn(
          ({ where }: { where: { mountPath?: string; id?: string } }) =>
            Promise.resolve({
              id: randomUUID(),
              organizationId: orgId,
              lprSettings: settingsFor(where.mountPath ?? where.id ?? ''),
            }),
        ),
      } as unknown as Repository<Camera>,
      { findByPlate } as unknown as VehiclesService,
      {
        notifyByRoleForOrganization: notify,
      } as unknown as NotificationsService,
      {
        isActiveMemberOfOrganization: jest.fn().mockResolvedValue(true),
      } as unknown as UsersService,
      { sendDoorOpen } as unknown as HubGateway,
      { validateAccess, checkOut } as unknown as VisitsService,
      noConfig,
      passages,
    );
  });

  afterEach(async () => {
    // Orden por FK: intentos -> detecciones -> pasadas.
    await dataSource.query(
      `DELETE FROM "access_attempts" WHERE "organizationId" = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM "plate_detections" WHERE "organizationId" = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM "vehicle_passages" WHERE "organizationId" = $1`,
      [orgId],
    );
    if (hostIds.length > 0) {
      await dataSource.query(
        `DELETE FROM "user" WHERE "id" = ANY($1::uuid[])`,
        [hostIds],
      );
    }
  });

  function read(
    cameraId: string,
    direction?: 'entry' | 'exit' | 'unknown',
    source?: 'camera' | 'line' | 'motion' | 'width' | 'none',
    extra: Partial<NonNullable<CreatePlateDetectionDto['meta']>> = {},
  ): CreatePlateDetectionDto {
    return {
      cameraId,
      plate,
      meta: direction
        ? { direction, direction_source: source, ...extra }
        : undefined,
    };
  }

  const count = async (table: string): Promise<number> => {
    const [row] = await dataSource.query<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "${table}" WHERE "organizationId" = $1`,
      [orgId],
    );
    return row.n;
  };

  const sql = (statement: string): Promise<unknown> =>
    dataSource.query(statement, [orgId]);

  const onlyPassage = async (): Promise<VehiclePassage> => {
    const [passage] = await passagesRepo.find({
      where: { organizationId: orgId },
    });
    return passage;
  };

  const allAttempts = (): Promise<AccessAttempt[]> =>
    attempts.find({ where: { organizationId: orgId } });

  describe('concurrencia: una sola apertura', () => {
    it('10 POST simultáneos de un residente (misma cámara y varias) -> 1 pasada, 1 intento, 1 apertura', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          service.createDetection(read(`cam-${i % 3}`, 'entry', 'line'), orgId),
        ),
      );

      expect(await count('vehicle_passages')).toBe(1);
      expect(await count('access_attempts')).toBe(1);
      expect(await count('plate_detections')).toBe(10);
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(findByPlate).toHaveBeenCalledTimes(1);

      const deduplicated = results.filter(
        (r) => 'deduplicated' in r && r.deduplicated,
      );
      expect(deduplicated).toHaveLength(9);
      const passage = await onlyPassage();
      expect(passage.sightingCount).toBe(10);
      const linked = await detections.count({
        where: { passageId: passage.id },
      });
      expect(linked).toBe(10);
    });

    it('dos conserjes: patente desconocida concurrente -> un solo Pendiente y una sola notificación', async () => {
      vehicle = null;

      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          service.createDetection(read(`cam-${i}`, 'unknown', 'none'), orgId),
        ),
      );

      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0].decision).toBe('Pendiente');
      expect(notify).toHaveBeenCalledTimes(1);
      expect(sendDoorOpen).not.toHaveBeenCalled();
    });

    it('cámaras de solo registro: 6 lecturas simultáneas -> un único intento Registrado', async () => {
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          service.createDetection(read(`reg-${i}`, 'exit', 'line'), orgId),
        ),
      );

      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        decision: 'Registrado',
        method: 'Patente - Salida',
      });
      expect(findByPlate).not.toHaveBeenCalled();
      expect(sendDoorOpen).not.toHaveBeenCalled();
    });

    it('dos patentes distintas no se bloquean ni se mezclan', async () => {
      const other = `U${plate.slice(1)}`;
      await Promise.all([
        service.createDetection(read('cam-1', 'entry', 'line'), orgId),
        service.createDetection(
          { cameraId: 'cam-1', plate: other, meta: { direction: 'entry' } },
          orgId,
        ),
      ]);

      expect(await count('vehicle_passages')).toBe(2);
      expect(await count('access_attempts')).toBe(2);
      expect(sendDoorOpen).toHaveBeenCalledTimes(2);
    });
  });

  describe('agrupación', () => {
    it('misma patente en otra cámara dentro de la ventana: evidencia, sin notificar ni abrir', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      sendDoorOpen.mockClear();
      notify.mockClear();

      const second = await service.createDetection(
        read('cam-b', 'entry', 'line'),
        orgId,
      );

      expect(second).toMatchObject({ deduplicated: true });
      expect(await count('access_attempts')).toBe(1);
      expect(sendDoorOpen).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      expect(findByPlate).toHaveBeenCalledTimes(1);
    });

    it('ventana deslizante: cada lectura renueva la ventana; vencida abre una pasada nueva', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      const age = (seconds: number) =>
        sql(
          `UPDATE "vehicle_passages" SET "lastSeenAt" = now() - interval '${seconds} seconds' WHERE "organizationId" = $1`,
        );
      await age(50);
      await service.createDetection(read('cam-b', 'entry', 'line'), orgId);
      expect(await count('vehicle_passages')).toBe(1);

      await age(50);
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      expect(await count('vehicle_passages')).toBe(1);

      await age(61);
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      expect(await count('vehicle_passages')).toBe(2);
      expect(await count('access_attempts')).toBe(2);
      expect(sendDoorOpen).toHaveBeenCalledTimes(2);
    });

    it('dirección opuesta por LÍNEA, pasada la brecha mínima de reversa: pasada nueva', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      await sql(
        `UPDATE "vehicle_passages" SET "firstSeenAt" = now() - interval '20 seconds' WHERE "organizationId" = $1`,
      );
      await service.createDetection(read('cam-b', 'exit', 'line'), orgId);

      expect(await count('vehicle_passages')).toBe(2);
      const methods = (await allAttempts()).map((a) => a.method).sort();
      expect(methods).toEqual(['Patente - Entrada', 'Patente - Salida']);
      expect(sendDoorOpen).toHaveBeenCalledTimes(2);
    });

    it('dirección opuesta por línea ANTES de la brecha mínima: evidencia (un cruce espurio no abre dos veces)', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      await service.createDetection(read('cam-b', 'exit', 'line'), orgId);

      expect(await count('vehicle_passages')).toBe(1);
      expect(await count('access_attempts')).toBe(1);
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
    });

    it('cámaras FIJAS de entrada y de salida: el auto que entra y es visto por la de salida NO genera otra pasada ni otra apertura', async () => {
      await service.createDetection(read('fixed-in', 'entry', 'camera'), orgId);
      await sql(
        `UPDATE "vehicle_passages" SET "firstSeenAt" = now() - interval '40 seconds' WHERE "organizationId" = $1`,
      );
      await service.createDetection(read('fixed-out', 'exit', 'camera'), orgId);

      expect(await count('vehicle_passages')).toBe(1);
      expect(await count('access_attempts')).toBe(1);
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
      const [attempt] = await allAttempts();
      expect(attempt.method).toBe('Patente - Entrada');
    });

    it('una fuente declarada sin respaldo en la cámara baja a width y no parte la pasada', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      await sql(
        `UPDATE "vehicle_passages" SET "firstSeenAt" = now() - interval '40 seconds' WHERE "organizationId" = $1`,
      );
      // `no-line` no tiene directionLine; `cam-a` no tiene dirección fija.
      await service.createDetection(read('no-line', 'exit', 'line'), orgId);
      await service.createDetection(read('cam-a', 'exit', 'camera'), orgId);

      expect(await count('vehicle_passages')).toBe(1);
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
      const stored = await detections.find({
        where: { organizationId: orgId },
      });
      // La detección guarda la fuente EFECTIVA (la que ve la trazabilidad) y,
      // aparte, lo que declaró el worker cuando difiere.
      expect(stored.map((d) => d.meta?.direction_source).sort()).toEqual([
        'line',
        'width',
        'width',
      ]);
      expect(
        stored.map((d) => d.meta?.direction_source_declared ?? null).sort(),
      ).toEqual(['camera', 'line', null]);
      const [attempt] = await allAttempts();
      const [view] = await passages.attachPassages([attempt]);
      expect(
        (view.passage?.sightings ?? []).map((x) => x.directionSource).sort(),
      ).toEqual(['line', 'width', 'width']);
    });

    it('una dirección opuesta pero débil NO abre pasada nueva (evidencia)', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      await service.createDetection(read('cam-b', 'exit', 'width'), orgId);
      await service.createDetection(read('cam-b', 'exit', 'motion'), orgId);

      expect(await count('vehicle_passages')).toBe(1);
      expect(await count('access_attempts')).toBe(1);
    });

    it('si la pasada abierta solo tiene una dirección débil, la fuerte la corrige en vez de duplicarla', async () => {
      await service.createDetection(read('reg-a', 'entry', 'width'), orgId);
      await sql(
        `UPDATE "vehicle_passages" SET "firstSeenAt" = now() - interval '40 seconds' WHERE "organizationId" = $1`,
      );
      await service.createDetection(read('reg-b', 'exit', 'line'), orgId);

      expect(await count('vehicle_passages')).toBe(1);
      const [attempt] = await allAttempts();
      expect(attempt.method).toBe('Patente - Salida');
      expect(await onlyPassage()).toMatchObject({
        direction: 'exit',
        directionSource: 'line',
      });
    });

    it('prioridad de fuentes: camera > line > motion > width; una fuente menor no pisa a la mayor', async () => {
      await service.createDetection(read('reg-a', 'unknown', 'none'), orgId);
      const state = async () => {
        const p = await onlyPassage();
        const [a] = await allAttempts();
        return `${p.direction}/${p.directionSource}/${a.method}`;
      };
      expect(await state()).toBe('unknown/none/Patente - Registro');

      await service.createDetection(read('reg-a', 'entry', 'width'), orgId);
      expect(await state()).toBe('entry/width/Patente - Entrada');

      await service.createDetection(read('reg-a', 'exit', 'motion'), orgId);
      expect(await state()).toBe('exit/motion/Patente - Salida');

      await service.createDetection(read('reg-a', 'entry', 'width'), orgId);
      expect(await state()).toBe('exit/motion/Patente - Salida');

      await service.createDetection(read('reg-a', 'exit', 'line'), orgId);
      expect(await state()).toBe('exit/line/Patente - Salida');

      await service.createDetection(
        read('reg-fixed-out', 'exit', 'camera'),
        orgId,
      );
      expect(await state()).toBe('exit/camera/Patente - Salida');
      expect(await count('vehicle_passages')).toBe(1);
    });

    it('residente: el método sigue la dirección de la pasada (informativo)', async () => {
      await service.createDetection(read('cam-a', 'exit', 'line'), orgId);
      const [attempt] = await allAttempts();
      expect(attempt).toMatchObject({
        decision: 'Permitido',
        method: 'Patente - Salida',
      });
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
    });

    it('un worker anterior (sin direction_source) no abre pasadas nuevas por una dirección contraria', async () => {
      await service.createDetection(read('cam-a', 'entry'), orgId);
      await service.createDetection(read('cam-a', 'exit'), orgId);

      expect(await count('vehicle_passages')).toBe(1);
      expect(await count('access_attempts')).toBe(1);
    });
  });

  describe('promoción: cámara de solo registro y cámara de acceso', () => {
    it('registro -> acceso: UNA pasada, el intento Registrado se actualiza a la decisión de acceso y se abre una vez', async () => {
      await service.createDetection(read('reg-a', 'exit', 'line'), orgId);
      const [registered] = await allAttempts();
      expect(registered.decision).toBe('Registrado');
      expect(sendDoorOpen).not.toHaveBeenCalled();

      const result = await service.createDetection(
        read('cam-a', 'exit', 'line'),
        orgId,
      );

      expect(result).toMatchObject({ deduplicated: false });
      expect(await count('vehicle_passages')).toBe(1);
      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: registered.id,
        decision: 'Permitido',
        method: 'Patente - Salida',
      });
      expect(rows[0].responseTimeMs).not.toBeNull();
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
      expect((await onlyPassage()).decidesAccess).toBe(true);
      expect(await count('plate_detections')).toBe(2);
    });

    it('acceso -> registro: la lectura de la cámara de registro es evidencia y no pisa la decisión', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      sendDoorOpen.mockClear();

      const result = await service.createDetection(
        read('reg-a', 'entry', 'line'),
        orgId,
      );

      expect(result).toMatchObject({ deduplicated: true });
      const [attempt] = await allAttempts();
      expect(attempt.decision).toBe('Permitido');
      expect(sendDoorOpen).not.toHaveBeenCalled();
    });

    it('registro -> varias cámaras de acceso concurrentes: una sola promoción y una sola apertura', async () => {
      await service.createDetection(read('reg-a', 'entry', 'line'), orgId);

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          service.createDetection(read(`cam-${i}`, 'entry', 'line'), orgId),
        ),
      );

      expect(
        results.filter((r) => 'deduplicated' in r && !r.deduplicated),
      ).toHaveLength(1);
      expect(await count('vehicle_passages')).toBe(1);
      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0].decision).toBe('Permitido');
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
      expect(findByPlate).toHaveBeenCalledTimes(1);
    });

    it('registro y acceso a la vez: una pasada, un intento, a lo más una apertura (sin importar el orden)', async () => {
      await Promise.all([
        service.createDetection(read('reg-a', 'entry', 'line'), orgId),
        service.createDetection(read('cam-a', 'entry', 'line'), orgId),
        service.createDetection(read('reg-b', 'entry', 'line'), orgId),
        service.createDetection(read('cam-b', 'entry', 'line'), orgId),
      ]);

      expect(await count('vehicle_passages')).toBe(1);
      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0].decision).toBe('Permitido');
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
    });

    it('visita: registro -> acceso hace el check-out correcto (una vez) y el intento queda Permitido / Salida', async () => {
      vehicle = null;
      // El anfitrión es el residente del intento (FK a user): usuario real.
      const hostId = randomUUID();
      hostIds.push(hostId);
      await dataSource.query(
        `INSERT INTO "user" ("id", "name", "email") VALUES ($1, 'Anfitrión', $2)`,
        [hostId, `${hostId}@example.invalid`],
      );
      const visit = {
        id: randomUUID(),
        status: VisitStatus.ACTIVE,
        visitorName: 'Visita',
        host: { id: hostId },
        entryTime: new Date(Date.now() - 60 * 60_000),
        exitTime: null,
      } as unknown as Visit;
      validateAccess.mockResolvedValue({ valid: true, visit });

      await service.createDetection(read('reg-a', 'exit', 'line'), orgId);
      expect(checkOut).not.toHaveBeenCalled();
      await service.createDetection(read('cam-a', 'exit', 'line'), orgId);
      await service.createDetection(read('cam-b', 'exit', 'line'), orgId);

      expect(checkOut).toHaveBeenCalledTimes(1);
      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        decision: 'Permitido',
        method: 'Patente - Salida',
      });
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
    });

    it('registro -> acceso con patente desconocida: el Registrado pasa a un único Pendiente para el conserje', async () => {
      vehicle = null;
      await service.createDetection(read('reg-a', 'entry', 'line'), orgId);

      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);

      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        decision: 'Pendiente',
        method: 'Patente - Requiere Aprobación',
      });
      expect(rows[0].expiresAt).not.toBeNull();
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('si la promoción falla, la pasada vuelve a solo registro (intento Registrado intacto) y otra cámara de acceso puede promoverla', async () => {
      await service.createDetection(read('reg-a', 'entry', 'line'), orgId);
      findByPlate.mockRejectedValueOnce(new Error('BD caída'));

      await expect(
        service.createDetection(read('cam-a', 'entry', 'line'), orgId),
      ).rejects.toThrow('BD caída');

      expect((await onlyPassage()).decidesAccess).toBe(false);
      expect((await allAttempts())[0].decision).toBe('Registrado');
      expect(sendDoorOpen).not.toHaveBeenCalled();

      await service.createDetection(read('cam-b', 'entry', 'line'), orgId);

      expect((await allAttempts())[0].decision).toBe('Permitido');
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('pasada huérfana', () => {
    async function orphanPassage(): Promise<void> {
      // Un líder que reclamó la pasada y nunca guardó su intento.
      const detection = new PlateDetection();
      Object.assign(detection, {
        organizationId: orgId,
        cameraId: 'cam-a',
        plate,
      });
      await passages.claim(
        detection,
        { direction: 'entry', source: 'line' },
        { decidesAccess: true },
      );
    }

    it('con el líder tomado hace más de LPR_PASSAGE_ORPHAN_SECONDS, la lectura siguiente toma el liderazgo', async () => {
      await orphanPassage();
      await sql(
        `UPDATE "vehicle_passages" SET "leaderClaimedAt" = now() - interval '40 seconds' WHERE "organizationId" = $1`,
      );

      await service.createDetection(read('cam-b', 'entry', 'line'), orgId);

      expect(await count('vehicle_passages')).toBe(1);
      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0].decision).toBe('Permitido');
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
    });

    it('con el líder reciente la pasada sin intento sigue absorbiendo lecturas (no hay apertura)', async () => {
      await orphanPassage();

      const result = await service.createDetection(
        read('cam-b', 'entry', 'line'),
        orgId,
      );

      expect(result).toMatchObject({ deduplicated: true, attempt: null });
      expect(await count('access_attempts')).toBe(0);
      expect(sendDoorOpen).not.toHaveBeenCalled();
    });

    it('lecturas simultáneas sobre una pasada huérfana: un solo nuevo líder, una apertura', async () => {
      await orphanPassage();
      await sql(
        `UPDATE "vehicle_passages" SET "leaderClaimedAt" = now() - interval '40 seconds' WHERE "organizationId" = $1`,
      );

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          service.createDetection(read(`cam-${i}`, 'entry', 'line'), orgId),
        ),
      );

      expect(await count('access_attempts')).toBe(1);
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('token de liderazgo: solo el líder vigente escribe y abre', () => {
    it('huérfana con líder original LENTO: el nuevo líder guarda y abre; cuando el original llega, no escribe ni abre (1 apertura en total)', async () => {
      let releaseSlowLeader: () => void = () => undefined;
      const slow = new Promise<Vehicle | null>((resolve) => {
        releaseSlowLeader = () => resolve(vehicle);
      });
      // A: reclama la pasada y se queda esperando la búsqueda del vehículo.
      findByPlate.mockReturnValueOnce(slow);
      const slowLeader = service.createDetection(
        read('cam-a', 'entry', 'line'),
        orgId,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await count('vehicle_passages')).toBe(1);
      expect(await count('access_attempts')).toBe(0);

      // Pasa más de LPR_PASSAGE_ORPHAN_SECONDS sin que A guarde su intento.
      await sql(
        `UPDATE "vehicle_passages" SET "leaderClaimedAt" = now() - interval '40 seconds' WHERE "organizationId" = $1`,
      );
      // B toma la huérfana, guarda y abre.
      const takeover = await service.createDetection(
        read('cam-b', 'entry', 'line'),
        orgId,
      );
      expect(takeover).toMatchObject({ deduplicated: false });
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
      const [decided] = await allAttempts();

      // A despierta y llega a saveAttempt: perdió el liderazgo.
      releaseSlowLeader();
      const lateResult = await slowLeader;

      expect(lateResult).toMatchObject({
        deduplicated: true,
        attempt: { id: decided.id },
      });
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(await count('access_attempts')).toBe(1);
      // La pasada sigue siendo del nuevo líder: el original no la liberó.
      expect(await count('vehicle_passages')).toBe(1);
    });

    it('un líder que llega a saveAttempt con el token viejo no escribe (a nivel de servicio)', async () => {
      const detection = new PlateDetection();
      Object.assign(detection, {
        organizationId: orgId,
        cameraId: 'cam-a',
        plate,
      });
      const first = await passages.claim(
        detection,
        { direction: 'entry', source: 'line' },
        { decidesAccess: true },
      );
      await sql(
        `UPDATE "vehicle_passages" SET "leaderClaimedAt" = now() - interval '40 seconds' WHERE "organizationId" = $1`,
      );
      await service.createDetection(read('cam-b', 'entry', 'line'), orgId);

      const result = await passages.saveAttempt(
        attempts.create({ decision: 'Permitido', organizationId: orgId }),
        first.passage,
        { decidesAccess: true, followsDirection: false, unknownMethod: 'x' },
      );

      expect(result.written).toBe(false);
      expect(await count('access_attempts')).toBe(1);
    });

    it('dos decisiones de acceso con el token vigente sobre un intento ya Permitido no lo sobrescriben', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      const [decided] = await allAttempts();
      const current = await onlyPassage();

      for (const decision of ['Permitido', 'Denegado', 'Pendiente']) {
        const result = await passages.saveAttempt(
          attempts.create({ decision, reason: 'otra', organizationId: orgId }),
          current,
          { decidesAccess: true, followsDirection: false, unknownMethod: 'x' },
        );
        expect(result.written).toBe(false);
        expect(result.attempt?.id).toBe(decided.id);
      }

      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        decision: 'Permitido',
        reason: decided.reason,
      });
    });

    it('promoción registro -> acceso con el token vigente sigue funcionando (Registrado -> Permitido, una apertura)', async () => {
      await service.createDetection(read('reg-a', 'entry', 'line'), orgId);

      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);

      const rows = await allAttempts();
      expect(rows).toHaveLength(1);
      expect(rows[0].decision).toBe('Permitido');
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
    });

    it('el líder anterior de una pasada promovida no puede liberarla ni revertirla (release/demote con token viejo)', async () => {
      const detection = new PlateDetection();
      Object.assign(detection, {
        organizationId: orgId,
        cameraId: 'cam-a',
        plate,
      });
      const first = await passages.claim(
        detection,
        { direction: 'entry', source: 'line' },
        { decidesAccess: true },
      );
      await sql(
        `UPDATE "vehicle_passages" SET "leaderClaimedAt" = now() - interval '40 seconds' WHERE "organizationId" = $1`,
      );
      // Un nuevo líder tomó la huérfana y aún no guarda (usamos claim directo).
      const second = await passages.claim(
        Object.assign(new PlateDetection(), {
          organizationId: orgId,
          cameraId: 'cam-b',
          plate,
        }),
        { direction: 'entry', source: 'line' },
        { decidesAccess: true },
      );
      expect(second.kind).toBe('leader');

      await passages.release(first.passage);
      await passages.demote(first.passage);

      const passage = await onlyPassage();
      expect(passage).toBeDefined();
      expect(passage.decidesAccess).toBe(true);
      expect(passage.leaderToken).toBe(second.passage.leaderToken);
    });
  });

  describe('fallos y compensación', () => {
    it('si el líder falla antes de guardar el intento, la pasada se descarta y la siguiente lectura decide', async () => {
      findByPlate.mockRejectedValueOnce(new Error('BD caída'));

      await expect(
        service.createDetection(read('cam-a', 'entry', 'line'), orgId),
      ).rejects.toThrow('BD caída');
      expect(await count('vehicle_passages')).toBe(0);
      expect(sendDoorOpen).not.toHaveBeenCalled();

      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      expect(await count('access_attempts')).toBe(1);
      expect(sendDoorOpen).toHaveBeenCalledTimes(1);
      // La detección del intento fallido se conserva (sin pasada).
      expect(await count('plate_detections')).toBe(2);
    });

    it('la BD impide dos intentos en una misma pasada (índice único parcial)', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      const [attempt] = await allAttempts();

      await expect(
        dataSource.query(
          `INSERT INTO "access_attempts" ("organizationId", "decision", "passageId") VALUES ($1, 'Permitido', $2)`,
          [orgId, attempt.passageId],
        ),
      ).rejects.toThrow(/UQ_access_attempts_passage/);
    });

    it('borrar una pasada no borra detecciones ni intentos (SET NULL)', async () => {
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      await sql(`DELETE FROM "vehicle_passages" WHERE "organizationId" = $1`);

      expect(await count('plate_detections')).toBe(1);
      expect(await count('access_attempts')).toBe(1);
    });
  });

  describe('exposición', () => {
    it('attachPassages: pasada con sus lecturas ordenadas; frame https sin recorte duplicado; intento sin pasada -> null', async () => {
      await service.createDetection(
        {
          cameraId: 'cam-a',
          plate,
          full_frame_path: 'https://example.invalid/frame.jpg',
          meta: {
            direction: 'entry',
            direction_source: 'line',
            snapshot_jpeg_b64: 'data:image/jpeg;base64,DUPLICADO',
          },
        },
        orgId,
      );
      await service.createDetection(
        {
          cameraId: 'cam-b',
          plate,
          meta: {
            direction: 'unknown',
            snapshot_jpeg_b64: 'data:image/jpeg;base64,AAAA',
          },
        },
        orgId,
      );
      // Un intento antiguo, sin pasada.
      const [first] = await detections.find({
        where: { organizationId: orgId },
      });
      const legacy = await attempts.save(
        attempts.create({
          detection: first,
          decision: 'Permitido',
          organizationId: orgId,
        }),
      );

      const rows = await attempts.find({
        where: { organizationId: orgId },
        relations: ['detection'],
      });
      const view = await passages.attachPassages(rows);

      const withPassage = view.find((a) => a.id !== legacy.id);
      const without = view.find((a) => a.id === legacy.id);
      expect(without?.passage).toBeNull();
      expect(withPassage?.passage).toMatchObject({
        direction: 'entry',
        directionSource: 'line',
        sightingCount: 2,
      });
      const sightings = withPassage?.passage?.sightings ?? [];
      expect(sightings.map((s) => s.cameraId)).toEqual(['cam-a', 'cam-b']);
      expect(sightings[0]).toMatchObject({
        direction: 'entry',
        directionSource: 'line',
        full_frame_path: 'https://example.invalid/frame.jpg',
        snapshot_jpeg_b64: null,
      });
      expect(sightings[1]).toMatchObject({
        direction: 'unknown',
        directionSource: 'none',
        full_frame_path: null,
        snapshot_jpeg_b64: 'data:image/jpeg;base64,AAAA',
      });
      expect(new Date(sightings[0].at).getTime()).toBeLessThanOrEqual(
        new Date(sightings[1].at).getTime(),
      );
    });

    it('expone solo las últimas 10 lecturas, ordenadas, con el sightingCount real', async () => {
      for (let i = 0; i < 13; i++) {
        await service.createDetection(read(`cam-${i}`, 'entry', 'line'), orgId);
      }

      const rows = await attempts.find({ where: { organizationId: orgId } });
      const [view] = await passages.attachPassages(rows);

      expect(view.passage?.sightingCount).toBe(13);
      const cameras = (view.passage?.sightings ?? []).map((s) => s.cameraId);
      expect(cameras).toEqual(
        Array.from({ length: 10 }, (_, i) => `cam-${i + 3}`),
      );
    });
  });

  describe('retención', () => {
    async function anonymize(ids: string[]) {
      return anonymizeDetectionsWith(
        (statement, params) => dataSource.query(statement, params),
        ids,
        [],
      );
    }

    it('una lectura de otra cámara de una pasada con intento Pendiente NO se anonimiza', async () => {
      vehicle = null;
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      await service.createDetection(read('cam-b', 'entry', 'line'), orgId);
      const rows = await detections.find({ where: { organizationId: orgId } });
      expect(rows).toHaveLength(2);

      const result = await anonymize(rows.map((d) => d.id));

      expect(result.detections).toBe(0);
      const after = await detections.find({ where: { organizationId: orgId } });
      expect(
        after.every((d) => d.anonymizedAt === null && d.plate === plate),
      ).toBe(true);
    });

    async function resolveAndAnonymize(lastSeenSecondsAgo: number) {
      vehicle = null;
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      await service.createDetection(read('cam-b', 'entry', 'line'), orgId);
      await sql(
        `UPDATE "access_attempts" SET "decision" = 'Denegado' WHERE "organizationId" = $1`,
      );
      await sql(
        `UPDATE "vehicle_passages" SET "lastSeenAt" = now() - interval '${lastSeenSecondsAgo} seconds' WHERE "organizationId" = $1`,
      );
      const rows = await detections.find({ where: { organizationId: orgId } });
      return anonymize(rows.map((d) => d.id));
    }

    it('resuelto el pendiente y fuera de la ventana, se anonimizan las lecturas y la patente de la pasada', async () => {
      const result = await resolveAndAnonymize(120);

      expect(result.detections).toBe(2);
      const passage = await onlyPassage();
      expect(passage.plate).toBe('******');
      expect(passage.anonymizedAt).not.toBeNull();
    });

    it('una pasada aún dentro de su ventana NO se enmascara (puede recibir lecturas)', async () => {
      const result = await resolveAndAnonymize(10);

      expect(result.detections).toBe(2);
      const passage = await onlyPassage();
      expect(passage.plate).toBe(plate);
      expect(passage.anonymizedAt).toBeNull();
    });

    describe('supresión y barrido de pasadas', () => {
      const request = () => ({
        kind: 'plate' as const,
        key: plateKey(plate),
        organizationId: orgId,
      });
      const erasure = () =>
        createErasureTransaction((statement, params) =>
          dataSource.query(statement, params),
        );

      it('la supresión enmascara la pasada de la patente AUNQUE esté dentro de su ventana', async () => {
        await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
        await service.createDetection(read('cam-b', 'entry', 'line'), orgId);
        const tx = erasure();
        const found = await tx.findDetections(request(), 'erasable', 50);
        expect(found).toHaveLength(2);

        const result = await tx.anonymizeDetections(
          found.map((d) => d.id),
          [],
        );

        expect(result.detections).toBe(2);
        const passage = await onlyPassage();
        expect(passage.plate).toBe('******');
        expect(passage.anonymizedAt).not.toBeNull();
      });

      it('la retención automática SÍ respeta la ventana, y la supresión posterior enmascara la pasada que quedó en claro', async () => {
        await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
        const rows = await detections.find({
          where: { organizationId: orgId },
        });
        await anonymize(rows.map((d) => d.id));
        expect((await onlyPassage()).plate).toBe(plate);

        await expect(erasure().anonymizePassages(request())).resolves.toBe(1);

        expect((await onlyPassage()).plate).toBe('******');
      });

      it('la supresión por patente no toca la pasada de otra patente ni la de otro condominio', async () => {
        const other = `U${plate.slice(1)}`;
        await service.createDetection(
          { cameraId: 'cam-a', plate: other, meta: { direction: 'entry' } },
          orgId,
        );
        await service.createDetection(read('cam-a', 'entry', 'line'), orgId);

        await erasure().anonymizePassages({
          ...request(),
          organizationId: randomUUID(),
        });
        expect(
          (await passagesRepo.find({ where: { organizationId: orgId } })).every(
            (p) => p.anonymizedAt === null,
          ),
        ).toBe(true);

        await expect(erasure().anonymizePassages(request())).resolves.toBe(1);
        const plates = (
          await passagesRepo.find({ where: { organizationId: orgId } })
        )
          .map((p) => p.plate)
          .sort();
        expect(plates).toEqual(['******', other].sort());
      });

      it('la supresión respeta una pasada con intento Pendiente del conserje', async () => {
        vehicle = null;
        await service.createDetection(read('cam-a', 'entry', 'line'), orgId);

        await expect(erasure().anonymizePassages(request())).resolves.toBe(0);

        expect((await onlyPassage()).plate).toBe(plate);
      });

      describe('barrido de pasadas fuera de ventana (retención)', () => {
        const sweep = () =>
          new RetentionRepository(dataSource).anonymizeStalePassages();
        const age = (seconds: number) =>
          sql(
            `UPDATE "vehicle_passages" SET "lastSeenAt" = now() - interval '${seconds} seconds' WHERE "organizationId" = $1`,
          );

        it('enmascara la pasada fuera de ventana cuyas detecciones ya están anonimizadas', async () => {
          await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
          const rows = await detections.find({
            where: { organizationId: orgId },
          });
          await anonymize(rows.map((d) => d.id));
          expect((await onlyPassage()).plate).toBe(plate);
          await age(120);

          await sweep();

          const passage = await onlyPassage();
          expect(passage.plate).toBe('******');
          expect(passage.anonymizedAt).not.toBeNull();
        });

        it('no toca una pasada dentro de la ventana', async () => {
          await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
          const rows = await detections.find({
            where: { organizationId: orgId },
          });
          await anonymize(rows.map((d) => d.id));

          await sweep();

          expect((await onlyPassage()).plate).toBe(plate);
        });

        it('no toca una pasada con alguna detección sin anonimizar', async () => {
          await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
          await age(120);

          await sweep();

          expect((await onlyPassage()).plate).toBe(plate);
        });

        it('no toca una pasada con un intento Pendiente', async () => {
          vehicle = null;
          await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
          await sql(
            `UPDATE "plate_detections" SET "anonymizedAt" = now() WHERE "organizationId" = $1`,
          );
          await age(120);

          await sweep();

          expect((await onlyPassage()).plate).toBe(plate);
        });
      });
    });

    it('DETECTION_HAS_PENDING_ATTEMPT_SQL es SQL válido y distingue pendientes de pasada', async () => {
      vehicle = null;
      await service.createDetection(read('cam-a', 'entry', 'line'), orgId);
      await service.createDetection(read('cam-b', 'entry', 'line'), orgId);

      const rows = await dataSource.query<Array<{ pending: boolean }>>(
        `SELECT d."id", ${DETECTION_HAS_PENDING_ATTEMPT_SQL} AS pending FROM "plate_detections" d WHERE d."organizationId" = $1`,
        [orgId],
      );

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.pending)).toBe(true);
    });
  });
});
