import { In, type FindOperator, type Repository } from 'typeorm';
import {
  AI_PENDING_MAX_AGE_MS,
  AI_PENDING_SWEEP_INTERVAL_MS,
  ANOMALY_UPDATED_EVENT,
  AnomaliesService,
} from './anomalies.service';
import type { AnomalyEvent } from './entities/anomaly-event.entity';
import type { Camera } from '../cameras/entities/camera.entity';
import type { VisionAnalysisService } from './services/vision-analysis.service';
import type { NotificationsGateway } from '../notifications/notifications.gateway';

const ORG_A = '11111111-1111-4111-8111-111111111111';

/** Barrido de análisis de IA `pending` huérfanos (el proceso murió a medias). */
describe('AnomaliesService — barrido de pending huérfanos', () => {
  const find = jest.fn();
  const update = jest.fn();
  const sendToOrganizationSecurity = jest.fn();
  let service: AnomaliesService;

  beforeEach(() => {
    jest.resetAllMocks();
    update.mockResolvedValue({ affected: 1 });
    service = new AnomaliesService(
      { find, update } as unknown as Repository<AnomalyEvent>,
      {} as Repository<Camera>,
      {} as VisionAnalysisService,
      { sendToOrganizationSecurity } as unknown as NotificationsGateway,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('busca pending con más de 5 min, los marca failed (solo si siguen pending) y avisa al condominio', async () => {
    const now = new Date('2026-10-22T12:00:00.000Z');
    find.mockResolvedValue([
      {
        id: 'a-1',
        organizationId: ORG_A,
        suspicionLevel: 'MEDIUM',
        aiFalsePositive: null,
        status: 'open',
      },
      { id: 'a-2', organizationId: null, suspicionLevel: 'MEDIUM' },
    ]);

    await expect(service.sweepOrphanedPending(now)).resolves.toBe(2);

    const [[query]] = find.mock.calls as Array<
      [{ where: { aiStatus: string; timestamp: FindOperator<Date> } }]
    >;
    expect(query.where.aiStatus).toBe('pending');
    expect(query.where.timestamp.type).toBe('lessThan');
    expect((query.where.timestamp.value).getTime()).toBe(
      now.getTime() - AI_PENDING_MAX_AGE_MS,
    );
    expect(update).toHaveBeenCalledWith(
      { id: In(['a-1', 'a-2']), aiStatus: 'pending' },
      {
        aiStatus: 'failed',
        aiReasoning: 'Análisis interrumpido. Evaluar manualmente.',
      },
    );
    // Solo la fila con condominio se emite (sin condominio no hay feed).
    expect(sendToOrganizationSecurity).toHaveBeenCalledTimes(1);
    expect(sendToOrganizationSecurity).toHaveBeenCalledWith(
      ORG_A,
      ANOMALY_UPDATED_EVENT,
      expect.objectContaining({
        anomalyId: 'a-1',
        aiStatus: 'failed',
        reasoning: 'Análisis interrumpido. Evaluar manualmente.',
      }),
    );
  });

  it('sin huérfanos no actualiza ni emite', async () => {
    find.mockResolvedValue([]);

    await expect(service.sweepOrphanedPending()).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(sendToOrganizationSecurity).not.toHaveBeenCalled();
  });

  it('al arrancar barre una vez y luego periódicamente; onModuleDestroy lo detiene', async () => {
    jest.useFakeTimers();
    find.mockResolvedValue([]);

    service.onApplicationBootstrap();
    expect(find).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5_000);
    expect(find).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(AI_PENDING_SWEEP_INTERVAL_MS);
    expect(find).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(AI_PENDING_SWEEP_INTERVAL_MS * 3);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('un fallo del barrido no rompe el ciclo: se reintenta en el siguiente', async () => {
    jest.useFakeTimers();
    find.mockRejectedValueOnce(new Error('BD caída')).mockResolvedValue([]);

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(AI_PENDING_SWEEP_INTERVAL_MS);

    expect(find).toHaveBeenCalledTimes(2);
  });
});
