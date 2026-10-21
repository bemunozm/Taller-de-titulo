import type { Family } from './entities/family.entity';
import type { Unit } from '../units/entities/unit.entity';

/**
 * Resolución de la casa que marca o dice el visitante (Fase 4 · P6.R).
 *
 * Reglas, en orden (nunca búsqueda difusa: "10" jamás encuentra la "101"):
 *  a) calce EXACTO de `Unit.identifier` (trim, sin distinguir mayúsculas):
 *     "a-303" encuentra la "A-303";
 *  b) si no hay, calce EXACTO del `Unit.number` de las unidades activas: el
 *     kiosko solo marca dígitos y el teclado del hub `[0-9A-D]`, así que
 *     "303" llega a la "A-303" si es la ÚNICA unidad 303 del condominio;
 *  c) si hay varias (A-303 y B-303), es AMBIGUO: se devuelven solo los
 *     identificadores candidatos (sin nombres ni datos de familias) para que
 *     el agente pregunte a cuál va.
 */

/** Tope de opciones de un resultado ambiguo. */
export const MAX_HOUSE_OPTIONS = 10;

export type HouseResolution =
  | { status: 'found'; family: Family }
  | { status: 'ambiguous'; options: string[] }
  | { status: 'not-found' };

export type UnitMatch =
  | { kind: 'unit'; unit: Unit }
  | { kind: 'ambiguous'; options: string[] }
  | { kind: 'none' };

/** Término normalizado (trim + mayúsculas), o `null` si queda vacío. */
export function normalizeHouseTerm(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

/**
 * (a) Calce exacto de identificador. Entre unidades que solo difieren en
 * mayúsculas gana la de las mismas mayúsculas que el término; si no hay, es
 * ambiguo. Defensa en profundidad: descarta lo que no calce exacto aunque la
 * consulta lo haya devuelto.
 */
export function matchUnitByIdentifier(
  units: readonly Unit[],
  searchTerm: string,
): UnitMatch {
  const normalized = normalizeHouseTerm(searchTerm);
  if (!normalized) {
    return { kind: 'none' };
  }
  const exact = uniqueUnits(
    units.filter(
      (unit) => normalizeHouseTerm(unit.identifier ?? '') === normalized,
    ),
  );
  const trimmed = searchTerm.trim();
  const sameCase = exact.filter((unit) => unit.identifier.trim() === trimmed);
  return matchFrom(sameCase.length > 0 ? sameCase : exact);
}

/**
 * (b)/(c) Calce exacto del número de la unidad, solo entre unidades activas.
 * Una sola unidad: esa; varias: ambiguo con sus identificadores.
 */
export function matchUnitByNumber(
  units: readonly Unit[],
  searchTerm: string,
): UnitMatch {
  const normalized = normalizeHouseTerm(searchTerm);
  if (!normalized) {
    return { kind: 'none' };
  }
  return matchFrom(
    uniqueUnits(
      units.filter(
        (unit) =>
          unit.active && normalizeHouseTerm(unit.number ?? '') === normalized,
      ),
    ),
  );
}

/** Familia activa más antigua de la unidad (la que se notifica), o `null`. */
export function activeFamilyOf(unit: Unit): Family | null {
  const active = (unit.families ?? []).filter((family) => family.active);
  active.sort(
    (a, b) =>
      timeOf(a.createdAt) - timeOf(b.createdAt) || a.id.localeCompare(b.id),
  );
  return active[0] ?? null;
}

function matchFrom(units: readonly Unit[]): UnitMatch {
  if (units.length === 0) {
    return { kind: 'none' };
  }
  if (units.length === 1) {
    return { kind: 'unit', unit: units[0] };
  }
  const options = [...new Set(units.map((unit) => unit.identifier.trim()))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_HOUSE_OPTIONS);
  // Mismo código en varias unidades (p. ej. dos condominios para el
  // super-admin): preguntar no desambigua nada.
  return options.length > 1 ? { kind: 'ambiguous', options } : { kind: 'none' };
}

function uniqueUnits(units: readonly Unit[]): Unit[] {
  const byId = new Map<string, Unit>();
  for (const unit of units) {
    if (!byId.has(unit.id)) {
      byId.set(unit.id, unit);
    }
  }
  return [...byId.values()];
}

function timeOf(value: Date | string | null | undefined): number {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}
