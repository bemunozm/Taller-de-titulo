import { VisitStatus } from './entities/visit.entity';

/**
 * Limpieza post-auditoría (dedup DUP2): mismo `Set<VisitStatus>` que estaba
 * duplicado en `agent/tools/abrir-acceso.tool.ts` (ahí como criterio de
 * "visita pre-aprobada vigente" para la política de autonomía condicional) y
 * en `agent/tools/consultar-visitas.tool.ts` (ahí como criterio de "visita
 * activa" para el filtro por default) — ambos usan exactamente el mismo
 * criterio subyacente: la visita NO llegó a un estado terminal (completed/
 * cancelled/expired/denied).
 */
export const NON_TERMINAL_VISIT_STATUSES = new Set<VisitStatus>([
  VisitStatus.PENDING,
  VisitStatus.ACTIVE,
  VisitStatus.READY_FOR_REENTRY,
]);
