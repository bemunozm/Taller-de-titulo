import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { FamiliesService } from '../../families/families.service';
import { DigitalConciergeService } from '../../digital-concierge/services/digital-concierge.service';
import type { ConciergeSession } from '../../digital-concierge/entities/concierge-session.entity';
import { HubGateway } from '../../hub/hub.gateway';
import { VisitStatus } from '../../visits/entities/visit.entity';
import { VisitsService } from '../../visits/visits.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';

const inputSchema = z.object({
  tipo: z
    .enum(['porton', 'puerta'])
    .describe(
      'Qué acceso físico abrir: "porton" para el acceso vehicular, "puerta" para el acceso peatonal.',
    ),
});
type AbrirAccesoInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  abierto: z.boolean(),
  mensaje: z.string(),
});
type AbrirAccesoOutput = z.infer<typeof outputSchema>;

/**
 * Estados de `Visit` que cuentan como "acceso autorizado" para la política de
 * autonomía de abajo — MISMO set que `ACTIVE_STATUSES` de
 * `ConsultarVisitasTool` (docs/modulos/agente-cerebro.md §12): una visita
 * `PENDING` (el residente ya la pre-registró, el visitante aún no marca
 * entrada), `ACTIVE` (ya en curso) o `READY_FOR_REENTRY` (puede reingresar) es
 * "visita pre-aprobada" a efectos de abrir el acceso sin escalar. No se
 * extrae a un util compartido para no acoplar dos tools que hoy evolucionan
 * independiente — si un tercer consumidor necesita el mismo criterio, vale la
 * pena centralizarlo entonces (ver "deuda" en el reporte de la tarea).
 */
const PRE_APPROVED_VISIT_STATUSES = new Set<VisitStatus>([
  VisitStatus.PENDING,
  VisitStatus.ACTIVE,
  VisitStatus.READY_FOR_REENTRY,
]);

/**
 * CORRECCIÓN CRÍTICA (auditoría de seguridad, hallazgo F2.2 — "autoriza por
 * casa, no por persona"): identidad del visitante VERIFICADA por un canal que
 * un atacante no controla — la única evidencia que habilita la apertura
 * autónoma (ver `requiresApproval` y `hasVerifiedPreApprovedVisit` abajo).
 *
 * NUNCA se construye a partir de lo que el visitante DECLARA por voz
 * (`ConciergeSession.vehiclePlate`/`visitorName`/`visitorRut`, capturados por
 * `guardar_datos_visitante.tool.ts`) — esos campos son atacante-controlados
 * (el visitante los dicta, y puede reescribirlos vía esa misma tool), que es
 * exactamente el vector que explotó el auditor: marcar una casa con una
 * visita ajena y pedir la apertura. Solo cuentan:
 *  - `plate`: patente LEÍDA por la cámara del portón (LPR/`PlateDetection`),
 *    nunca tecleada o dicha por el visitante.
 *  - `qr`: código de un QR ESCANEADO por un lector físico (`Visit.qrCode`).
 */
type VerifiedVisitorIdentity =
  | { readonly kind: 'plate'; readonly plate: string }
  | { readonly kind: 'qr'; readonly qrCode: string };

