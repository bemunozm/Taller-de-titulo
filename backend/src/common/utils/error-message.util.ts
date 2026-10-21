/**
 * Mensaje legible de un error capturado (`catch (error: unknown)`), sin
 * asumir que es una instancia de `Error`.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
