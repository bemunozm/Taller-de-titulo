import type { GuardianZonePoint } from './entities/camera.entity';

/**
 * Tipos de zona del Guardián Visual:
 *  - `intrusion`: alerta cuando una persona entra a la zona.
 *  - `loitering`: alerta cuando permanece `loiterSeconds` dentro de la zona.
 */
export const GUARDIAN_ZONE_TYPES = ['intrusion', 'loitering'] as const;
export type GuardianZoneType = (typeof GUARDIAN_ZONE_TYPES)[number];

export const MIN_LOITER_SECONDS = 5;
export const MAX_LOITER_SECONDS = 600;

/**
 * Zona del Guardián en formato NUEVO (lo que se guarda y devuelve la API).
 * El formato LEGACY era solo el arreglo de puntos (`GuardianZone`, que además
 * reutiliza la zona de detección del LPR y NO cambia).
 */
export interface GuardianZoneConfig {
  points: GuardianZonePoint[];
  type: GuardianZoneType;
  /** Segundos de permanencia para `loitering` (el worker usa 20 si falta). */
  loiterSeconds?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normaliza una lista de zonas (legacy `[[{x,y}]]`, nuevo o mezcla) al formato
 * nuevo. Los elementos legacy pasan a `type: 'intrusion'`. Es tolerante: lo
 * que no es una zona reconocible se descarta (filas jsonb corruptas) en vez
 * de romper la lectura. NO valida rangos; eso lo hace el DTO.
 */
export function normalizeGuardianZones(raw: unknown): GuardianZoneConfig[] {
  if (!Array.isArray(raw)) return [];
  const zones: GuardianZoneConfig[] = [];
  for (const item of raw as unknown[]) {
    if (Array.isArray(item)) {
      zones.push({ points: toPoints(item), type: 'intrusion' });
      continue;
    }
    if (isRecord(item) && Array.isArray(item.points)) {
      const zone: GuardianZoneConfig = {
        points: toPoints(item.points as unknown[]),
        type: item.type === 'loitering' ? 'loitering' : 'intrusion',
      };
      if (typeof item.loiterSeconds === 'number') {
        zone.loiterSeconds = item.loiterSeconds;
      }
      zones.push(zone);
    }
  }
  return zones;
}

function toPoints(raw: unknown[]): GuardianZonePoint[] {
  const points: GuardianZonePoint[] = [];
  for (const p of raw) {
    if (isRecord(p) && typeof p.x === 'number' && typeof p.y === 'number') {
      points.push({ x: p.x, y: p.y });
    }
  }
  return points;
}

/**
 * Transformer de columna jsonb: toda lectura de `Camera.guardianZones`
 * (listados, detalle, relaciones) devuelve el formato nuevo aunque la fila
 * sea legacy. La escritura no transforma (el servicio ya normaliza).
 */
export const guardianZonesTransformer = {
  to: (value: GuardianZoneConfig[] | null | undefined) => value,
  from: (value: unknown): GuardianZoneConfig[] | null =>
    value === null || value === undefined
      ? null
      : normalizeGuardianZones(value),
};
