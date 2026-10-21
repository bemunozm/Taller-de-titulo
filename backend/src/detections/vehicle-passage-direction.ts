/**
 * Dirección de una pasada y prioridad de la fuente que la midió (plan E5).
 * Lógica pura: sin Nest ni TypeORM.
 */

export const PASSAGE_DIRECTIONS = ['entry', 'exit', 'unknown'] as const;
export type PassageDirection = (typeof PASSAGE_DIRECTIONS)[number];

/** `camera` = dirección fija de la cámara; luego línea, movimiento, ancho. */
export const PASSAGE_DIRECTION_SOURCES = [
  'camera',
  'line',
  'motion',
  'width',
  'none',
] as const;
export type PassageDirectionSource = (typeof PASSAGE_DIRECTION_SOURCES)[number];

const SOURCE_PRIORITY: Record<PassageDirectionSource, number> = {
  camera: 4,
  line: 3,
  motion: 2,
  width: 1,
  none: 0,
};

/** Mayor número = fuente más confiable. */
export function sourcePriority(source: PassageDirectionSource): number {
  return SOURCE_PRIORITY[source];
}

/**
 * Única fuente cuya dirección puede partir una pasada abierta en dos: el
 * cruce de línea (medido sobre la trayectoria del vehículo). `camera` es una
 * dirección FIJA de la cámara: en un portón con una cámara de entrada y otra
 * de salida, el auto que entra y es visto por la de salida no es una segunda
 * pasada.
 */
export function canSplitPassage(source: PassageDirectionSource): boolean {
  return source === 'line';
}

export interface DirectionReading {
  direction: PassageDirection;
  source: PassageDirectionSource;
}

/**
 * Dirección que informa una lectura entrante. Sin `direction_source` (worker
 * anterior) una dirección conocida se trata como la fuente más débil
 * (`width`), nunca como de alta prioridad; una dirección desconocida es
 * siempre `none`.
 */
export function readDirection(
  direction: PassageDirection | null | undefined,
  source: PassageDirectionSource | null | undefined,
): DirectionReading {
  if (direction !== 'entry' && direction !== 'exit') {
    return { direction: 'unknown', source: 'none' };
  }
  const effective: PassageDirectionSource =
    source === undefined || source === null || source === 'none'
      ? 'width'
      : source;
  return { direction, source: effective };
}

function isKnown(direction: PassageDirection): boolean {
  return direction === 'entry' || direction === 'exit';
}

/**
 * ¿La lectura entrante abre una pasada NUEVA aunque haya una abierta en la
 * ventana? Solo si ambas direcciones son conocidas y opuestas, las DOS fuentes
 * son `line` y pasó al menos `minReverseMs` desde el inicio de la pasada
 * abierta (el auto que entra y sale enseguida; un cruce espurio de línea en
 * los primeros segundos no abre dos veces). Si la pasada abierta solo tiene
 * una dirección débil (`camera`, `motion`, `width`), la lectura no la
 * contradice: la corrige (ver `shouldUpgradeDirection`).
 */
export function startsNewPassage(
  passage: DirectionReading,
  incoming: DirectionReading,
  passageAgeMs: number,
  minReverseMs: number,
): boolean {
  return (
    isKnown(passage.direction) &&
    isKnown(incoming.direction) &&
    passage.direction !== incoming.direction &&
    canSplitPassage(passage.source) &&
    canSplitPassage(incoming.source) &&
    passageAgeMs >= minReverseMs
  );
}

/** Lo que de la configuración de la cámara permite validar la fuente declarada. */
export interface CameraDirectionConfig {
  direction?: unknown;
  directionLine?: unknown;
}

/**
 * Validación de la fuente EN EL SERVIDOR (el worker declara `direction_source`
 * pero no es de confianza): `camera` solo vale si la cámara tiene configurada
 * esa misma dirección fija (`entry`/`exit`); `line` solo si la cámara tiene
 * `directionLine`. Si no, baja a `width` (la más débil con dirección), de
 * modo que nunca parta una pasada ni gane prioridad.
 */
export function verifyReadingSource(
  reading: DirectionReading,
  config: CameraDirectionConfig | null | undefined,
): DirectionReading {
  if (reading.direction === 'unknown') {
    return { direction: 'unknown', source: 'none' };
  }
  if (reading.source === 'camera') {
    const fixed = config?.direction;
    return fixed === reading.direction
      ? reading
      : { direction: reading.direction, source: 'width' };
  }
  if (reading.source === 'line') {
    const line = config?.directionLine;
    return typeof line === 'object' && line !== null
      ? reading
      : { direction: reading.direction, source: 'width' };
  }
  return reading;
}

/** ¿La lectura entrante mejora la dirección de la pasada (fuente de mayor prioridad)? */
export function shouldUpgradeDirection(
  passage: DirectionReading,
  incoming: DirectionReading,
): boolean {
  return (
    isKnown(incoming.direction) &&
    sourcePriority(incoming.source) > sourcePriority(passage.source)
  );
}

/** `method` de un intento cuyo método sigue la dirección de la pasada. */
export function methodForDirection(
  direction: PassageDirection,
  unknownMethod: string,
): string {
  if (direction === 'exit') return 'Patente - Salida';
  if (direction === 'entry') return 'Patente - Entrada';
  return unknownMethod;
}
