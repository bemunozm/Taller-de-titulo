/** Estado de revisión de una anomalía (columna varchar, no ENUM de BD). */
export const ANOMALY_STATUSES = [
  'open',
  'reviewed',
  'dismissed',
  'false_alarm',
] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

/** Estado del análisis de IA (Vision) de una anomalía. */
export const ANOMALY_AI_STATUSES = [
  'pending',
  'done',
  'failed',
  'skipped',
] as const;
export type AnomalyAiStatus = (typeof ANOMALY_AI_STATUSES)[number];

export const MAX_RESOLUTION_NOTE_LENGTH = 500;
