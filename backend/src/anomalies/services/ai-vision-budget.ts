/**
 * Presupuesto de análisis de IA (Vision) por condominio, en memoria del
 * proceso. Dos límites independientes, ambos por organización:
 *  - token bucket: capacidad = `ratePerMinute`, se rellena de forma continua a
 *    `ratePerMinute` fichas por minuto (absorbe ráfagas cortas y limita el
 *    ritmo sostenido);
 *  - tope diario: `dailyCap` análisis por día calendario UTC.
 * Protege el costo de OpenAI frente a un worker que re-dispare (o a un
 * condominio ruidoso) sin afectar a los demás. Al reiniciar el proceso el
 * presupuesto vuelve a cero: es una red de contención, no una cuota
 * contable.
 */
export class AiVisionBudget {
  private readonly buckets = new Map<
    string,
    { tokens: number; updatedAt: number }
  >();
  private readonly daily = new Map<string, { day: string; count: number }>();

  constructor(
    private readonly ratePerMinute: number,
    private readonly dailyCap: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Intenta gastar un análisis de `organizationId`. Revisa ambos límites ANTES
   * de consumir cualquiera, para que un rechazo no gaste el otro presupuesto.
   */
  tryConsume(organizationId: string): boolean {
    const nowMs = this.now();
    const day = new Date(nowMs).toISOString().slice(0, 10);

    const used = this.daily.get(organizationId);
    const count = used && used.day === day ? used.count : 0;
    if (count >= this.dailyCap) return false;

    const bucket = this.buckets.get(organizationId) ?? {
      tokens: this.ratePerMinute,
      updatedAt: nowMs,
    };
    const elapsedMs = Math.max(0, nowMs - bucket.updatedAt);
    const tokens = Math.min(
      this.ratePerMinute,
      bucket.tokens + (elapsedMs * this.ratePerMinute) / 60_000,
    );
    if (tokens < 1) {
      this.buckets.set(organizationId, { tokens, updatedAt: nowMs });
      return false;
    }

    this.buckets.set(organizationId, { tokens: tokens - 1, updatedAt: nowMs });
    this.daily.set(organizationId, { day, count: count + 1 });
    return true;
  }
}