/**
 * Bloque F2.2 (docs/modulos/agente-cerebro.md §12) — política de autonomía
 * condicional para la apertura física de accesos. `access: 'write'`: es la
 * tool más sensible del catálogo (efecto físico real, no reversible una vez
 * emitido el pulso del relé).
 *
 * DECISIÓN DE DISEÑO — una sola tool con `tipo`, no dos (`abrir_porton` /
 * `abrir_puerta`): el hardware YA distingue el acceso por un campo
 * (`hub:door_open` → `{ type: 'vehicular' | 'pedestrian' }`, ver
 * `DigitalConciergeService.respondToVisitor` y
 * `vigilia-hub/src/services/websocket-client.service.ts::onDoorOpenCommand`),
 * y la política de autonomía (¿hay visita pre-aprobada?) es IDÉNTICA para
 * ambos casos — depende de la casa/visita, no del tipo de acceso. Dos tools
 * duplicarían textualmente `requiresApproval`/`execute` sin ganar nada; un
 * parámetro sigue el mismo patrón que `ConsultarVisitasTool.soloActivas` o
 * `ConsultarVehiculoTool.patente` (un solo concepto, una tool).
 *
 * POLÍTICA DE AUTONOMÍA (corregida tras hallazgo CRÍTICO de auditoría —
 * F2.2 original autorizaba por CASA, sin comparar identidad: cualquier
 * visitante que marcara una casa con una visita ajena vigente abría el
 * acceso. Decisión de producto de Benjamin: la apertura autónoma exige
 * identidad VERIFICADA, nunca declarada): el agente abre SOLO
 * (`requiresApproval` resuelve `false`) si, y solo si, existe una
 * `VerifiedVisitorIdentity` (patente LEÍDA por LPR o QR ESCANEADO — ver tipo
 * arriba) asociada a ESTA sesión que matchea una visita pre-aprobada vigente
 * (mismo set de estados que `ConsultarVisitasTool`/el flujo determinista de
 * LPR — ver `PRE_APPROVED_VISIT_STATUSES` arriba y
 * `VisitsService.validateAccess`, que también exige la ventana
 * `validFrom`/`validUntil`) para la casa de destino.
 *
 * En CUALQUIER otro caso — sin casa resuelta, sin sesión de conserjería, sin
 * identidad verificada, o identidad verificada que NO matchea ninguna visita
 * vigente de esa casa — escala al residente/conserje (F2.1). Fail-closed por
 * diseño: toda rama ambigua o no cubierta explícitamente escala, nunca abre.
 * Ver `resolveVerifiedIdentity` para el estado actual (y la deuda) de cómo se
 * obtiene la identidad verificada de una sesión de citófono.
 *
 * `casa` de destino: se deriva de `ConciergeSession.destinationHouse` (NUNCA
 * de un input del modelo) — misma razón que `tenantId`/`sessionId` en
 * `AuthorizedContext` (regla dura #1 del §5): un modelo comprometido no debe
 * poder decidir SOBRE QUÉ CASA se evalúa la autonomía pasándola como
 * parámetro. Por eso esta tool, a diferencia de `buscar_residente`/
 * `consultar_visitas`, exige `ctx.sessionId` (igual que `finalizar_llamada`/
 * `notificar_residente`) — no tiene sentido fuera de una sesión física real.
 *
 * EMISIÓN AL HUB: reusa `HubGateway.sendToHub`/`sendToOrganization` +
 * `DigitalConciergeService.findSessionForTenant` (misma dupla que ya usan
 * `finalizar_llamada`/`notificar_residente` para resolver+validar tenant de
 * la sesión) — dirigido por `session.hubId` (o, si no está conectado, por
 * `session.organizationId`), NUNCA un broadcast global (hallazgo H2, ya
 * corregido en A1.1). La lógica de "hub propio vs. broadcast al condominio"
 * duplica ~4 líneas de `DigitalConciergeService.notifyHub` (privado, no
 * exportado) en vez de tocar ese archivo — fuera del alcance de coordinación
 * de esta tarea (solo módulo `agent` + `hub.gateway`); ver "deuda" en el
 * reporte.
 *
 * IDEMPOTENCIA: reabrir por un retry (o por `PendingActionsService.approve`
 * reintentando tras un `failed`, ver su FIX 2) solo reactiva el relé del hub
 * — sin efecto acumulativo dañino (mismo pulso, mismo resultado).
 *
 * `requiredScopes`: se mantiene `digital-concierge.access` (el baseline fijo
 * que trae toda sesión de hub físico, ver `authorized-context.factory.ts`) en
 * vez de exigir un scope más fuerte — un hub NO tiene RBAC granular (es una
 * credencial de máquina, no un `User` con roles), así que cualquier scope
 * adicional dejaría a la tool inalcanzable desde el citófono, que es
 * justamente donde se necesita. Si en el futuro un canal humano (conserje
 * operando el agente por texto) debiera requerir un permiso más fuerte para
 * esta tool específica, hace falta agregar ese scope al baseline/RBAC
 * primero — fuera de alcance acá (ver "deuda").
 */
