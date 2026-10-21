import { ConflictException } from '@nestjs/common';

/**
 * 409 de `VisitsService.checkIn` cuando la entrada YA quedó registrada: la
 * visita está `ACTIVE` porque otra request (otra detección del LPR, el
 * check-in de la aprobación o un guardia) ganó la carrera.
 *
 * Es un `ConflictException`, así que por HTTP sigue siendo un 409. Los flujos
 * automáticos lo distinguen de los demás conflictos para tratarlo como
 * idempotente: la lectura repetida no vuelve a abrir el portón ni alerta al
 * anfitrión (ver `DetectionsService.applyVisitPassage` y
 * `DigitalConciergeService.respondToVisitor`).
 */
export class VisitEntryAlreadyRegisteredException extends ConflictException {
  constructor() {
    super(
      'La entrada de la visita ya está registrada: la visita está en curso',
    );
  }
}
