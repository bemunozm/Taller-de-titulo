/**
 * Esperas que no mantienen vivo el proceso (Fase 4 · P8, deuda del warning de
 * Jest "A worker process has failed to exit gracefully").
 *
 * Un `setTimeout` normal mantiene vivo el event loop hasta que vence: si una
 * espera de reintento o de sondeo queda pendiente cuando termina un test (o
 * un script que ya cerró la app), el proceso no sale hasta que vence. Con
 * `unref()` la espera sigue funcionando igual mientras el proceso tenga otro
 * trabajo vivo (servidor HTTP, conexiones a la BD, el request en curso), pero
 * ella sola no lo retiene.
 */
export function sleepUnref(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