@Injectable()
export class AbrirAccesoTool
  implements VigiliaTool<AbrirAccesoInput, AbrirAccesoOutput>
{
  readonly name = 'abrir_acceso';
  readonly description =
    'Abre el portón vehicular o la puerta peatonal del condominio para el visitante de esta llamada. Si el visitante no tiene una visita pre-aprobada vigente, la solicitud queda pendiente de aprobación de un residente o conserje — nunca prometas la apertura antes de que la herramienta confirme que se abrió.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'write' as const;
  readonly requiredScopes = ['digital-concierge.access'];

  constructor(
    private readonly conciergeService: DigitalConciergeService,
    private readonly familiesService: FamiliesService,
    private readonly visitsService: VisitsService,
    private readonly hubGateway: HubGateway,
  ) {}

  /**
   * Política de autonomía condicional (ver docstring de la clase). Fail-safe
   * por diseño: cualquier rama sin evidencia explícita de "visita
   * pre-aprobada vigente" devuelve `true` (escala) — nunca `false` por
   * default.
   */
  readonly requiresApproval = async (
    ctx: AuthorizedContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma exigida por VigiliaTool.requiresApproval (mismo patrón que `_input` en finalizar-llamada.tool.ts): el criterio de autonomía no depende de `tipo`, solo de la casa/visita.
    _input: AbrirAccesoInput,
  ): Promise<boolean> => {
    if (!ctx.sessionId) {
      return true;
    }

    const session = await this.conciergeService.findSessionForTenant(
      ctx.sessionId,
      ctx,
    );

    if (!session.destinationHouse) {
      return true;
    }

    const verifiedIdentity = await this.resolveVerifiedIdentity(session);

    const hasVerifiedPreApprovedVisit =
      await this.hasVerifiedPreApprovedVisit(
        ctx,
        session.destinationHouse,
        verifiedIdentity,
      );

    return !hasVerifiedPreApprovedVisit;
  };

  async execute(
    ctx: AuthorizedContext,
    input: AbrirAccesoInput,
  ): Promise<AbrirAccesoOutput> {
    if (!ctx.sessionId) {
      throw new BadRequestException(
        `La tool "${this.name}" requiere una sesión de conserjería activa (ctx.sessionId)`,
      );
    }

    // Re-resuelve la sesión (tenant-scoped) en vez de confiar en lo que haya
    // evaluado `requiresApproval` — mismo criterio defensivo que
    // `finalizar_llamada`/`notificar_residente`: `execute()` nunca asume que
    // ya se validó nada, se valida de nuevo acá.
    const session = await this.conciergeService.findSessionForTenant(
      ctx.sessionId,
      ctx,
    );

    const hubEvent = 'hub:door_open';
    const payload = {
      type: input.tipo === 'porton' ? 'vehicular' : 'pedestrian',
      // `visitId` es informativo para el hub (ver
      // websocket-client.service.ts::onDoorOpenCommand, que solo lee
      // `data.type`) — no siempre hay una `Visit` asociada (p.ej. autonomía
      // por visita pre-aprobada que aún no hizo check-in).
      visitId: session.createdVisit?.id ?? null,
    };

    if (session.hubId && this.hubGateway.isHubConnected(session.hubId)) {
      this.hubGateway.sendToHub(session.hubId, hubEvent, payload);
    } else {
      this.hubGateway.sendToOrganization(
        session.organizationId,
        hubEvent,
        payload,
      );
    }

    return {
      abierto: true,
      mensaje:
        input.tipo === 'porton'
          ? 'Listo, el portón se está abriendo.'
          : 'Listo, la puerta se está abriendo.',
    };
  }

  /**
   * Resuelve la identidad VERIFICADA (si la hay) asociada a esta
   * `ConciergeSession` — patente leída por LPR o QR escaneado (ver
   * `VerifiedVisitorIdentity` arriba). NUNCA construye la identidad a partir
   * de `session.vehiclePlate`/`visitorName`/`visitorRut` (voz, sin verificar).
   *
   * DEUDA (hallazgo de esta corrección — ver reporte de la tarea):
   * `ConciergeSession` (concierge-session.entity.ts) hoy NO tiene ningún
   * campo que la vincule con una `PlateDetection`/`AccessAttempt` (patente
   * leída por la cámara del portón — ver `DetectionsService.createDetection`,
   * un flujo 100% separado que abre el acceso directo sin pasar nunca por una
   * `ConciergeSession`) ni con un `Visit.qrCode` escaneado. No existe hoy
   * ningún punto del sistema que asocie una detección LPR o un escaneo de QR
   * a la sesión de citófono en curso.
   *
   * Mientras ese vínculo no se cablee, esta función devuelve SIEMPRE `null`
   * — fail-closed: TODA apertura solicitada desde el citófono escala al
   * residente/conserje, que es el comportamiento seguro. Cuando se implemente
   * la asociación real (p.ej. agregar `session.verifiedPlateDetectionId` /
   * `session.verifiedQrCode`, poblados por el flujo que hoy conecta LPR/QR
   * con el hub), esta es la ÚNICA función que debe cambiar.
   */
  private async resolveVerifiedIdentity(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- la sesión es el punto de extensión: cuando exista el vínculo real, se lee desde acá (ver DEUDA arriba).
    _session: ConciergeSession,
  ): Promise<VerifiedVisitorIdentity | null> {
    return null;
  }

  /**
   * ¿La identidad VERIFICADA del visitante matchea, para la casa de destino,
   * una `Visit` cuyo estado y ventana de validez la hacen "pre-aprobada"
   * AHORA? Mismo criterio de estados que `ConsultarVisitasTool` +
   * `VisitsService.validateAccess` (ventana `validFrom`/`validUntil`) — no se
   * reusa `validateAccess` directamente porque también acepta un identificador
   * suelto sin exigir que venga de una sesión verificada.
   *
   * Sin identidad verificada (`identity === null`) devuelve `false` de
   * inmediato — NUNCA autoriza por la sola existencia de una visita para la
   * casa (ese era exactamente el bug que reportó el auditor: autorizaba por
   * casa, no por persona).
   *
   * SEGURIDAD: `VisitsService.findAll` NO es tenant-aware (mismo hallazgo que
   * documenta `ConsultarVisitasTool`) — por eso el `familyId` nunca sale del
   * input del modelo, se deriva de `FamiliesService.findByDepartment`
   * (tenant-scoped) y se re-valida `family.organizationId` contra
   * `ctx.tenantId` ANTES de listar sus visitas.
   */
  private async hasVerifiedPreApprovedVisit(
    ctx: AuthorizedContext,
    casa: string,
    identity: VerifiedVisitorIdentity | null,
  ): Promise<boolean> {
    if (!identity) {
      return false;
    }

    const family = await this.familiesService.findByDepartment(casa);

    if (
      !family ||
      (!ctx.isSuperAdmin && family.organizationId !== ctx.tenantId)
    ) {
      return false;
    }

    const visits = await this.visitsService.findAll({ familyId: family.id });
    const now = new Date();

    return visits.some((visit) => {
      if (!PRE_APPROVED_VISIT_STATUSES.has(visit.status)) {
        return false;
      }
      if (!(visit.validFrom <= now && visit.validUntil >= now)) {
        return false;
      }

      if (identity.kind === 'plate') {
        return (
          !!visit.vehicle?.plate &&
          visit.vehicle.plate.toUpperCase() === identity.plate.toUpperCase()
        );
      }

      return !!visit.qrCode && visit.qrCode === identity.qrCode;
    });
  }
}
