import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DetectionsModule } from '../detections/detections.module';
import { ConciergeAuthGuard } from '../digital-concierge/guards/concierge-auth.guard';
import { DigitalConciergeModule } from '../digital-concierge/digital-concierge.module';
import { FamiliesModule } from '../families/families.module';
import { HubModule } from '../hub/hub.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { VisitsModule } from '../visits/visits.module';
import {
  AGENT_LANGUAGE_MODEL,
  createAgentLanguageModel,
} from './agent-model.provider';
import { AgentController } from './agent.controller';
import { AgentRunnerService } from './agent-runner.service';
import { AuthorizedContextFactory } from './authorized-context.factory';
import { PendingAction } from './entities/pending-action.entity';
import { PendingActionsController } from './pending-actions.controller';
import { PendingActionsService } from './pending-actions.service';
import { ToolDispatcherService } from './tool-dispatcher.service';
import { ToolRegistryService } from './tool-registry.service';
import { VIGILIA_TOOLS } from './tool-registry.token';
import { AbrirAccesoTool } from './tools/abrir-acceso.tool';
import { BuscarResidenteTool } from './tools/buscar-residente.tool';
import { ConsultarAccesosRecientesTool } from './tools/consultar-accesos-recientes.tool';
import { ConsultarVehiculoTool } from './tools/consultar-vehiculo.tool';
import { ConsultarVisitasTool } from './tools/consultar-visitas.tool';
import { FinalizarLlamadaTool } from './tools/finalizar-llamada.tool';
import { GuardarDatosVisitanteTool } from './tools/guardar-datos-visitante.tool';
import { NotificarResidenteTool } from './tools/notificar-residente.tool';
import { ReenviarNotificacionTool } from './tools/reenviar-notificacion.tool';

