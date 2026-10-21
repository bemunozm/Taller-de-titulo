import type { GuardianZone } from './entities/camera.entity';

/**
 * Configuración de visión LPR por cámara (`Camera.lprSettings`, jsonb).
 * `null` en la columna = defaults globales del worker. Todos los campos son
 * opcionales: el worker mezcla lo presente sobre sus defaults.
 */
export type LprAction = 'register' | 'access';
export type LprDirection = 'entry' | 'exit' | 'both';

export const LPR_ACTIONS: readonly LprAction[] = ['register', 'access'];
export const LPR_DIRECTIONS: readonly LprDirection[] = [
  'entry',
  'exit',
  'both',
];
export const LPR_DETECTOR_IMGSZ_VALUES = [640, 960, 1280, 1920] as const;

export interface LprCropSettings {
  minWidth?: number;
  /** `null` = sin tope superior. */
  maxWidth?: number | null;
  minRatio?: number;
  maxRatio?: number;
}

export interface LprSettings {
  action?: LprAction;
  direction?: LprDirection;
  /** Polígonos de detección en coordenadas normalizadas (0 a 1). */
  zone?: GuardianZone[];
  detectorImgsz?: (typeof LPR_DETECTOR_IMGSZ_VALUES)[number];
  sampleFps?: number;
  crop?: LprCropSettings;
  confirmReads?: number;
}

/** Respuesta de `GET /workers/cameras/:id/lpr-settings` (contrato con el worker). */
export interface WorkerLprSettingsView {
  cameraId: string;
  enableLpr: boolean;
  lprSettings: LprSettings | null;
}

/**
 * ¿La cámara solo REGISTRA (nunca abre el portón ni escala al conserje)?
 * Fail-closed: solo `null`/ausente, o `action` ausente/`'access'`, conservan
 * el comportamiento de control de acceso; cualquier otro valor (incluido uno
 * corrupto en la columna jsonb) se trata como "solo registrar".
 */
export function isRegisterOnly(settings: unknown): boolean {
  if (settings === null || settings === undefined) return false;
  if (typeof settings !== 'object' || Array.isArray(settings)) return true;
  const { action } = settings as { action?: unknown };
  return !(action === undefined || action === null || action === 'access');
}
