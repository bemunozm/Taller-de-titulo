import { ConflictException } from '@nestjs/common';
import { VisitStatus } from './entities/visit.entity';
import {
  CHECKIN_FROM,
  EDITABLE_FROM,
  LPR_MATCHABLE,
  QR_VALID,
  VISIT_TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminalVisitStatus,
} from './visit-state-machine';
import { NON_TERMINAL_VISIT_STATUSES } from './visits.constants';

const {
  AWAITING_APPROVAL,
  PENDING,
  ACTIVE,
  READY_FOR_REENTRY,
  COMPLETED,
  CANCELLED,
  EXPIRED,
  DENIED,
} = VisitStatus;

const ALL_STATUSES = Object.values(VisitStatus);

/**
 * Tabla esperada (docs/modulos/hardening-pre-piloto.md §3). Se escribe a mano
 * a propósito: el test compara la tabla del código contra esta, celda por
 * celda (8 × 8), así cualquier transición nueva tiene que declararse en los
 * dos lados.
 */
const EXPECTED_ALLOWED: Record<VisitStatus, VisitStatus[]> = {
  [AWAITING_APPROVAL]: [PENDING, DENIED, EXPIRED],
  [PENDING]: [ACTIVE, CANCELLED, EXPIRED],
  [ACTIVE]: [READY_FOR_REENTRY, COMPLETED, EXPIRED],
  [READY_FOR_REENTRY]: [ACTIVE, COMPLETED, EXPIRED],
  [COMPLETED]: [],
  [CANCELLED]: [],
  [EXPIRED]: [],
  [DENIED]: [],
};

const ALL_PAIRS: Array<[VisitStatus, VisitStatus, boolean]> =
  ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.map((to): [VisitStatus, VisitStatus, boolean] => [
      from,
      to,
      EXPECTED_ALLOWED[from].includes(to),
    ]),
  );

describe('visit-state-machine', () => {
  it('declara transiciones para TODOS los estados del enum', () => {
    expect(Object.keys(VISIT_TRANSITIONS).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });

  it('la tabla del código coincide exactamente con la tabla esperada', () => {
    for (const status of ALL_STATUSES) {
      expect([...VISIT_TRANSITIONS[status]].sort()).toEqual(
        [...EXPECTED_ALLOWED[status]].sort(),
      );
    }
  });

  it.each(ALL_PAIRS)('%s -> %s permitido: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);

    if (allowed) {
      expect(() => assertTransition(from, to)).not.toThrow();
    } else {
      expect(() => assertTransition(from, to)).toThrow(ConflictException);
    }
  });

  it('AWAITING_APPROVAL solo sale por aprobar, denegar o TTL', () => {
    expect(VISIT_TRANSITIONS[AWAITING_APPROVAL]).toEqual([
      PENDING,
      DENIED,
      EXPIRED,
    ]);
    expect(canTransition(AWAITING_APPROVAL, ACTIVE)).toBe(false);
    expect(canTransition(AWAITING_APPROVAL, CANCELLED)).toBe(false);
  });

  it('COMPLETED, CANCELLED, EXPIRED y DENIED son terminales; el resto no', () => {
    const terminal = ALL_STATUSES.filter(isTerminalVisitStatus);
    expect(terminal.sort()).toEqual([CANCELLED, COMPLETED, DENIED, EXPIRED]);
  });

  it('el mensaje de una transición inválida describe el estado, sin datos de la visita', () => {
    expect(() => assertTransition(DENIED, ACTIVE)).toThrow(
      'La visita está rechazada: no se puede pasar a en curso',
    );
  });

  describe('conjuntos derivados', () => {
    it('LPR_MATCHABLE = PENDING, ACTIVE, READY_FOR_REENTRY (sin AWAITING_APPROVAL)', () => {
      expect([...LPR_MATCHABLE].sort()).toEqual(
        [PENDING, ACTIVE, READY_FOR_REENTRY].sort(),
      );
    });

    it('QR_VALID = los mismos estados que el LPR', () => {
      expect([...QR_VALID].sort()).toEqual([...LPR_MATCHABLE].sort());
    });

    it('CHECKIN_FROM = PENDING y READY_FOR_REENTRY, coherente con la tabla (-> ACTIVE)', () => {
      expect([...CHECKIN_FROM].sort()).toEqual(
        [PENDING, READY_FOR_REENTRY].sort(),
      );
      const reachActive = ALL_STATUSES.filter((s) => canTransition(s, ACTIVE));
      expect(reachActive.sort()).toEqual([...CHECKIN_FROM].sort());
    });

    it('NON_TERMINAL_VISIT_STATUSES (tools del agente) no incluye AWAITING_APPROVAL', () => {
      expect(NON_TERMINAL_VISIT_STATUSES.has(AWAITING_APPROVAL)).toBe(false);
      expect([...NON_TERMINAL_VISIT_STATUSES].sort()).toEqual(
        [PENDING, ACTIVE, READY_FOR_REENTRY].sort(),
      );
    });

    it('EDITABLE_FROM (PATCH) = PENDING y READY_FOR_REENTRY: ni solicitudes, ni en curso, ni terminales', () => {
      expect([...EDITABLE_FROM].sort()).toEqual(
        [PENDING, READY_FOR_REENTRY].sort(),
      );
      expect(EDITABLE_FROM).not.toContain(AWAITING_APPROVAL);
      expect(EDITABLE_FROM).not.toContain(ACTIVE);
      expect(EDITABLE_FROM.some(isTerminalVisitStatus)).toBe(false);
    });

    it('los conjuntos son inmutables', () => {
      expect(Object.isFrozen(LPR_MATCHABLE)).toBe(true);
      expect(Object.isFrozen(QR_VALID)).toBe(true);
      expect(Object.isFrozen(CHECKIN_FROM)).toBe(true);
      expect(Object.isFrozen(EDITABLE_FROM)).toBe(true);
      expect(Object.isFrozen(VISIT_TRANSITIONS)).toBe(true);
    });
  });
});
