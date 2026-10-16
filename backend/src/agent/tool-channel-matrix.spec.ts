import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DetectionsService } from '../detections/detections.service';
import { DigitalConciergeService } from '../digital-concierge/services/digital-concierge.service';
import { FamiliesService } from '../families/families.service';
import { HubGateway } from '../hub/hub.gateway';
import type { CreateSystemLogDto } from '../logs/dto/create-system-log.dto';
import type { LogsService } from '../logs/logs.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { VisitsService } from '../visits/visits.service';
import { AGENT_CHANNELS, type AgentChannel } from './agent-channel';
import { PendingActionStatus } from './entities/pending-action.entity';
import type { PendingActionsService } from './pending-actions.service';
import { ToolDispatcherService } from './tool-dispatcher.service';
import { ToolRegistryService } from './tool-registry.service';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';
import {
  VIGILIA_TOOL_CLASSES,
  vigiliaToolsProvider,
} from './vigilia-tools.provider';

/**
 * Fase 4 · P4.B (D8, cyber B2) — matriz tools × canal con el catálogo REAL:
 * el provider `VIGILIA_TOOLS` de AgentModule (`vigiliaToolsProvider`), con
 * los `allowedChannels`/`requiredScopes` de verdad de cada tool, y el
 * `ToolDispatcherService` real. Los servicios de dominio se stubbean: aquí
 * importa quién puede ver y ejecutar cada tool, no su lógica de negocio.
 */
