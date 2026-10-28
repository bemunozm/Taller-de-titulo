import { describe, expect, it } from 'vitest'
import {
  KIOSK_QR_CODE_PATTERN,
  describeQrOutcome,
  outcomeFromRedeemResult,
  type KioskQrOutcome,
} from './kioskQr'

describe('KIOSK_QR_CODE_PATTERN', () => {
  it.each(['ABCD1234', 'a1b2c3d4e5', 'A'.repeat(64)])('acepta %s', (code) => {
    expect(KIOSK_QR_CODE_PATTERN.test(code)).toBe(true)
  })

  it.each(['', 'ABC123', 'A'.repeat(65), 'ABCD 1234', 'ABCD-1234', 'https://x.cl/ABCD1234', 'ABCD1234\n'])(
    'rechaza %j',
    (code) => {
      expect(KIOSK_QR_CODE_PATTERN.test(code)).toBe(false)
    },
  )
})

describe('outcomeFromRedeemResult', () => {
  it('traduce el contrato del backend', () => {
    expect(outcomeFromRedeemResult({ status: 'granted', access: 'vehicular', doorOpened: false })).toEqual({
      kind: 'granted',
      access: 'vehicular',
      doorOpened: false,
    })
    expect(outcomeFromRedeemResult({ status: 'denied', reason: 'expired' })).toEqual({ kind: 'denied', reason: 'expired' })
  })
})

describe('describeQrOutcome', () => {
  const OUTCOMES: KioskQrOutcome[] = [
    { kind: 'granted', access: 'pedestrian', doorOpened: true },
    { kind: 'granted', access: 'vehicular', doorOpened: true },
    { kind: 'granted', access: 'pedestrian', doorOpened: false },
    { kind: 'denied', reason: 'invalid' },
    { kind: 'denied', reason: 'not_yet_valid' },
    { kind: 'denied', reason: 'expired' },
    { kind: 'denied', reason: 'already_inside' },
    { kind: 'denied', reason: 'no_uses_left' },
    { kind: 'denied', reason: 'host_inactive' },
    { kind: 'rate-limited' },
    { kind: 'error' },
    { kind: 'camera-error' },
  ]

  it('cada caso tiene título y detalle propios, sin repetir ninguno', () => {
    const messages = OUTCOMES.map((outcome) => describeQrOutcome(outcome))
    const unique = new Set(messages.map((message) => JSON.stringify(message)))

    expect(unique.size).toBe(OUTCOMES.length)
    expect(messages.every((message) => message.title.trim() !== '' && message.detail.trim() !== '')).toBe(true)
  })

  it('solo "permitido con puerta abierta" es de éxito', () => {
    const successes = OUTCOMES.filter((outcome) => describeQrOutcome(outcome).tone === 'success')

    expect(successes).toEqual([
      { kind: 'granted', access: 'pedestrian', doorOpened: true },
      { kind: 'granted', access: 'vehicular', doorOpened: true },
    ])
  })

  it('permitido sin apertura pide avisar al conserje (no dice que la puerta se abre)', () => {
    const message = describeQrOutcome({ kind: 'granted', access: 'pedestrian', doorOpened: false })

    expect(message.title).toBe('Avise al conserje')
    expect(message.tone).toBe('warning')
    expect(message.detail).not.toMatch(/se está abriendo/)
  })

  it('no revela datos de la visita ni del residente en ningún mensaje', () => {
    for (const outcome of OUTCOMES) {
      const { title, detail } = describeQrOutcome(outcome)
      expect(`${title} ${detail}`).not.toMatch(/residente|nombre|rut|departamento \d|casa \d/i)
    }
  })
})
