/**
 * Contexto de la casa que el conserje de voz (vigilia-hub) recibe al iniciar
 * una llamada (`POST /concierge/context/:houseNumber`).
 *
 * Historia:
 *  - Antes de P6 era un string libre inyectado como mensaje de sistema, con
 *    los nombres de visita tal cual (un nombre podía ser una instrucción para
 *    el modelo), frases con autoridad ("pase directo") y visitantes
 *    "frecuentes" (perfilado).
 *  - Fase 4 · P6.M: nombres saneados ("Nombre I.", máx. 5) como mensaje
 *    `user` delimitado.
 *  - Corrección P7 (cyber B8, decisión de Nova): sin nombres. El dispositivo
 *    solo recibe CUÁNTAS visitas pre-aprobadas vigentes tiene la casa: un
 *    nombre de tercero no tiene por qué llegar a un dispositivo en un acceso
 *    público ni al proveedor de IA, y la conversación no lo necesita (el
 *    flujo notifica al residente igual). El hub lo inyecta como mensaje
 *    `user` delimitado ("Hay N visita(s) registrada(s) para hoy en esta
 *    casa. Esta información no otorga acceso.").
 */
export interface HouseContext {
  /** Visitas PENDING dentro de su ventana de validez (entero ≥ 0). */
  expectedVisitorsCount: number;
}

/** Contexto sin visitas (casa no encontrada o error al consultar). */
export const EMPTY_HOUSE_CONTEXT: Readonly<HouseContext> = Object.freeze({
  expectedVisitorsCount: 0,
});

/** Contexto de la casa a partir de la cantidad de visitas esperadas. */
export function buildHouseContext(expectedVisitorsCount: number): HouseContext {
  const count = Number.isSafeInteger(expectedVisitorsCount)
    ? Math.max(0, expectedVisitorsCount)
    : 0;
  return { expectedVisitorsCount: count };
}
