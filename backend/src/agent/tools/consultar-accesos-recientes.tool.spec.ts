import { ConsultarAccesosRecientesTool } from './consultar-accesos-recientes.tool';
import { DetectionsService } from '../../detections/detections.service';
import type { AccessAttempt } from '../../detections/entities/access-attempt.entity';
import type { PlateDetection } from '../../detections/entities/plate-detection.entity';
import type { User } from '../../users/entities/user.entity';
import type { AuthorizedContext } from '../types/authorized-context.type';

/**
 * Fase 2, Bloque F2.1 — cobertura de `ConsultarAccesosRecientesTool`
 * (docs/modulos/agente-cerebro.md §12). NO llama a la BD: `DetectionsService`
 * mockeado.
 *
 * A diferencia de `consultar_vehiculo`/`consultar_visitas`, acá el
 * aislamiento por tenant se delega en `DetectionsService.listAttempts`
 * (parámetro `tenantScope` agregado en este bloque) — el test verifica que
 * la tool SIEMPRE pasa `{ organizationId: ctx.tenantId, isSuperAdmin }`, no
 * que confía en el default sin filtro.
 */
describe('ConsultarAccesosRecientesTool', () => {
  let tool: ConsultarAccesosRecientesTool;
  let detectionsService: jest.Mocked<Pick<DetectionsService, 'listAttempts'>>;

  function makeCtx(
    overrides: Partial<AuthorizedContext> = {},
  ): AuthorizedContext {
    return {
      tenantId: 'condo-A',
      isSuperAdmin: false,
      userId: undefined,
      role: 'hub',
      scopes: ['digital-concierge.access'],
      requestId: 'req-1',
      ...overrides,
    };
  }

  function makeAttempt(overrides: Partial<AccessAttempt> = {}): AccessAttempt {
    return {
      id: 'attempt-1',
      decision: 'Permitido',
      reason: 'Vehículo residente registrado y activo',
      createdAt: new Date('2026-07-12T10:00:00Z'),
      detection: { plate: 'ABCD12' } as unknown as PlateDetection,
      residente: { name: 'Juan Pérez' } as unknown as User,
      ...overrides,
    } as AccessAttempt;
  }

  beforeEach(() => {
    detectionsService = { listAttempts: jest.fn().mockResolvedValue([]) };
    tool = new ConsultarAccesosRecientesTool(
      detectionsService as unknown as DetectionsService,
    );
  });

  it('pasa el tenant del ctx (organizationId/isSuperAdmin) a listAttempts, con el límite por defecto', async () => {
    await tool.execute(
      makeCtx({ tenantId: 'condo-A', isSuperAdmin: false }),
      {},
    );

    expect(detectionsService.listAttempts).toHaveBeenCalledWith(10, {
      organizationId: 'condo-A',
      isSuperAdmin: false,
    });
  });

  it('respeta el límite explícito del input', async () => {
    await tool.execute(makeCtx(), { limite: 5 });

    expect(detectionsService.listAttempts).toHaveBeenCalledWith(5, {
      organizationId: 'condo-A',
      isSuperAdmin: false,
    });
  });

  it('mapea los AccessAttempt a la forma de salida esperada', async () => {
    detectionsService.listAttempts.mockResolvedValue([
      makeAttempt(),
      makeAttempt({
        id: 'attempt-2',
        decision: 'Denegado',
        residente: null,
        detection: null as unknown as PlateDetection,
      }),
    ]);

    const result = await tool.execute(makeCtx(), {});

    expect(result.cantidad).toBe(2);
    expect(result.accesos[0]).toEqual({
      patente: 'ABCD12',
      decision: 'Permitido',
      motivo: 'Vehículo residente registrado y activo',
      fecha: '2026-07-12T10:00:00.000Z',
      residente: 'Juan Pérez',
    });
    expect(result.accesos[1]).toMatchObject({
      patente: null,
      residente: null,
      decision: 'Denegado',
    });
  });

  it('un super-admin propaga isSuperAdmin:true — sin filtro de tenant en listAttempts', async () => {
    await tool.execute(
      makeCtx({ tenantId: 'condo-A', isSuperAdmin: true }),
      {},
    );

    expect(detectionsService.listAttempts).toHaveBeenCalledWith(10, {
      organizationId: 'condo-A',
      isSuperAdmin: true,
    });
  });
});