describe('Tools por canal (Fase 4 · P4.B, D8)', () => {
  const ACCESS = 'digital-concierge.access';
  const MANAGE = 'digital-concierge.manage';

  const BASE_TOOLS = [
    'buscar_residente',
    'guardar_datos_visitante',
    'notificar_residente',
    'reenviar_notificacion',
    'finalizar_llamada',
  ];
  const CONSULTAS = [
    'consultar_vehiculo',
    'consultar_visitas',
    'consultar_accesos_recientes',
  ];

  let conciergeService: { findSessionForTenant: jest.Mock };
  let logsService: { log: jest.Mock };
  let pendingActionsService: { create: jest.Mock };
  let registry: ToolRegistryService;
  let dispatcher: ToolDispatcherService;

  function ctxFor(
    channel: AgentChannel,
    scopes: string[],
    overrides: Partial<AuthorizedContext> = {},
  ): AuthorizedContext {
    return {
      tenantId: 'condo-A',
      isSuperAdmin: false,
      userId: channel === 'human' ? 'user-1' : undefined,
      role: channel === 'human' ? 'Conserje' : 'hub',
      channel,
      scopes,
      requestId: 'req-1',
      sessionId: 'session-1',
      ...overrides,
    };
  }

  const physicalHub = (): AuthorizedContext => ctxFor('physical-hub', [ACCESS]);
  const kiosk = (): AuthorizedContext => ctxFor('web-kiosk', [ACCESS]);
  /** Rol Seguridad: solo `digital-concierge.access`. */
  const humanWithoutManage = (): AuthorizedContext => ctxFor('human', [ACCESS]);
  /** Roles Conserje / Administrador: `access` + `manage`. */
  const humanWithManage = (): AuthorizedContext =>
    ctxFor('human', [ACCESS, MANAGE]);

  function tool(name: string): VigiliaTool<unknown, unknown> {
    const found = registry.get(name);
    if (!found) {
      throw new Error(`tool ${name} no está en el catálogo`);
    }
    return found;
  }

  function namesFor(ctx: AuthorizedContext): string[] {
    return registry
      .getAvailableFor(ctx)
      .map((t) => t.name)
      .sort();
  }

  function lastAudit(): CreateSystemLogDto {
    const calls = logsService.log.mock.calls as CreateSystemLogDto[][];
    return calls[calls.length - 1][0];
  }

  beforeEach(async () => {
    conciergeService = {
      // Sesión sin casa de destino: `abrir_acceso` escala (fail-closed).
      findSessionForTenant: jest.fn().mockResolvedValue({
        sessionId: 'session-1',
        organizationId: 'condo-A',
        destinationHouse: null,
      }),
    };
    logsService = { log: jest.fn().mockResolvedValue(undefined) };
    pendingActionsService = {
      create: jest.fn().mockResolvedValue({
        id: 'pending-1',
        status: PendingActionStatus.PENDING,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ...VIGILIA_TOOL_CLASSES,
        vigiliaToolsProvider,
        ToolRegistryService,
        { provide: DigitalConciergeService, useValue: conciergeService },
        { provide: FamiliesService, useValue: {} },
        { provide: VisitsService, useValue: {} },
        { provide: VehiclesService, useValue: {} },
        { provide: DetectionsService, useValue: {} },
        { provide: HubGateway, useValue: {} },
      ],
    }).compile();
    registry = moduleRef.get(ToolRegistryService);
    dispatcher = new ToolDispatcherService(
      registry,
      logsService as unknown as LogsService,
      pendingActionsService as unknown as PendingActionsService,
    );
  });

  it('el catálogo real tiene las 9 tools y cada una declara allowedChannels explícitos (sin unknown)', () => {
    const tools = registry.getAll();

    expect(tools.map((t) => t.name).sort()).toEqual(
      [...BASE_TOOLS, ...CONSULTAS, 'abrir_acceso'].sort(),
    );
    for (const candidate of tools) {
      expect(Array.isArray(candidate.allowedChannels)).toBe(true);
      expect(candidate.allowedChannels.length).toBeGreaterThan(0);
      for (const channel of candidate.allowedChannels) {
        expect(AGENT_CHANNELS).toContain(channel);
        expect(channel).not.toBe('unknown');
      }
    }
  });

  it('matriz declarada por tool (allowedChannels + requiredScopes)', () => {
    const matrix = Object.fromEntries(
      registry
        .getAll()
        .map((t) => [
          t.name,
          { channels: [...t.allowedChannels].sort(), scopes: t.requiredScopes },
        ]),
    );
    const everyChannel = ['human', 'physical-hub', 'web-kiosk'];

    expect(matrix).toEqual({
      buscar_residente: { channels: everyChannel, scopes: [ACCESS] },
      guardar_datos_visitante: { channels: everyChannel, scopes: [ACCESS] },
      notificar_residente: { channels: everyChannel, scopes: [ACCESS] },
      reenviar_notificacion: { channels: everyChannel, scopes: [ACCESS] },
      finalizar_llamada: { channels: everyChannel, scopes: [ACCESS] },
      abrir_acceso: { channels: ['human', 'physical-hub'], scopes: [ACCESS] },
      consultar_vehiculo: { channels: ['human'], scopes: [MANAGE] },
      consultar_visitas: { channels: ['human'], scopes: [MANAGE] },
      consultar_accesos_recientes: { channels: ['human'], scopes: [MANAGE] },
    });
  });

  describe('tools visibles por contexto (ToolRegistryService.getAvailableFor)', () => {
    it('kiosko web: ni abrir_acceso ni consultar_*', () => {
      expect(namesFor(kiosk())).toEqual([...BASE_TOOLS].sort());
    });

    it('hub físico: abrir_acceso sí, consultar_* no', () => {
      expect(namesFor(physicalHub())).toEqual(
        [...BASE_TOOLS, 'abrir_acceso'].sort(),
      );
    });

    it('hub físico con un scope manage (no debería tenerlo): consultar_* sigue oculta por canal', () => {
      expect(namesFor(ctxFor('physical-hub', [ACCESS, MANAGE]))).not.toEqual(
        expect.arrayContaining(CONSULTAS),
      );
    });

    it('humano sin manage (Seguridad): sin consultar_*', () => {
      expect(namesFor(humanWithoutManage())).toEqual(
        [...BASE_TOOLS, 'abrir_acceso'].sort(),
      );
    });

    it('humano con manage (Conserje/Administrador): el catálogo completo', () => {
      expect(namesFor(humanWithManage())).toEqual(
        [...BASE_TOOLS, ...CONSULTAS, 'abrir_acceso'].sort(),
      );
    });

    it('canal unknown: ninguna tool, aunque traiga scopes', () => {
      expect(namesFor(ctxFor('unknown', [ACCESS, MANAGE]))).toEqual([]);
    });
  });

  describe('ejecución (ToolDispatcherService)', () => {
    it('kiosko -> abrir_acceso denegado por canal: sin evaluar autonomía, sin escalar y auditado', async () => {
      await expect(
        dispatcher.execute(tool('abrir_acceso'), kiosk(), { tipo: 'puerta' }),
      ).rejects.toThrow(ForbiddenException);

      expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
      expect(pendingActionsService.create).not.toHaveBeenCalled();
      expect(logsService.log).toHaveBeenCalledTimes(1);
      const audit = lastAudit();
      expect(audit.metadata).toEqual(
        expect.objectContaining({
          toolName: 'abrir_acceso',
          channel: 'web-kiosk',
          success: false,
          validationError: false,
        }),
      );
      expect(audit.errorMessage).toContain('canal "web-kiosk"');
    });

    it('hub físico -> abrir_acceso permitido: escala como antes (pendiente de aprobación)', async () => {
      const ctx = physicalHub();

      const result = await dispatcher.execute(tool('abrir_acceso'), ctx, {
        tipo: 'porton',
      });

      expect(result).toEqual(
        expect.objectContaining({
          pendiente: true,
          pendingActionId: 'pending-1',
        }),
      );
      expect(pendingActionsService.create).toHaveBeenCalledWith(
        tool('abrir_acceso'),
        ctx,
        { tipo: 'porton' },
      );
      expect(lastAudit().metadata).toEqual(
        expect.objectContaining({ channel: 'physical-hub', success: true }),
      );
    });

    it.each(CONSULTAS)(
      'humano sin manage -> %s denegado por scopes y auditado',
      async (toolName) => {
        const consulta = tool(toolName);
        const execute = jest.spyOn(consulta, 'execute');

        await expect(
          dispatcher.execute(consulta, humanWithoutManage(), {}),
        ).rejects.toThrow(/permisos requeridos/);

        expect(execute).not.toHaveBeenCalled();
        expect(lastAudit().metadata).toEqual(
          expect.objectContaining({
            toolName,
            channel: 'human',
            success: false,
          }),
        );
      },
    );

    it('humano con manage -> consultar_accesos_recientes se ejecuta', async () => {
      const consulta = tool('consultar_accesos_recientes');
      const execute = jest
        .spyOn(consulta, 'execute')
        .mockResolvedValue({ cantidad: 0, accesos: [] });
      const ctx = humanWithManage();

      await expect(dispatcher.execute(consulta, ctx, {})).resolves.toEqual({
        cantidad: 0,
        accesos: [],
      });
      expect(execute).toHaveBeenCalledWith(ctx, {});
    });

    it.each(CONSULTAS)(
      'hub físico -> %s denegado por canal aunque traiga manage',
      async (toolName) => {
        const consulta = tool(toolName);
        const execute = jest.spyOn(consulta, 'execute');

        await expect(
          dispatcher.execute(
            consulta,
            ctxFor('physical-hub', [ACCESS, MANAGE]),
            {},
          ),
        ).rejects.toThrow(/no está disponible en el canal "physical-hub"/);

        expect(execute).not.toHaveBeenCalled();
      },
    );

    it('canal unknown -> todas las tools denegadas (y auditadas), aunque traiga scopes', async () => {
      const unknownCtx = ctxFor('unknown', [ACCESS, MANAGE]);

      for (const candidate of registry.getAll()) {
        await expect(
          dispatcher.execute(candidate, unknownCtx, {}),
        ).rejects.toThrow(ForbiddenException);
      }

      expect(logsService.log).toHaveBeenCalledTimes(registry.getAll().length);
      expect(pendingActionsService.create).not.toHaveBeenCalled();
      for (const [entry] of logsService.log.mock
        .calls as CreateSystemLogDto[][]) {
        expect(entry.metadata).toEqual(
          expect.objectContaining({ channel: 'unknown', success: false }),
        );
      }
    });
  });
});
