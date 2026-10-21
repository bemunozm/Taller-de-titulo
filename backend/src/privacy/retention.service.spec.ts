import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import { AuditAction, AuditModule } from '../audit/entities/audit-log.entity';
import type { DisabledUserAnonymizer } from './disabled-user-anonymizer.service';
import type {
  MediaBatchPurge,
  MediaPurgerService,
} from './media-purger.service';
import type {
  DetectionFrameRow,
  RetentionRepository,
} from './retention.repository';
import type { SetBasedCategory, SetBasedSweep } from './retention-sql';
import {
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES,
  RETENTION_USER_BATCH_SIZE,
  RetentionService,
  type RetentionRunSummary,
} from './retention.service';

/** Doble del repositorio: por defecto no hay nada que barrer. */
function fakeRepository() {
  return {
    withRunLock: jest.fn((work: () => Promise<unknown>) => work()),
    countSetBased: jest.fn<Promise<number>, [SetBasedSweep, number]>(() =>
      Promise.resolve(0),
    ),
    runSetBasedBatch: jest.fn<Promise<number>, [SetBasedSweep, number, number]>(
      () => Promise.resolve(0),
    ),
    countDetectionImages: jest.fn(() => Promise.resolve(0)),
    findDetectionImageBatch: jest.fn<
      Promise<DetectionFrameRow[]>,
      [number, number, readonly string[]]
    >(() => Promise.resolve([])),
    clearDetectionImages: jest.fn<
      Promise<number>,
      [readonly string[], readonly string[]]
    >((ids) => Promise.resolve(ids.length)),
    countDetectionsToAnonymize: jest.fn(() => Promise.resolve(0)),
    findDetectionsToAnonymize: jest.fn<
      Promise<DetectionFrameRow[]>,
      [number, number]
    >(() => Promise.resolve([])),
    anonymizeDetections: jest.fn<
      Promise<{ detections: number; accessAttempts: number }>,
      [readonly string[], readonly string[]]
    >((ids) => Promise.resolve({ detections: ids.length, accessAttempts: 0 })),
    anonymizeStalePassages: jest.fn(() => Promise.resolve(0)),
    countDisabledUsersToAnonymize: jest.fn(() => Promise.resolve(0)),
    findDisabledUsersToAnonymize: jest.fn<
      Promise<Array<{ id: string }>>,
      [number, number, readonly string[]]
    >(() => Promise.resolve([])),
  };
}

type FakeRepository = ReturnType<typeof fakeRepository>;

/** Purga sin URLs de Cloudinary: todo se puede limpiar. */
function fakePurger() {
  return {
    purgeBatch: jest.fn<
      Promise<MediaBatchPurge>,
      [ReadonlyArray<{ id: string; url: string | null }>, string]
    >((rows) =>
      Promise.resolve({
        clearableIds: rows.map((row) => row.id),
        keptIds: [],
        deleted: 0,
        foreign: 0,
      }),
    ),
  };
}

function fakeAnonymizer() {
  return {
    anonymize: jest.fn((id: string) => {
      void id;
      return Promise.resolve({
        alreadyAnonymized: false,
        picturesDeleted: 0,
        picturePending: false,
      });
    }),
  };
}

function rowsOf(count: number, prefix: string): DetectionFrameRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    fullFramePath: null,
  }));
}

