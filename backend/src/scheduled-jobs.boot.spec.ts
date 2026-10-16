import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ScheduleExplorer } from '@nestjs/schedule/dist/schedule.explorer';
import { SchedulerOrchestrator } from '@nestjs/schedule/dist/scheduler.orchestrator';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import type { CronJob } from 'cron';

// better-auth es ESM puro (Jest no lo carga con require): se reemplaza la
// instancia por un doble con lo que lee @thallesp/nestjs-better-auth al
// compilar el módulo. El arranque del scheduler no la usa.
// El AI SDK también es ESM puro (como en rate-limit.spec.ts).
jest.mock('ai', () => ({ tool: jest.fn(), ToolLoopAgent: jest.fn() }));
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => jest.fn(() => ({ modelId: 'test' }))),
}));
jest.mock('./auth/better-auth', () => ({
  auth: {
    options: { basePath: '/api/auth' },
    api: {},
    handler: jest.fn(),
    $context: new Promise(() => undefined),
  },
}));

/**
 * Fase 4 · P7 (QA A2): TODOS los crons de la app quedan registrados al
 * arrancar. Nest descarta en silencio (solo un warn) un `@Cron` definido en
 * un provider NO estático, p. ej. uno que dependa (aunque sea indirecto) de
 * `TenantContextService`, request-scoped: así se perdió el cierre de
 * sesiones abandonadas cuando vivía en `DigitalConciergeService`.
 *
 * Se compila el `AppModule` REAL (el grafo de dependencias real decide qué
 * provider es estático) con la infraestructura reemplazada: un `DataSource`
 * doble (sin Postgres) y un env válido. No se ejecutan los hooks de arranque
 * de la app: solo los del scheduler (explorar y montar los crons), y los
 * crons se detienen al final.
 *
 * Lista EXPLÍCITA: un cron nuevo (o uno sin `name`, que se registraría con un
 * uuid) hace fallar el test hasta agregarlo acá.
 */
const EXPECTED_CRON_JOBS = [
  'expiration.tokens',
  'expiration.pending-detections',
  'expiration.notifications',
  'expiration.awaiting-visits',
  'expiration.visits-past-validity',
  'expiration.abandoned-active-visits',
  'expiration.abandoned-concierge-sessions',
  'expiration.expiring-soon-visits',
  'privacy-retention',
].sort();

function secret(): string {
  return randomBytes(32).toString('base64');
}

/** Env válido para `validateEnv` (pisa el `.env` local, que puede tener placeholders). */
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: '5455',
  DB_USER: 'vigilia',
  DB_PASSWORD: 'k3Jf92mQpZ8xLw1Rt5Nb',
  DB_NAME: 'vigilia_boot_test',
  DB_SYNCHRONIZE: 'false',
  BETTER_AUTH_SECRET: secret(),
  BETTER_AUTH_URL: 'http://localhost:3000',
  CAMERAS_ENCRYPTION_KEY: secret(),
  FRONTEND_URL: 'http://localhost:5173',
  WORKER_MANAGER_SECRET: secret(),
  MEDIAMTX_AUTH_SECRET: secret(),
  CAMERAS_REGISTER_IN_MEDIAMTX: 'false',
  OPENAI_API_KEY: 'sk-test-boot-only',
};

/** Repositorio doble: el arranque no consulta la BD (sus hooks no corren). */
const fakeRepository = new Proxy(
  {},
  {
    get: (_target, property) =>
      property === 'then' ? undefined : jest.fn().mockResolvedValue([]),
  },
);

/** `DataSource` doble con lo que usan los providers de `TypeOrmModule`. */
const fakeDataSource = {
  entityMetadatas: [],
  options: { type: 'postgres' },
  isInitialized: false,
  manager: fakeRepository,
  getRepository: () => fakeRepository,
  getTreeRepository: () => fakeRepository,
  createQueryRunner: () => fakeRepository,
  destroy: () => Promise.resolve(),
};

describe('Arranque: crons registrados (Fase 4 · P7, QA A2)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let moduleRef: TestingModule;
  let warnings: string[];

  beforeAll(async () => {
    for (const [key, value] of Object.entries(TEST_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    warnings = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    // Después de fijar el env: `ConfigModule.forRoot({ validate })` valida al
    // importar el módulo.
    const { AppModule } =
      jest.requireActual<typeof import('./app.module')>('./app.module');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource)
      .compile();

    // Lo que hace `ScheduleModule` al arrancar: explorar los providers
    // (onModuleInit) y montar los crons (onApplicationBootstrap).
    moduleRef.get(ScheduleExplorer, { strict: false }).onModuleInit();
    moduleRef.get(SchedulerOrchestrator, { strict: false }).mountCron();
  }, 60_000);

  afterAll(() => {
    if (moduleRef) {
      const registry = moduleRef.get(SchedulerRegistry, { strict: false });
      registry.getCronJobs().forEach((job: CronJob) => {
        void job.stop();
      });
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.restoreAllMocks();
  });

  it('registra exactamente los crons esperados (por nombre)', () => {
    const registry = moduleRef.get(SchedulerRegistry, { strict: false });
    expect([...registry.getCronJobs().keys()].sort()).toEqual(
      EXPECTED_CRON_JOBS,
    );
  });

  it('ningún cron quedó descartado por estar en un provider no estático', () => {
    expect(
      warnings.filter((message) =>
        message.includes('because it is defined in a non static provider'),
      ),
    ).toEqual([]);
  });

  it('los timers de arranque viven en providers estáticos (MediaMTX resync)', () => {
    // `get` lanza con un provider request-scoped: su `onApplicationBootstrap`
    // (que programa la resincronización) nunca correría.
    const { MediamtxSyncService } = jest.requireActual<
      typeof import('./cameras/mediamtx-sync.service')
    >('./cameras/mediamtx-sync.service');
    expect(() =>
      moduleRef.get(MediamtxSyncService, { strict: false }),
    ).not.toThrow();
  });
});
