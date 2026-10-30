import { describe, expect, it } from 'vitest'
import {
  LOITER_SECONDS,
  cameraSchema,
  clampLoiterSeconds,
  parseGuardianZones,
  serializeGuardianZones,
  type GuardianZone,
} from './index'

const SQUARE = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
]

describe('parseGuardianZones', () => {
  it('lee el formato nuevo con tipo y segundos', () => {
    expect(
      parseGuardianZones([
        { points: SQUARE, type: 'intrusion' },
        { points: SQUARE, type: 'loitering', loiterSeconds: 45 },
      ]),
    ).toEqual([
      { points: SQUARE, type: 'intrusion' },
      { points: SQUARE, type: 'loitering', loiterSeconds: 45 },
    ])
  })

  it('lee el formato LEGACY ([[{x,y}]]) como intrusión', () => {
    expect(parseGuardianZones([SQUARE])).toEqual([{ points: SQUARE, type: 'intrusion' }])
  })

  it('mezcla legacy y nuevo en la misma cámara', () => {
    expect(parseGuardianZones([SQUARE, { points: SQUARE, type: 'loitering', loiterSeconds: 60 }])).toEqual([
      { points: SQUARE, type: 'intrusion' },
      { points: SQUARE, type: 'loitering', loiterSeconds: 60 },
    ])
  })

  it('un merodeo sin segundos válidos toma el valor por defecto; fuera de rango se ajusta', () => {
    const [noSeconds, tooLow, tooHigh] = parseGuardianZones([
      { points: SQUARE, type: 'loitering' },
      { points: SQUARE, type: 'loitering', loiterSeconds: 1 },
      { points: SQUARE, type: 'loitering', loiterSeconds: 9999 },
    ])
    expect(noSeconds.loiterSeconds).toBe(LOITER_SECONDS.default)
    expect(tooLow.loiterSeconds).toBe(LOITER_SECONDS.min)
    expect(tooHigh.loiterSeconds).toBe(LOITER_SECONDS.max)
  })

  it('un tipo desconocido se lee como intrusión y no arrastra segundos', () => {
    expect(parseGuardianZones([{ points: SQUARE, type: 'otro', loiterSeconds: 30 }])).toEqual([
      { points: SQUARE, type: 'intrusion' },
    ])
  })

  it('descarta polígonos inválidos (pocos puntos, fuera de 0..1, basura) sin tirar el resto', () => {
    expect(
      parseGuardianZones([
        SQUARE.slice(0, 2),
        [{ x: 2, y: 0 }, ...SQUARE.slice(0, 2)],
        { points: 'no' },
        null,
        42,
        { points: SQUARE, type: 'intrusion' },
      ]),
    ).toEqual([{ points: SQUARE, type: 'intrusion' }])
  })

  it.each([[undefined], [null], ['zonas'], [{}], [7]])('forma inesperada (%j) = sin zonas', (raw) => {
    expect(parseGuardianZones(raw)).toEqual([])
  })
})

describe('serializeGuardianZones', () => {
  it('siempre envía el formato nuevo; los segundos solo en merodeo', () => {
    const zones: GuardianZone[] = [
      { points: SQUARE, type: 'intrusion', loiterSeconds: 99 },
      { points: SQUARE, type: 'loitering', loiterSeconds: 45 },
      { points: SQUARE, type: 'loitering' },
    ]
    expect(serializeGuardianZones(zones)).toEqual([
      { points: SQUARE, type: 'intrusion' },
      { points: SQUARE, type: 'loitering', loiterSeconds: 45 },
      { points: SQUARE, type: 'loitering', loiterSeconds: LOITER_SECONDS.default },
    ])
  })

  it('ajusta los segundos al rango y los redondea', () => {
    expect(
      serializeGuardianZones([
        { points: SQUARE, type: 'loitering', loiterSeconds: 2 },
        { points: SQUARE, type: 'loitering', loiterSeconds: 700 },
        { points: SQUARE, type: 'loitering', loiterSeconds: 20.6 },
      ]).map((zone) => zone.loiterSeconds),
    ).toEqual([5, 600, 21])
  })

  it('una cámara legacy se re-guarda en el formato nuevo', () => {
    expect(serializeGuardianZones(parseGuardianZones([SQUARE]))).toEqual([{ points: SQUARE, type: 'intrusion' }])
  })
})

describe('clampLoiterSeconds', () => {
  it.each([
    [5, 5],
    [600, 600],
    [4, 5],
    [601, 600],
    [12.4, 12],
    [Number.NaN, 20],
    [Number.POSITIVE_INFINITY, 20],
  ])('%s -> %s', (input, expected) => {
    expect(clampLoiterSeconds(input)).toBe(expected)
  })
})

describe('cameraSchema.guardianZones', () => {
  const BASE = { id: '11111111-1111-4111-8111-111111111111', name: 'Portón' }

  it('acepta una cámara con zonas legacy, nuevas o mezcladas', () => {
    expect(cameraSchema.safeParse({ ...BASE, guardianZones: [SQUARE] }).success).toBe(true)
    expect(
      cameraSchema.safeParse({ ...BASE, guardianZones: [{ points: SQUARE, type: 'loitering', loiterSeconds: 30 }] }).success,
    ).toBe(true)
    expect(
      cameraSchema.safeParse({ ...BASE, guardianZones: [SQUARE, { points: SQUARE, type: 'intrusion' }] }).success,
    ).toBe(true)
  })
})