describe('RetentionService (Fase 4 · P7.R)', () => {
  let repository: FakeRepository;
  let purger: ReturnType<typeof fakePurger>;
  let anonymizer: ReturnType<typeof fakeAnonymizer>;
  let auditLog: jest.Mock;

  function build(env: Record<string, string> = {}): RetentionService {
    const config = { get: (name: string) => env[name] };
    return new RetentionService(
      repository as unknown as RetentionRepository,
      purger as unknown as MediaPurgerService,
      anonymizer as unknown as DisabledUserAnonymizer,
      { log: auditLog } as unknown as AuditService,
      config as unknown as ConfigService,
    );
  }

  function batchCallsFor(category: SetBasedCategory) {
    return repository.runSetBasedBatch.mock.calls.filter(
      ([sweep]) => sweep.category === category,
    );
  }

  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    repository = fakeRepository();
    purger = fakePurger();
    anonymizer = fakeAnonymizer();
    auditLog = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('corre todas las categorías en orden: imágenes, anonimizaciones, borrados, usuarios y better-auth', async () => {
    const summary = await build().run();

    expect(summary.status).toBe('completed');
    expect(Object.keys(summary.categories)).toEqual([
      'detectionImages',
      'anomalyImages',
      'visits',
      'conciergeSessions',
      'visitorVehicles',
      'detections',
      'anomalies',
      'notifications',
      'pendingActions',
      'auditLogs',
      'disabledUsers',
      'systemLogs',
      'authSessions',
      'authVerifications',
      'authRateLimits',
    ]);
    expect(repository.withRunLock).toHaveBeenCalledTimes(1);
  });

  it('aplica los plazos del env y los defaults del §3', async () => {
    await build({
      RETENTION_VISITS_DAYS: '120',
      RETENTION_IMAGES_DAYS: '15',
      RETENTION_AUDIT_DAYS: '730',
    }).run();

    const daysOf = (category: SetBasedCategory) =>
      batchCallsFor(category)[0][1];
    expect(daysOf('visits')).toBe(120);
    expect(daysOf('conciergeSessions')).toBe(120);
    expect(daysOf('anomalyImages')).toBe(15);
    expect(daysOf('auditLogs')).toBe(730);
    expect(daysOf('anomalies')).toBe(90);
    expect(daysOf('notifications')).toBe(90);
    expect(daysOf('pendingActions')).toBe(90);
    expect(daysOf('systemLogs')).toBe(30);
    expect(repository.findDetectionImageBatch.mock.calls[0][0]).toBe(15);
    expect(repository.findDetectionsToAnonymize.mock.calls[0][0]).toBe(90);
    expect(repository.findDisabledUsersToAnonymize.mock.calls[0][0]).toBe(30);
  });

  describe('lotes', () => {
    it('repite el lote hasta que viene incompleto', async () => {
      const results = [RETENTION_BATCH_SIZE, RETENTION_BATCH_SIZE, 37];
      repository.runSetBasedBatch.mockImplementation((sweep) =>
        Promise.resolve(
          sweep.category === 'notifications' ? (results.shift() ?? 0) : 0,
        ),
      );

      const summary = await build().run();

      expect(batchCallsFor('notifications')).toHaveLength(3);
      for (const [, , limit] of batchCallsFor('notifications')) {
        expect(limit).toBe(RETENTION_BATCH_SIZE);
      }
      expect(summary.categories.notifications).toEqual({
        action: 'delete',
        days: 90,
        rows: 2 * RETENTION_BATCH_SIZE + 37,
        capped: false,
      });
    });

    it('se detiene en el tope por corrida y lo informa (capped)', async () => {
      repository.runSetBasedBatch.mockImplementation((sweep) =>
        Promise.resolve(
          sweep.category === 'auditLogs' ? RETENTION_BATCH_SIZE : 0,
        ),
      );

      const summary = await build().run();

      expect(batchCallsFor('auditLogs')).toHaveLength(RETENTION_MAX_BATCHES);
      expect(summary.categories.auditLogs).toMatchObject({
        rows: RETENTION_MAX_BATCHES * RETENTION_BATCH_SIZE,
        capped: true,
      });
    });

    it('idempotente: una segunda corrida sin pendientes no escribe nada', async () => {
      // "Tabla" en memoria de visitas por anonimizar: el lote consume lo
      // pendiente y lo ya anonimizado no vuelve a contar.
      let pendingVisits = 1_234;
      repository.runSetBasedBatch.mockImplementation((sweep, _days, limit) => {
        if (sweep.category !== 'visits') {
          return Promise.resolve(0);
        }
        const affected = Math.min(limit, pendingVisits);
        pendingVisits -= affected;
        return Promise.resolve(affected);
      });
      const service = build();

      const first = await service.run();
      const second = await service.run();

      expect(first.categories.visits?.rows).toBe(1_234);
      expect(second.categories.visits?.rows).toBe(0);
      expect(
        Object.values(second.categories).every((result) => result.rows === 0),
      ).toBe(true);
    });
  });

  describe('dry-run (RETENTION_DRY_RUN=true)', () => {
    it('solo cuenta: no ejecuta lotes, no borra en Cloudinary ni anonimiza usuarios', async () => {
      repository.countSetBased.mockImplementation((sweep) =>
        Promise.resolve(sweep.category === 'visits' ? 12 : 1),
      );
      repository.countDetectionImages.mockResolvedValue(7);
      repository.countDetectionsToAnonymize.mockResolvedValue(5);
      repository.countDisabledUsersToAnonymize.mockResolvedValue(2);

      const summary = await build({ RETENTION_DRY_RUN: 'true' }).run();

      expect(summary.dryRun).toBe(true);
      expect(repository.runSetBasedBatch).not.toHaveBeenCalled();
      expect(repository.findDetectionImageBatch).not.toHaveBeenCalled();
      expect(repository.clearDetectionImages).not.toHaveBeenCalled();
      expect(repository.findDetectionsToAnonymize).not.toHaveBeenCalled();
      expect(repository.anonymizeDetections).not.toHaveBeenCalled();
      expect(repository.findDisabledUsersToAnonymize).not.toHaveBeenCalled();
      expect(purger.purgeBatch).not.toHaveBeenCalled();
      expect(anonymizer.anonymize).not.toHaveBeenCalled();
      expect(summary.categories.visits?.rows).toBe(12);
      expect(summary.categories.detectionImages?.rows).toBe(7);
      expect(summary.categories.detections?.rows).toBe(5);
      expect(summary.categories.disabledUsers?.rows).toBe(2);
      expect(summary.categories.notifications?.rows).toBe(1);
    });

    it('queda registrado en la auditoría como dry-run', async () => {
      await build({ RETENTION_DRY_RUN: 'true' }).run();

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          module: AuditModule.PRIVACY,
          action: AuditAction.RETENTION_SWEEP,
          organizationId: null,
          description: 'Barrido de retención (dry-run: sin cambios)',
          newValue: expect.objectContaining({ dryRun: true }) as unknown,
        }),
      );
    });
  });

  it('RETENTION_ENABLED=false: solo corre la limpieza técnica (system_logs y better-auth)', async () => {
    const summary = await build({ RETENTION_ENABLED: 'false' }).run();

    expect(summary.status).toBe('completed');
    expect(summary.personalDataEnabled).toBe(false);
    expect(Object.keys(summary.categories)).toEqual([
      'systemLogs',
      'authSessions',
      'authVerifications',
      'authRateLimits',
    ]);
    expect(
      repository.runSetBasedBatch.mock.calls.map(([sweep]) => sweep.category),
    ).toEqual([
      'systemLogs',
      'authSessions',
      'authVerifications',
      'authRateLimits',
    ]);
    expect(repository.findDetectionImageBatch).not.toHaveBeenCalled();
    expect(repository.findDisabledUsersToAnonymize).not.toHaveBeenCalled();
    expect(anonymizer.anonymize).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('run({ dryRun }) pisa RETENTION_DRY_RUN en esa corrida (script manual)', async () => {
    const service = build({ RETENTION_DRY_RUN: 'false' });

    const dry = await service.run({ dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(repository.runSetBasedBatch).not.toHaveBeenCalled();

    const applied = await build({ RETENTION_DRY_RUN: 'true' }).run({
      dryRun: false,
    });
    expect(applied.dryRun).toBe(false);
    expect(repository.runSetBasedBatch).toHaveBeenCalled();
  });

  describe('imágenes de detecciones y Cloudinary (best-effort)', () => {
    it('un fallo de Cloudinary no frena el barrido: conserva esa URL y no la repite en la corrida', async () => {
      const batch: DetectionFrameRow[] = [
        { id: 'a', fullFramePath: '/frames/a.jpg' },
        {
          id: 'b',
          fullFramePath:
            'https://res.cloudinary.com/x/image/upload/v1/lpr/b.jpg',
        },
        { id: 'c', fullFramePath: null },
      ];
      repository.findDetectionImageBatch.mockResolvedValueOnce(batch);
      purger.purgeBatch.mockResolvedValueOnce({
        clearableIds: ['a', 'c'],
        keptIds: ['b'],
        deleted: 0,
        foreign: 0,
      });

      const summary = await build().run();

      expect(purger.purgeBatch).toHaveBeenCalledWith(
        [
          { id: 'a', url: '/frames/a.jpg' },
          {
            id: 'b',
            url: 'https://res.cloudinary.com/x/image/upload/v1/lpr/b.jpg',
          },
          { id: 'c', url: null },
        ],
        'lpr-frame',
      );
      // El recorte de `meta` se quita en las tres; el frame solo en a y c.
      expect(repository.clearDetectionImages).toHaveBeenCalledWith(
        ['a', 'b', 'c'],
        ['a', 'c'],
      );
      expect(summary.categories.detectionImages).toMatchObject({
        rows: 3,
        imagesPending: 1,
        capped: false,
      });
    });

    it('los ids que fallaron se excluyen de los lotes siguientes', async () => {
      const full = rowsOf(RETENTION_BATCH_SIZE, 'img');
      repository.findDetectionImageBatch
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([]);
      purger.purgeBatch.mockImplementationOnce((rows) =>
        Promise.resolve({
          clearableIds: rows.slice(1).map((row) => row.id),
          keptIds: [rows[0].id],
          deleted: rows.length - 1,
          foreign: 1,
        }),
      );

      const summary = await build().run();

      expect(repository.findDetectionImageBatch).toHaveBeenCalledTimes(2);
      expect(repository.findDetectionImageBatch.mock.calls[1][2]).toEqual([
        'img-0',
      ]);
      expect(summary.categories.detectionImages).toMatchObject({
        imagesDeleted: RETENTION_BATCH_SIZE - 1,
        imagesPending: 1,
        imagesForeign: 1,
      });
    });
  });

  describe('detecciones e intentos', () => {
    it('anonimiza con los frames ya liberados y suma los intentos', async () => {
      repository.findDetectionsToAnonymize.mockResolvedValueOnce([
        { id: 'd1', fullFramePath: null },
        { id: 'd2', fullFramePath: '/frames/d2.jpg' },
      ]);
      repository.anonymizeDetections.mockResolvedValueOnce({
        detections: 2,
        accessAttempts: 3,
      });

      const summary = await build().run();

      expect(repository.anonymizeDetections).toHaveBeenCalledWith(
        ['d1', 'd2'],
        ['d1', 'd2'],
      );
      expect(summary.categories.detections).toMatchObject({
        action: 'anonymize',
        days: 90,
        rows: 2,
        accessAttempts: 3,
      });
    });

    it('al final barre las pasadas fuera de ventana con detecciones ya anonimizadas', async () => {
      await build().run();

      expect(repository.anonymizeStalePassages).toHaveBeenCalledTimes(1);
    });

    it('en dry-run no enmascara pasadas', async () => {
      await build({ RETENTION_DRY_RUN: 'true' }).run();

      expect(repository.anonymizeStalePassages).not.toHaveBeenCalled();
    });

    it('sin avance en un lote lleno (carrera) corta en vez de repetirlo', async () => {
      repository.findDetectionsToAnonymize.mockResolvedValue(
        rowsOf(RETENTION_BATCH_SIZE, 'det'),
      );
      repository.anonymizeDetections.mockResolvedValue({
        detections: 0,
        accessAttempts: 0,
      });

      await build().run();

      expect(repository.findDetectionsToAnonymize).toHaveBeenCalledTimes(1);
    });
  });

  describe('usuarios deshabilitados', () => {
    it('anonimiza cada cuenta; un fallo se cuenta y no detiene a las demás', async () => {
      repository.findDisabledUsersToAnonymize.mockResolvedValueOnce([
        { id: 'u1' },
        { id: 'u2' },
        { id: 'u3' },
      ]);
      anonymizer.anonymize.mockImplementation((id: string) =>
        id === 'u2'
          ? Promise.reject(new Error('sesiones'))
          : Promise.resolve({
              alreadyAnonymized: false,
              picturesDeleted: id === 'u1' ? 1 : 0,
              picturePending: false,
            }),
      );

      const summary = await build().run();

      expect(anonymizer.anonymize.mock.calls.map(([id]) => id)).toEqual([
        'u1',
        'u2',
        'u3',
      ]);
      expect(summary.categories.disabledUsers).toMatchObject({
        rows: 2,
        failed: 1,
        imagesDeleted: 1,
      });
    });

    it('una foto pendiente en Cloudinary no repite la cuenta en la corrida; una ya anonimizada no suma', async () => {
      const full = Array.from(
        { length: RETENTION_USER_BATCH_SIZE },
        (_, i) => ({
          id: `u${i}`,
        }),
      );
      repository.findDisabledUsersToAnonymize
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([]);
      anonymizer.anonymize.mockImplementation((id: string) =>
        Promise.resolve({
          alreadyAnonymized: id === 'u1',
          picturesDeleted: 0,
          picturePending: id === 'u0',
        }),
      );

      const summary = await build().run();

      expect(repository.findDisabledUsersToAnonymize.mock.calls[1][2]).toEqual([
        'u0',
      ]);
      expect(summary.categories.disabledUsers).toMatchObject({
        rows: RETENTION_USER_BATCH_SIZE - 1,
        imagesPending: 1,
      });
    });
  });

  it('una categoría que falla no detiene a las demás', async () => {
    repository.runSetBasedBatch.mockImplementation((sweep) =>
      sweep.category === 'visits'
        ? Promise.reject(new Error('deadlock detected'))
        : Promise.resolve(sweep.category === 'notifications' ? 4 : 0),
    );

    const summary = await build().run();

    expect(summary.status).toBe('completed');
    expect(summary.categories.visits).toEqual({
      action: 'anonymize',
      days: 90,
      rows: 0,
      capped: false,
      error: true,
    });
    expect(summary.categories.notifications?.rows).toBe(4);
    expect(summary.categories.authRateLimits).toBeDefined();
  });

  describe('una sola corrida a la vez', () => {
    it('si otra instancia tiene el advisory lock, se omite', async () => {
      repository.withRunLock.mockResolvedValueOnce(null);

      const summary = await build().run();

      expect(summary.status).toBe('already-running');
      expect(repository.runSetBasedBatch).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('una segunda llamada mientras corre la primera se omite', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      repository.withRunLock.mockImplementationOnce(
        async (work: () => Promise<unknown>) => {
          await gate;
          return work();
        },
      );
      const service = build();

      const first = service.run();
      const second = await service.run();
      release();

      expect(second.status).toBe('already-running');
      expect((await first).status).toBe('completed');
    });
  });

  it('si la BD no responde, la corrida falla sin lanzar', async () => {
    repository.withRunLock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(build().run()).resolves.toMatchObject({ status: 'failed' });
  });

  it('si la auditoría falla, el resumen se devuelve igual', async () => {
    auditLog.mockRejectedValueOnce(new Error('audit down'));

    await expect(build().run()).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('el resumen (log y auditoría) solo trae conteos, nunca datos', async () => {
    repository.runSetBasedBatch.mockResolvedValue(3);

    const summary = await build().run();

    const [[entry]] = auditLog.mock.calls as [[{ newValue: unknown }]];
    expect(entry.newValue).toBe(summary);
    const allowedStrings = new Set([
      'completed',
      'delete',
      'anonymize',
      'purge-images',
      summary.startedAt,
    ]);
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        expect(allowedStrings.has(value)).toBe(true);
      } else if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(visit);
      }
    };
    visit(summary satisfies RetentionRunSummary);
  });
});
