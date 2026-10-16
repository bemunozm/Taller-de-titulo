import { ConflictException } from '@nestjs/common';

/**
 * 409 de `VisitsService.checkOut` cuando la salida YA quedó registrada: la
 * visita dejó de estar `ACTIVE` (quedó lista para reingresar o completada)
 * porque otra request (otra detección del LPR o un guardia) ganó la carrera.
 *
 * Es un `ConflictException`, así que por HTTP sigue siendo un 409. El LPR lo
 * distingue de los demás conflictos para tratarlo como lectura duplicada
 * (QA N5): no vuelve a abrir el portón ni dispara una alerta HIGH (ver
 * `DetectionsService.applyVisitPassage`). Mismo criterio que
 * `VisitEntryAlreadyRegisteredException` para la entrada.
 */
export class VisitExitAlreadyRegisteredException extends ConflictException {
  constructor() {
    super('La salida de la visita ya está registrada');
  }
}
