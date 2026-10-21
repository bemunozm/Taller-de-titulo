import type { DirectionLine, LprExitSide, ZonePoint } from '@/types/index'

/** Relación de aspecto por defecto del video (16:9) cuando aún no se mide el lienzo. */
export const DEFAULT_VIDEO_ASPECT = 16 / 9

export const EXIT_SIDE_LABELS: Record<LprExitSide, string> = {
  left: 'la izquierda',
  right: 'la derecha',
}

export function flipExitSide(side: LprExitSide): LprExitSide {
  return side === 'left' ? 'right' : 'left'
}

export function directionLineLength(line: Pick<DirectionLine, 'from' | 'to'>): number {
  return Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)
}

/**
 * Lado de un punto respecto de la línea (contrato contracts/direction-line.cases.json):
 * con d = to - from y v = p - from, cross = d.x*v.y - d.y*v.x; cross < 0 => 'left',
 * cross > 0 => 'right' (eje y hacia abajo). Sobre la línea devuelve null.
 */
export function pointSide(line: Pick<DirectionLine, 'from' | 'to'>, point: ZonePoint): LprExitSide | null {
  const cross =
    (line.to.x - line.from.x) * (point.y - line.from.y) - (line.to.y - line.from.y) * (point.x - line.from.x)
  if (cross < 0) return 'left'
  if (cross > 0) return 'right'
  return null
}

export interface ExitArrow {
  /** Punto medio de la línea (donde nace la flecha). */
  base: ZonePoint
  /** Punta de la flecha. */
  tip: ZonePoint
  /** Dos puntos de las aletas de la punta. */
  barbs: [ZonePoint, ZonePoint]
}

const ARROW_LENGTH = 0.11
const BARB_LENGTH = 0.035

/**
 * Flecha perpendicular a la línea que apunta hacia `exitSide`, en coordenadas
 * normalizadas. La perpendicularidad se calcula en el espacio de pantalla
 * (corrigiendo por `aspect` = ancho/alto del video), porque el lienzo escala x e
 * y por separado. "Izquierda" es la izquierda de quien avanza de `from` a `to`
 * sobre la imagen (eje y hacia abajo): para una línea horizontal de izquierda a
 * derecha, izquierda = arriba.
 */
export function getExitArrow(line: DirectionLine, aspect: number = DEFAULT_VIDEO_ASPECT): ExitArrow {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_VIDEO_ASPECT
  // Espacio de pantalla: x se multiplica por el aspecto, y queda igual.
  const dx = (line.to.x - line.from.x) * safeAspect
  const dy = line.to.y - line.from.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  // Normal candidata (uy, -ux); si cae del lado equivocado según pointSide, se invierte.
  const baseNormal = { x: ((line.from.x + line.to.x) / 2) + (uy / safeAspect) * 0.01, y: (line.from.y + line.to.y) / 2 - ux * 0.01 }
  const sign = pointSide(line, baseNormal) === line.exitSide ? 1 : -1
  const nx = uy * sign
  const ny = -ux * sign

  const baseX = ((line.from.x + line.to.x) / 2) * safeAspect
  const baseY = (line.from.y + line.to.y) / 2
  const tipX = baseX + nx * ARROW_LENGTH
  const tipY = baseY + ny * ARROW_LENGTH

  const toNormalized = (x: number, y: number): ZonePoint => ({ x: x / safeAspect, y })
  // Aletas: hacia atrás desde la punta, abiertas a ambos lados del eje de la flecha.
  const barb = (side: 1 | -1): ZonePoint =>
    toNormalized(
      tipX - nx * BARB_LENGTH + ux * BARB_LENGTH * 0.7 * side,
      tipY - ny * BARB_LENGTH + uy * BARB_LENGTH * 0.7 * side,
    )

  return {
    base: toNormalized(baseX, baseY),
    tip: toNormalized(tipX, tipY),
    barbs: [barb(1), barb(-1)],
  }
}

/** Resumen de la línea para el formulario LPR. */
export function describeDirectionLine(line: DirectionLine | null | undefined): string {
  if (!line) return 'Sin línea: se usa la dirección fija de la cámara y, si no tiene, se infiere por el tamaño de la patente.'
  return `Línea de dirección definida — salida hacia ${EXIT_SIDE_LABELS[line.exitSide]}.`
}
