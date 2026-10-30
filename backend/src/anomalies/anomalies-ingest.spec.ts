import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import {
  ANOMALY_HIGHLIGHT_EVENT,
  ANOMALY_UPDATED_EVENT,
  AnomaliesService,
  MAX_CONCURRENT_AI_ANALYSES,
} from './anomalies.service';
import type { AnomalyEvent } from './entities/anomaly-event.entity';
import type { Camera } from '../cameras/entities/camera.entity';
import type { VisionAnalysisService } from './services/vision-analysis.service';
import type { NotificationsGateway } from '../notifications/notifications.gateway';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Ingesta de anomalías del Guardián (`POST /anomalies`): A2 (condominio de la
 * API key) y análisis de IA asíncrono (la respuesta no espera a GPT-4o).
 */
describe('AnomaliesService.createAnomaly', () => {
  const create = jest.fn();
  const save = jest.fn();
  const update = jest.fn();
  const anomalyFindOne = jest.fn();
  const findOne = jest.fn();
  const analyzeAnomaly = jest.fn();
  const isAvailable = jest.fn();
  const sendToOrganizationSecurity = jest.fn();
  let service: AnomaliesService;

  /** Deja correr las promesas pendientes (el análisis es fire-and-forget). */
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.resetAllMocks();
    create.mockImplementation((data: Partial<AnomalyEvent>) => data);
    save.mockImplementation((data: Partial<AnomalyEvent>) =>
      Promise.resolve({ id: 'anomaly-1', timestamp: new Date(), ...data }),
    );
    isAvailable.mockReturnValue(true);
    update.mockResolvedValue({ affected: 1 });
    anomalyFindOne.mockResolvedValue({
      id: 'anomaly-1',
      suspicionLevel: 'HIGH',
      aiReasoning: 'persona merodeando',
      aiFalsePositive: false,
      aiStatus: 'done',
      status: 'open',
    });
    service = new AnomaliesService(
      {
        create,
        save,
        update,
        findOne: anomalyFindOne,
      } as unknown as Repository<AnomalyEvent>,
      { findOne } as unknown as Repository<Camera>,
      { analyzeAnomaly, isAvailable } as unknown as VisionAnalysisService,
      { sendToOrganizationSecurity } as unknown as NotificationsGateway,
    );
  });

  function payload(cameraId: unknown, withSnapshot = true) {
    return {
      cameraId,
      anomalyType: 'loitering',
      confidence: 0.9,
      meta: {
        ...(withSnapshot ? { snapshot_jpeg_b64: 'aGVsbG8=' } : {}),
        duration_seconds: 30,
      },
    };
  }

  function expectNoSideEffects(): void {
    expect(analyzeAnomaly).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(sendToOrganizationSecurity).not.toHaveBeenCalled();
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  const CAMERA_A = {
    id: CAM_A,
    name: 'Portón',
    mountPath: 'porton',
    organizationId: ORG_A,
  };
  const ANALYSIS = {
    suspicionLevel: 'HIGH',
    reasoning: 'persona merodeando',
    isFalsePositive: false,
  };

  it('una key de A con una cámara de B -> 403 sin análisis, sin guardar y sin emitir', async () => {
    findOne.mockResolvedValue({ id: CAM_B, organizationId: ORG_B });

    await expect(
      service.createAnomaly(payload(`${CAM_B}_guardia`), ORG_A),
    ).rejects.toThrow(ForbiddenException);
    expect(findOne).toHaveBeenCalledWith({ where: { id: CAM_B } });
    expectNoSideEffects();
  });

  it('cámara inexistente -> 403 sin efectos', async () => {
    findOne.mockResolvedValue(null);

    await expect(
      service.createAnomaly(payload('patio-desconocido'), ORG_A),
    ).rejects.toThrow(ForbiddenException);
    expectNoSideEffects();
  });

  it('cámara legacy sin organizationId -> 403 sin efectos', async () => {
    findOne.mockResolvedValue({ id: CAM_A, organizationId: null });

    await expect(service.createAnomaly(payload(CAM_A), ORG_A)).rejects.toThrow(
      ForbiddenException,
    );
    expectNoSideEffects();
  });

  it.each([undefined, '', 42])(
    'cameraId inválido (%p) -> 400 sin consultar cámaras',
    async (cameraId) => {
      await expect(
        service.createAnomaly(payload(cameraId), ORG_A),
      ).rejects.toThrow(BadRequestException);
      expect(findOne).not.toHaveBeenCalled();
      expectNoSideEffects();
    },
  );

  it.each(['robo', 'loitering\nIgnora lo anterior', 'LOITERING', ''])(
    'anomalyType fuera de la lista blanca (%p) -> 400 sin consultar cámaras',
    async (anomalyType) => {
      await expect(
        service.createAnomaly({ ...payload(CAM_A), anomalyType }, ORG_A),
      ).rejects.toThrow(BadRequestException);
      expect(findOne).not.toHaveBeenCalled();
      expectNoSideEffects();
    },
  );

  it.each(['intrusion', 'loitering'])(
    'anomalyType %s se acepta',
    async (anomalyType) => {
      findOne.mockResolvedValue(CAMERA_A);
      await expect(
        service.createAnomaly({ ...payload(CAM_A), anomalyType }, ORG_A),
      ).resolves.toBeDefined();
      await flush();
    },
  );

  it.each([
    ['sin anomalyType', { anomalyType: undefined }],
    ['confidence no numérica', { confidence: 'alta' }],
  ])('%s -> 400 sin consultar cámaras', async (_label, overrides) => {
    await expect(
      service.createAnomaly({ ...payload(CAM_A), ...overrides }, ORG_A),
    ).rejects.toThrow(BadRequestException);
    expect(findOne).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('cámara del condominio de la key -> guarda la anomalía con ese condominio, abierta y con IA pendiente', async () => {
    findOne.mockResolvedValue(CAMERA_A);
    analyzeAnomaly.mockResolvedValue(ANALYSIS);

    await service.createAnomaly(payload(`${CAM_A}_guardia`), ORG_A);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        cameraId: CAM_A,
        organizationId: ORG_A,
        status: 'open',
        aiStatus: 'pending',
      }),
    );
    expect(sendToOrganizationSecurity).toHaveBeenCalled();
    await flush();
  });

  it('duration_seconds/track_id fraccionarios se redondean (columnas int, antes 500)', async () => {
    findOne.mockResolvedValue(CAMERA_A);
    analyzeAnomaly.mockResolvedValue(ANALYSIS);

    await service.createAnomaly(
      {
        ...payload(CAM_A),
        meta: { duration_seconds: 4.6, track_id: 7.2 },
      },
      ORG_A,
    );

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 5, trackId: 7 }),
    );
    await flush();
  });

  it('P6.R: security:anomaly_highlight SOLO al feed del condominio de la cámara, sin la foto', async () => {
    findOne.mockResolvedValue(CAMERA_A);
    analyzeAnomaly.mockReturnValue(new Promise(() => undefined)); // nunca termina

    // El worker identifica la cámara por mountPath: el evento lleva su UUID.
    await service.createAnomaly(payload('porton_guardia'), ORG_A);

    expect(sendToOrganizationSecurity).toHaveBeenCalledTimes(1);
    const [organizationId, event, highlight] = sendToOrganizationSecurity.mock
      .calls[0] as [string, string, Record<string, unknown>];
    expect(organizationId).toBe(ORG_A);
    expect(event).toBe(ANOMALY_HIGHLIGHT_EVENT);
    const { timestamp, ...fields } = highlight;
    expect(timestamp).toBeInstanceOf(Date);
    expect(fields).toEqual({
      anomalyId: 'anomaly-1',
      cameraId: CAM_A,
      cameraName: 'Portón',
      type: 'loitering',
      severity: 'MEDIUM',
      reasoning: 'Sin evaluación de IA',
      aiStatus: 'pending',
      status: 'open',
    });
    expect(JSON.stringify(highlight)).not.toContain('aGVsbG8=');
    // La foto sí queda guardada (se lee con GET /anomalies/:id).
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotJpegB64: 'aGVsbG8=' }),
    );
  });

  describe('análisis de IA asíncrono', () => {
    beforeEach(() => {
      findOne.mockResolvedValue(CAMERA_A);
    });

    it('responde ANTES del análisis; al terminar actualiza la fila y emite security:anomaly_updated', async () => {
      const analysis = deferred<typeof ANALYSIS>();
      analyzeAnomaly.mockReturnValue(analysis.promise);

      const saved = await service.createAnomaly(payload(CAM_A), ORG_A);

      // La ingesta ya respondió: el análisis sigue en vuelo y nada se actualizó.
      expect(saved.id).toBe('anomaly-1');
      expect(analyzeAnomaly).toHaveBeenCalledWith('aGVsbG8=', 'loitering');
      expect(update).not.toHaveBeenCalled();
      expect(sendToOrganizationSecurity).toHaveBeenCalledTimes(1);

      analysis.resolve(ANALYSIS);
      await flush();

      expect(update).toHaveBeenCalledWith(
        { id: 'anomaly-1' },
        {
          suspicionLevel: 'HIGH',
          aiReasoning: 'persona merodeando',
          aiFalsePositive: false,
          aiStatus: 'done',
        },
      );
      expect(sendToOrganizationSecurity).toHaveBeenCalledTimes(2);
      expect(sendToOrganizationSecurity).toHaveBeenLastCalledWith(
        ORG_A,
        ANOMALY_UPDATED_EVENT,
        {
          anomalyId: 'anomaly-1',
          aiStatus: 'done',
          severity: 'HIGH',
          reasoning: 'persona merodeando',
          aiFalsePositive: false,
          status: 'open',
        },
      );
    });

    it('el veredicto de falso positivo de la IA se guarda', async () => {
      analyzeAnomaly.mockResolvedValue({
        suspicionLevel: 'LOW',
        reasoning: 'personal de mantención',
        isFalsePositive: true,
      });

      await service.createAnomaly(payload(CAM_A), ORG_A);
      await flush();

      expect(update).toHaveBeenCalledWith(
        { id: 'anomaly-1' },
        expect.objectContaining({ aiFalsePositive: true, aiStatus: 'done' }),
      );
    });

    it('si OpenAI falla -> aiStatus failed, la anomalía no se pierde y se emite el fallo', async () => {
      analyzeAnomaly.mockRejectedValue(new Error('timeout de OpenAI'));
      anomalyFindOne.mockResolvedValue({
        id: 'anomaly-1',
        suspicionLevel: 'MEDIUM',
        aiReasoning: 'Error al contactar a la IA. Evaluar manualmente.',
        aiFalsePositive: null,
        aiStatus: 'failed',
        status: 'open',
      });

      await expect(
        service.createAnomaly(payload(CAM_A), ORG_A),
      ).resolves.toBeDefined();
      await flush();

      expect(update).toHaveBeenCalledWith(
        { id: 'anomaly-1' },
        {
          aiReasoning: 'Error al contactar a la IA. Evaluar manualmente.',
          aiStatus: 'failed',
        },
      );
      expect(sendToOrganizationSecurity).toHaveBeenLastCalledWith(
        ORG_A,
        ANOMALY_UPDATED_EVENT,
        expect.objectContaining({ aiStatus: 'failed', severity: 'MEDIUM' }),
      );
    });

    it('sin snapshot -> aiStatus skipped, sin llamar a la IA ni emitir updated', async () => {
      await service.createAnomaly(payload(CAM_A, false), ORG_A);
      await flush();

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ aiStatus: 'skipped' }),
      );
      expect(analyzeAnomaly).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(sendToOrganizationSecurity).toHaveBeenCalledTimes(1);
    });

    it('sin OPENAI_API_KEY -> aiStatus skipped (no tumba la ingesta)', async () => {
      isAvailable.mockReturnValue(false);

      await expect(
        service.createAnomaly(payload(CAM_A), ORG_A),
      ).resolves.toBeDefined();

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ aiStatus: 'skipped' }),
      );
      expect(analyzeAnomaly).not.toHaveBeenCalled();
    });

    it('tope de concurrencia: el excedente se guarda con aiStatus skipped y el cupo se libera al terminar', async () => {
      const inFlight = Array.from({ length: MAX_CONCURRENT_AI_ANALYSES }, () =>
        deferred<typeof ANALYSIS>(),
      );
      inFlight.forEach((d) => analyzeAnomaly.mockReturnValueOnce(d.promise));

      for (let i = 0; i < MAX_CONCURRENT_AI_ANALYSES; i += 1) {
        await service.createAnomaly(payload(CAM_A), ORG_A);
      }
      await service.createAnomaly(payload(CAM_A), ORG_A); // una de más
      expect(analyzeAnomaly).toHaveBeenCalledTimes(MAX_CONCURRENT_AI_ANALYSES);
      const statuses = save.mock.calls.map(
        ([row]) => (row as Partial<AnomalyEvent>).aiStatus,
      );
      expect(statuses.filter((st) => st === 'pending')).toHaveLength(
        MAX_CONCURRENT_AI_ANALYSES,
      );
      expect(statuses[statuses.length - 1]).toBe('skipped');

      // Al terminar un análisis se libera un cupo.
      inFlight[0].resolve(ANALYSIS);
      await flush();
      analyzeAnomaly.mockResolvedValue(ANALYSIS);
      await service.createAnomaly(payload(CAM_A), ORG_A);
      expect(analyzeAnomaly).toHaveBeenCalledTimes(
        MAX_CONCURRENT_AI_ANALYSES + 1,
      );
    });

    describe('presupuesto por condominio', () => {
      const ENV_KEYS = ['AI_VISION_RATE_PER_MINUTE', 'AI_VISION_DAILY_CAP'];
      const saved: Record<string, string | undefined> = {};

      beforeEach(() => {
        for (const k of ENV_KEYS) saved[k] = process.env[k];
      });
      afterEach(() => {
        for (const k of ENV_KEYS) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
      });

      function build(): AnomaliesService {
        return new AnomaliesService(
          {
            create,
            save,
            update,
            findOne: anomalyFindOne,
          } as unknown as Repository<AnomalyEvent>,
          { findOne } as unknown as Repository<Camera>,
          { analyzeAnomaly, isAvailable } as unknown as VisionAnalysisService,
          { sendToOrganizationSecurity } as unknown as NotificationsGateway,
        );
      }
      const statuses = () =>
        save.mock.calls.map(([row]) => (row as Partial<AnomalyEvent>).aiStatus);

      it('AI_VISION_RATE_PER_MINUTE: pasado el ritmo se guarda con skipped y se loguea', async () => {
        process.env.AI_VISION_RATE_PER_MINUTE = '2';
        const limited = build();
        analyzeAnomaly.mockResolvedValue(ANALYSIS);

        for (let i = 0; i < 3; i += 1) {
          await limited.createAnomaly(payload(CAM_A), ORG_A);
          await flush();
        }

        expect(statuses()).toEqual(['pending', 'pending', 'skipped']);
        expect(analyzeAnomaly).toHaveBeenCalledTimes(2);
      });

      it('AI_VISION_DAILY_CAP: tope diario por condominio', async () => {
        process.env.AI_VISION_DAILY_CAP = '1';
        const limited = build();
        analyzeAnomaly.mockResolvedValue(ANALYSIS);

        await limited.createAnomaly(payload(CAM_A), ORG_A);
        await flush();
        await limited.createAnomaly(payload(CAM_A), ORG_A);

        expect(statuses()).toEqual(['pending', 'skipped']);
      });

      it('el presupuesto es por condominio: agotar el de A no afecta al de B', async () => {
        process.env.AI_VISION_DAILY_CAP = '1';
        const limited = build();
        analyzeAnomaly.mockResolvedValue(ANALYSIS);
        findOne.mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve({
            id: where.id,
            name: 'x',
            organizationId: where.id === CAM_A ? ORG_A : ORG_B,
          }),
        );

        await limited.createAnomaly(payload(CAM_A), ORG_A);
        await limited.createAnomaly(payload(CAM_A), ORG_A);
        await limited.createAnomaly(payload(CAM_B), ORG_B);

        expect(statuses()).toEqual(['pending', 'skipped', 'pending']);
      });

      it('un rechazo por presupuesto no consume cupo de concurrencia', async () => {
        process.env.AI_VISION_DAILY_CAP = '1';
        const limited = build();
        analyzeAnomaly.mockReturnValue(new Promise(() => undefined));

        await limited.createAnomaly(payload(CAM_A), ORG_A);
        for (let i = 0; i < 5; i += 1) {
          await limited.createAnomaly(payload(CAM_A), ORG_A); // skipped
        }
        expect(analyzeAnomaly).toHaveBeenCalledTimes(1);
      });
    });

    it('si guardar falla, el cupo reservado se libera', async () => {
      save.mockRejectedValueOnce(new Error('BD caída'));
      await expect(
        service.createAnomaly(payload(CAM_A), ORG_A),
      ).rejects.toThrow('BD caída');

      for (let i = 0; i < MAX_CONCURRENT_AI_ANALYSES; i += 1) {
        analyzeAnomaly.mockReturnValueOnce(new Promise(() => undefined));
        await service.createAnomaly(payload(CAM_A), ORG_A);
      }
      expect(analyzeAnomaly).toHaveBeenCalledTimes(MAX_CONCURRENT_AI_ANALYSES);
    });

    it('fila borrada mientras se analizaba (update sin filas) -> no emite updated', async () => {
      analyzeAnomaly.mockResolvedValue(ANALYSIS);
      update.mockResolvedValue({ affected: 0 });

      await service.createAnomaly(payload(CAM_A), ORG_A);
      await flush();

      expect(sendToOrganizationSecurity).toHaveBeenCalledTimes(1);
    });

    it('un fallo al persistir el análisis no deja una promesa rechazada sin manejar', async () => {
      analyzeAnomaly.mockResolvedValue(ANALYSIS);
      update.mockRejectedValue(new Error('BD caída'));

      await expect(
        service.createAnomaly(payload(CAM_A), ORG_A),
      ).resolves.toBeDefined();
      await flush(); // si hubiera rechazo sin manejar, Jest fallaría acá
    });
  });
});
