import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Fase 2, Bloque F2.1 (docs/modulos/agente-cerebro.md §12): estados del ciclo
 * de vida de una `PendingAction`.
 *
 *   pending   → creada por `ToolDispatcherService` cuando `tool.requiresApproval`
 *               es `true`; todavía no se decidió nada.
 *   approved  → un humano autorizado aprobó, pero la ejecución de la tool aún
 *               no terminó (estado transitorio dentro de `PendingActionsService.approve`,
 *               nunca debería observarse "en reposo" salvo un crash a mitad de la ejecución).
 *   rejected  → un humano autorizado rechazó — estado terminal, nunca se ejecuta.
 *   executed  → la tool ya corrió y `result` tiene su salida — estado terminal,
 *               es la base de la idempotencia (`approve` sobre una acción ya
 *               `executed` NO vuelve a ejecutar, devuelve `result`).
 *   failed    → (revisión pre-F2.2, fix del bloqueo detectado en QA) `tool.execute()`
 *               lanzó DESPUÉS de la aprobación — NO es terminal: `approve()`
 *               reclama también desde `failed` (ver su docstring), permitiendo
 *               reintentar la misma acción sin crear una nueva. `lastError`
 *               guarda el motivo del último fallo.
 *   expired   → (revisión pre-F2.2) el contexto que originó la escalada dejó de
 *               ser válido antes de poder ejecutar (p.ej. la `ConciergeSession`
 *               del citófono ya terminó) — terminal, NUNCA se ejecuta la tool
 *               desde acá. Crítico para que el portón (F2.2) no abra por una
 *               llamada que ya colgó.
 */
export enum PendingActionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXECUTED = 'executed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

/**
 * Fase 2, Bloque F2.1 (docs/modulos/agente-cerebro.md §12): mecanismo de
 * autonomía/aprobación del agente-cerebro. Hasta este bloque
 * `VigiliaTool.requiresApproval` existía en el contrato (§5 del diseño) pero
 * estaba MUERTO — ningún consumidor lo leía. Esta entidad es lo que
 * `ToolDispatcherService.execute` crea en vez de ejecutar directamente
 * cuando una tool declara `requiresApproval: true` (ver su docstring).
 *
 * Diseño deliberado de cada columna:
 *  - `tenantId`: SIEMPRE copiado de `ctx.tenantId` en el momento de crear la
 *    acción (nunca del input) — mismo criterio de aislamiento que el resto
 *    del catálogo (§5/§6 del diseño). Nullable por el mismo "cajón sin
 *    condominio" que el resto de columnas `organizationId`/`tenantId` del
 *    sistema (hub aún no asociado, etc.).
 *  - `sessionId`: nullable porque no toda tool que pudiera requerir
 *    aprobación opera sobre una `ConciergeSession` (ver el mismo comentario
 *    en `AuthorizedContext.sessionId` — p.ej. el canal de texto de
 *    `AgentController` no siempre trae una).
 *  - `input`: el input YA VALIDADO por `tool.inputSchema` (post-Zod) — nunca
 *    el `rawInput` sin validar — para que la ejecución diferida en
 *    `approve()` no tenga que re-validar contra un modelo que pudo cambiar
 *    de opinión mientras esperaba aprobación.
 *  - `requestId`: `ctx.requestId` del turno que originó la escalada —
 *    correlación de auditoría (mismo campo que ya usa `logs.service` para
 *    todo el resto del catálogo). La idempotencia real de la EJECUCIÓN no
 *    depende de este campo sino de `status` (ver `PendingActionsService.approve`,
 *    actualización atómica condicionada a `status != executed`).
 *  - `contextSnapshot`: el `AuthorizedContext` COMPLETO que autorizó la
 *    escalada. Necesario porque `approve()` ocurre en un turno HTTP
 *    completamente distinto (el residente/conserje aprobando desde su propia
 *    sesión) y `tool.execute(ctx, input)` necesita un `ctx` con la forma
 *    correcta (tenantId/sessionId/role/scopes del llamador ORIGINAL, no del
 *    aprobador) para que la tool se comporte igual que si hubiera ejecutado
 *    en el momento. No es un campo listado explícitamente en el encargo de
 *    la tarea, pero es indispensable para poder re-invocar `execute()` con
 *    fidelidad — ninguno de sus campos es secreto (son los mismos que ya
 *    viajan en claro por `AuthorizedContext`).
 *  - `result`: `null` hasta `executed`; guarda la salida YA validada por
 *    `tool.outputSchema` — es lo que se devuelve sin re-ejecutar ante una
 *    segunda aprobación o una nueva consulta de estado.
 */
@Entity({ name: 'pending_actions' })
export class PendingAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  sessionId: string | null;

  @Column({ type: 'varchar', length: 128 })
  toolName: string;

  @Column({ type: 'jsonb' })
  input: unknown;

  @Column({ type: 'varchar', length: 64 })
  requestId: string;

  @Index()
  @Column({
    type: 'enum',
    enum: PendingActionStatus,
    default: PendingActionStatus.PENDING,
  })
  status: PendingActionStatus;

  // `unknown` a secas (no `Record<string, unknown>`): TypeORM's
  // `QueryDeepPartialEntity`/`DeepPartial` para columnas jsonb exige el tipo
  // exacto `unknown` en `create()`/`update()` — `Record<string, unknown>`
  // rompe la asignación de `ctx: AuthorizedContext` (una interfaz, sin index
  // signature) sin un cast extra. `unknown` ya admite `null`
  // estructuralmente, así que `| null` es redundante para TypeScript (lint
  // `no-redundant-type-constituents`) — se documenta acá en vez de en el
  // tipo, ya que la columna SÍ es `nullable: true` en Postgres.
  @Column({ type: 'jsonb', nullable: true })
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  contextSnapshot: unknown | null;

  @Column({ type: 'jsonb', nullable: true })
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  result: unknown | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /**
   * Motivo del último fallo/expiración (FIX 2/FIX 3, revisión pre-F2.2) —
   * `null` mientras la acción no haya pasado por `failed`/`expired`. Guarda
   * el mensaje de error de `tool.execute()` (estado `failed`) o la razón de
   * invalidez de contexto (estado `expired`, ver
   * `PendingActionsService.validateExecutionContext`). Solo texto de
   * diagnóstico — nunca un campo que la tool o el modelo puedan escribir.
   */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;
}