/**
 * Módulo del agente-cerebro (Fase 1, Bloques A2a/A2b —
 * docs/modulos/agente-cerebro.md §4/§10.2). Fundaciones: contrato
 * `VigiliaTool` + registry + dispatcher + Agent Runner (AI SDK) + un único
 * endpoint de texto verificable (`AgentController`).
 *
 * Reusa `ConciergeAuthGuard` (mismo guard de transporte que
 * `DigitalConciergeModule`, hub físico O sesión humana) — se reusa la clase
 * TAL CUAL (no se reescribe), registrada acá como provider para que Nest la
 * resuelva en el contexto de ESTE módulo. `imports` replica EXACTAMENTE el
 * mismo set que `DigitalConciergeModule` necesitó para esto mismo
 * (digital-concierge.module.ts): `UsersModule` + `HubModule` + `AuthModule`
 * — `AuthGuard`/`HubAuthGuard` NO se re-declaran como providers locales,
 * llegan ya resueltos vía las exportaciones de esos módulos.
 *
 * `forwardRef(() => DigitalConciergeModule)` (Bloque A2b): las 4 tools nuevas
 * (guardar_datos_visitante, notificar_residente, reenviar_notificacion,
 * finalizar_llamada) son adaptadores delgados sobre
 * `DigitalConciergeService` — la inyectan por constructor. A su vez,
 * `DigitalConciergeModule` importa ESTE módulo (`forwardRef` también del otro
 * lado) porque `DigitalConciergeController.executeTool` necesita
 * `ToolDispatcherService`/`ToolRegistryService`/`AuthorizedContextFactory`
 * para reemplazar su antiguo `switch`. Es una dependencia circular real a
 * nivel de MÓDULO (no de provider: ningún provider de un lado depende
 * transitivamente de sí mismo) — `forwardRef` en ambos `@Module.imports` es
 * la solución estándar de Nest para este caso, documentada en
 * https://docs.nestjs.com/fundamentals/circular-dependency.
 *
 * Fase 2 (§8 del doc) agrega el resto del catálogo: solo hace falta un nuevo
 * provider de tool + agregarlo a la factory de `VIGILIA_TOOLS` de abajo — el
 * registry/dispatcher/runner no cambian.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PendingAction]),
    UsersModule,
    FamiliesModule,
    HubModule,
    AuthModule,
    NotificationsModule,
    // Fase 2, Bloque F2.1 (docs/modulos/agente-cerebro.md §12): las 3 tools de
    // consulta nuevas inyectan estos servicios de dominio directo — ninguno
    // importa AgentModule de vuelta, así que no hace falta forwardRef (a
    // diferencia de DigitalConciergeModule más abajo).
    VehiclesModule,
    VisitsModule,
    DetectionsModule,
    forwardRef(() => DigitalConciergeModule),
  ],
  controllers: [AgentController, PendingActionsController],
  providers: [
    // Guard de transporte reusado (ver docstring de la clase arriba). Sus
    // dependencias (HubAuthGuard, AuthGuard) llegan vía los `imports` de
    // arriba — no se re-declaran acá.
    ConciergeAuthGuard,

    // Catálogo de tools (Fase 2 agrega más entradas acá).
    BuscarResidenteTool,
    GuardarDatosVisitanteTool,
    NotificarResidenteTool,
    ReenviarNotificacionTool,
    FinalizarLlamadaTool,
    ConsultarVehiculoTool,
    ConsultarVisitasTool,
    ConsultarAccesosRecientesTool,
    // Fase 2, Bloque F2.2 (docs/modulos/agente-cerebro.md §12): apertura física
    // de accesos con autonomía condicional (`requiresApproval` dinámico) —
    // inyecta `DigitalConciergeService` (igual que `finalizar_llamada`/
    // `notificar_residente`, ver forwardRef abajo) + `HubGateway` (ya exportado
    // por `HubModule`, importado arriba).
    AbrirAccesoTool,
    {
      provide: VIGILIA_TOOLS,
      useFactory: (
        buscarResidente: BuscarResidenteTool,
        guardarDatosVisitante: GuardarDatosVisitanteTool,
        notificarResidente: NotificarResidenteTool,
        reenviarNotificacion: ReenviarNotificacionTool,
        finalizarLlamada: FinalizarLlamadaTool,
        consultarVehiculo: ConsultarVehiculoTool,
        consultarVisitas: ConsultarVisitasTool,
        consultarAccesosRecientes: ConsultarAccesosRecientesTool,
        abrirAcceso: AbrirAccesoTool,
      ) => [
        buscarResidente,
        guardarDatosVisitante,
        notificarResidente,
        reenviarNotificacion,
        finalizarLlamada,
        consultarVehiculo,
        consultarVisitas,
        consultarAccesosRecientes,
        abrirAcceso,
      ],
      inject: [
        BuscarResidenteTool,
        GuardarDatosVisitanteTool,
        NotificarResidenteTool,
        ReenviarNotificacionTool,
        FinalizarLlamadaTool,
        ConsultarVehiculoTool,
        ConsultarVisitasTool,
        ConsultarAccesosRecientesTool,
        AbrirAccesoTool,
      ],
    },
    ToolRegistryService,

    // Fase 2, Bloque F2.1: mecanismo de autonomía/aprobación —
    // `ToolDispatcherService` la usa para escalar (`requiresApproval`), el
    // endpoint de aprobación (`PendingActionsController`) la usa para
    // resolver. Ver su docstring sobre por qué NO depende de vuelta de
    // `ToolDispatcherService` (evita un ciclo de providers).
    PendingActionsService,
    ToolDispatcherService,

    // Modelo del AI SDK — provider-agnóstico, configurable por env (ver
    // agent-model.provider.ts).
    {
      provide: AGENT_LANGUAGE_MODEL,
      useFactory: (config: ConfigService) => createAgentLanguageModel(config),
      inject: [ConfigService],
    },

    AuthorizedContextFactory,
    AgentRunnerService,
  ],
  // Bloque A2b: `DigitalConciergeController` (otro módulo, ver forwardRef
  // arriba) necesita estos tres para reemplazar su `switch` por el
  // dispatcher del catálogo — ver digital-concierge.module.ts.
  exports: [
    ToolDispatcherService,
    ToolRegistryService,
    AuthorizedContextFactory,
  ],
})
export class AgentModule {}
