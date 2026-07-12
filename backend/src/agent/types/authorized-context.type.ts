/**
 * Fase 1, Bloque A2a (docs/modulos/agente-cerebro.md §5) — el contrato de
 * seguridad del catálogo de tools del agente-cerebro.
 *
 * `Permission` no es un enum propio: reusa los nombres `module.action` que ya
 * define `DEFAULT_PERMISSIONS`
 * (backend/src/common/constants/default-permissions.constant.ts) — el mismo
 * vocabulario de permisos que protege el resto de la API vía
 * `@RequirePermissions`/`AuthorizationGuard`. No existe un enum `Permission`
 * separado en el código (los permisos viven en BD, sembrados desde esa
 * constante), así que se modela como alias de `string` a propósito.
 */
export type Permission = string;

/**
 * Contexto de autorización que el backend arma a partir del `request`
 * autenticado (ConciergeAuthGuard + TenantInterceptor/HubAuthGuard) y que se
 * inyecta en cada `execute()` de tool. NUNCA se construye a partir de datos
 * provistos por el modelo o por el input de una tool — ver regla dura #1 del
 * §5 del diseño: "`tenantId` jamás es parámetro de la tool".
 */
export interface AuthorizedContext {
  /**
   * Organización (condominio) de la sesión — SIEMPRE derivado de
   * `request.tenantContext.organizationId` (hub autenticado o sesión humana),
   * nunca del modelo ni del body. `null` es el "cajón sin condominio" ya
   * usado en el resto del sistema (hub aún no asociado, super-admin, etc.) —
   * ver tenant-context.util.ts.
   */
  readonly tenantId: string | null;

  /** `true` si la sesión es de un Super Administrador (bypass de tenant, ver TenantContext). */
  readonly isSuperAdmin: boolean;

  /** Id del usuario humano autenticado, si la sesión vino de `AuthGuard` (no de un hub). */
  readonly userId?: string;

  /**
   * Rol de la sesión, para trazabilidad/auditoría — NO es la fuente de
   * autorización (eso son `scopes`). Para sesiones sin usuario humano (hub
   * físico) toma el valor sentinel `'hub'`.
   */
  readonly role: string;

  /**
   * Permisos efectivos de la sesión, evaluados en NestJS ANTES de ejecutar
   * cualquier tool (regla dura #6 del §5). Para sesión humana: el aplanado de
   * `user.roles[].permissions[].name` (ver auth/utils/permissions.util.ts,
   * MISMA lógica que `AuthorizationGuard`). Para sesión de hub físico (sin
   * usuario): el baseline fijo que el propio guard de transporte
   * (ConciergeAuthGuard/HubAuthGuard) ya certificó — ver
   * `agent/authorized-context.factory.ts` para el detalle de esta decisión.
   */
  readonly scopes: Permission[];

  /** Id de la request/turno — idempotencia + correlación en auditoría (logs.service). */
  readonly requestId: string;

  /**
   * Fase 1, Bloque A2b (docs/modulos/agente-cerebro.md §5/§10.2 paso 4): id de
   * la `ConciergeSession` (citófono) a la que pertenece este turno —
   * SIEMPRE derivado del path param `:sessionId` de
   * `/concierge/session/:sessionId/execute-tool` (o del cuerpo de
   * `startSession`), NUNCA de lo que el modelo decida en el `input` de una
   * tool — misma razón que `tenantId`: un modelo comprometido/alucinando no
   * debe poder redirigir una tool de escritura hacia la sesión de OTRO
   * visitante pasándola como parámetro.
   *
   * `undefined` para consumidores del catálogo que no operan sobre una
   * `ConciergeSession` (p.ej. el canal de texto de `AgentController`, que
   * solo pasa `houseNumber`) — las tools que lo necesitan (`guardar_datos_visitante`,
   * `notificar_residente`, `reenviar_notificacion`, `finalizar_llamada`)
   * validan su presencia en `execute()` y fallan explícitamente si falta.
   */
  readonly sessionId?: string;
}
