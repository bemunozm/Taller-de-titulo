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
export type LprExitSide = 'left' | 'right';
export const LPR_EXIT_SIDES: readonly LprExitSide[] = ['left', 'right'];
/** Longitud mínima (normalizada) de la línea de dirección. */
export const MIN_DIRECTION_LINE_LENGTH = 0.05;
/** Rango del giro del recorte de placa (grados). */
export const MIN_PLATE_ROTATION_DEG = -45;
export const MAX_PLATE_ROTATION_DEG = 45;
export const LPR_DETECTOR_IMGSZ_VALUES = [640, 960, 1280, 1920] as const;

export interface LprCropSettings {
  minWidth?: number;
  /** `null` = sin tope superior. */
  maxWidth?: number | null;
  minRatio?: number;
  maxRatio?: number;
}

/** Punto normalizado (0 a 1) del cuadro. */
export interface LprPoint {
  x: number;
  y: number;
}

/**
 * Línea de cruce que decide la dirección del vehículo (plan G1/G2).
 * `exitSide` = lado hacia el que se mueve el vehículo al SALIR, mirando de
 * `from` a `to`.
 */
export interface LprDirectionLine {
  from: LprPoint;
  to: LprPoint;
  exitSide: LprExitSide;
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
  /** Línea de cruce para medir la dirección (entrada/salida). */
  directionLine?: LprDirectionLine;
  /**
   * Grados (-45..45) que se gira el recorte de la placa en sentido
   * antihorario antes del OCR, para enderezar placas inclinadas. Ausente o 0 =
   * sin giro.
   */
  plateRotationDeg?: number;
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
