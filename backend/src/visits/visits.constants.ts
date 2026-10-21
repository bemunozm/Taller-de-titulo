import { VisitStatus } from './entities/visit.entity';
import { LPR_MATCHABLE } from './visit-state-machine';

/**
 * Visitas AUTORIZADAS que todavía no llegaron a un estado terminal: programada
 * (`PENDING`), en curso (`ACTIVE`) o lista para reingresar
 * (`READY_FOR_REENTRY`).
 *
 * Lo usan `agent/tools/abrir-acceso.tool.ts` (criterio de "visita
 * pre-aprobada vigente" de la política de autonomía) y
 * `agent/tools/consultar-visitas.tool.ts` (filtro por defecto).
 *
 * NO incluye `AWAITING_APPROVAL` (Fase 4 · P3): aunque no es terminal, es una
 * solicitud que el residente todavía no aprueba. Si estuviera acá, una
 * solicitud del conserje digital contaría como pase directo para la apertura
 * autónoma. Mismo conjunto que acepta el LPR (`LPR_MATCHABLE`).
 */
export const NON_TERMINAL_VISIT_STATUSES: ReadonlySet<VisitStatus> = new Set(
  LPR_MATCHABLE,
);
