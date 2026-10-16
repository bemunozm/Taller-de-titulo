import { ConflictException } from '@nestjs/common';
import { VisitStatus } from './entities/visit.entity';

/**
 * Máquina de estados de `Visit` (Fase 4 · P3, decisiones D2/D3 de
 * docs/modulos/hardening-pre-piloto.md §3).
 *
 * ```
 *  notifyResident ─► AWAITING_APPROVAL ─approve + checkIn─► PENDING ─► ACTIVE
 *                          ├─ deny ─────────────────────────► DENIED  (terminal)
 *                          └─ TTL vencido / fin de sesión ──► EXPIRED (terminal)
 *  create ─► PENDING ─checkIn─► ACTIVE ─checkOut─► READY_FOR_REENTRY | COMPLETED
 *            PENDING ─cancel─► CANCELLED ; fin de la ventana de validez ─► EXPIRED
 * ```
 *
 * Al aprobar una solicitud del conserje digital (peatonal o vehicular), el
 * check-in va en el mismo evento que abre la puerta o el portón. El LPR no
 * registra la salida de una visita `ACTIVE` durante la espera posterior al
 * ingreso (`VISIT_EXIT_COOLDOWN_MINUTES`), ni el reingreso de una
 * `READY_FOR_REENTRY` durante la misma espera posterior a la salida.
 *
 * Es la ÚNICA fuente de verdad de qué cambios de estado son legales. Todo
 * servicio que escriba `Visit.status` consulta esta tabla antes de escribir,
 * y la escritura en BD se condiciona al estado de origen (`WHERE status = …`)
 * para no pisar una transición concurrente.
 *
 * Notas sobre la tabla:
 * - `AWAITING_APPROVAL` es una SOLICITUD, no una visita autorizada: solo sale
 *   por aprobación, rechazo o TTL. No admite check-in, QR ni LPR.
 * - `ACTIVE`/`READY_FOR_REENTRY` → `EXPIRED` preserva lo que ya hacía
 *   `VisitsService.validateAccess` al detectar una visita fuera de su ventana.
 * - `COMPLETED`, `CANCELLED`, `EXPIRED` y `DENIED` son terminales.
 */
export const VISIT_TRANSITIONS: Readonly<
  Record<VisitStatus, readonly VisitStatus[]>
> = Object.freeze({
  [VisitStatus.AWAITING_APPROVAL]: Object.freeze([
    VisitStatus.PENDING,
    VisitStatus.DENIED,
    VisitStatus.EXPIRED,
  ]),
  [VisitStatus.PENDING]: Object.freeze([
    VisitStatus.ACTIVE,
    VisitStatus.CANCELLED,
    VisitStatus.EXPIRED,
  ]),
  [VisitStatus.ACTIVE]: Object.freeze([
    VisitStatus.READY_FOR_REENTRY,
    VisitStatus.COMPLETED,
    VisitStatus.EXPIRED,
  ]),
  [VisitStatus.READY_FOR_REENTRY]: Object.freeze([
    VisitStatus.ACTIVE,
    VisitStatus.COMPLETED,
    VisitStatus.EXPIRED,
  ]),
  [VisitStatus.COMPLETED]: Object.freeze([]),
  [VisitStatus.CANCELLED]: Object.freeze([]),
  [VisitStatus.EXPIRED]: Object.freeze([]),
  [VisitStatus.DENIED]: Object.freeze([]),
});

/** Estados en los que una patente detectada por el LPR puede calzar con la visita. */
export const LPR_MATCHABLE: readonly VisitStatus[] = Object.freeze([
  VisitStatus.PENDING,
  VisitStatus.ACTIVE,
  VisitStatus.READY_FOR_REENTRY,
]);

/** Estados en los que el QR de la visita es válido (además de la ventana de validez). */
export const QR_VALID: readonly VisitStatus[] = Object.freeze([
  VisitStatus.PENDING,
  VisitStatus.ACTIVE,
  VisitStatus.READY_FOR_REENTRY,
]);

/** Estados desde los que se puede registrar una entrada (`checkIn`). */
export const CHECKIN_FROM: readonly VisitStatus[] = Object.freeze([
  VisitStatus.PENDING,
  VisitStatus.READY_FOR_REENTRY,
]);

/**
 * Estados en los que `PATCH /visits/:id` puede editar la visita. Una solicitud
 * sin aprobar no se edita (el residente aprueba lo que vio), y una visita en
 * curso o terminal tampoco.
 */
export const EDITABLE_FROM: readonly VisitStatus[] = Object.freeze([
  VisitStatus.PENDING,
  VisitStatus.READY_FOR_REENTRY,
]);

/** Etiquetas legibles para los mensajes de error (sin datos de la visita). */
const STATUS_LABELS: Readonly<Record<VisitStatus, string>> = Object.freeze({
  [VisitStatus.AWAITING_APPROVAL]: 'pendiente de aprobación del residente',
  [VisitStatus.PENDING]: 'programada',
  [VisitStatus.ACTIVE]: 'en curso',
  [VisitStatus.READY_FOR_REENTRY]: 'lista para reingresar',
  [VisitStatus.COMPLETED]: 'completada',
  [VisitStatus.CANCELLED]: 'cancelada',
  [VisitStatus.EXPIRED]: 'expirada',
  [VisitStatus.DENIED]: 'rechazada',
});

export function describeVisitStatus(status: VisitStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function isTerminalVisitStatus(status: VisitStatus): boolean {
  return VISIT_TRANSITIONS[status]?.length === 0;
}

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Lanza `ConflictException` (409) si `from → to` no es una transición
 * permitida: el pedido es válido, pero choca con el estado actual de la
 * visita.
 */
export function assertTransition(from: VisitStatus, to: VisitStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(
      `La visita está ${describeVisitStatus(from)}: no se puede pasar a ${describeVisitStatus(to)}`,
    );
  }
}
