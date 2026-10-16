import { describe, expect, it } from 'vitest'
import {
  buildResidentOutcomeMessages,
  interpretKioskSessionStatus,
  interpretResidentResponsePayload,
} from './kioskResidentResponse'

const SESSION_ID = 'session-1'

describe('interpretResidentResponsePayload (socket)', () => {
  it.each([
    ['aprobada con ingreso registrado', { approved: true, entryRegistered: true }, 'admitted'],
    ['aprobada sin ingreso registrado', { approved: true, entryRegistered: false }, 'approved-not-opened'],
    ['rechazada', { approved: false, entryRegistered: false }, 'denied'],
  ] as const)('%s', (_case, payload, expected) => {
    expect(interpretResidentResponsePayload({ sessionId: SESSION_ID, ...payload }, SESSION_ID)).toBe(expected)
  })

  it.each([
    ['sin entryRegistered', { approved: true }],
    ['entryRegistered null', { approved: true, entryRegistered: null }],
    ['entryRegistered como string', { approved: true, entryRegistered: 'true' }],
    ['entryRegistered como número', { approved: true, entryRegistered: 1 }],
  ])('payload inesperado (%s): aprobada pero tratada como NO registrada', (_case, payload) => {
    expect(interpretResidentResponsePayload(payload, SESSION_ID)).toBe('approved-not-opened')
  })

  it.each([
    ['null', null],
    ['string', 'approved'],
    ['approved no booleano', { approved: 'true', entryRegistered: true }],
    ['formato viejo de PendingAction (sin approved)', { outcome: 'approved', message: '...' }],
    ['de otra sesión', { sessionId: 'otra', approved: true, entryRegistered: true }],
  ])('no es una decisión (%s): se ignora', (_case, payload) => {
    expect(interpretResidentResponsePayload(payload, SESSION_ID)).toBeNull()
  })
})

describe('interpretKioskSessionStatus (polling)', () => {
  it('approved + entryRegistered true → admitted', () => {
    expect(
      interpretKioskSessionStatus({ active: false, residentResponse: 'approved', entryRegistered: true, visitId: 'v' }),
    ).toEqual({ kind: 'resolved', outcome: 'admitted' })
  })

  it.each([null, undefined])('approved + entryRegistered %s → processing (aunque active sea false)', (entryRegistered) => {
    expect(
      interpretKioskSessionStatus({ active: false, residentResponse: 'approved', entryRegistered, visitId: 'v' }),
    ).toEqual({ kind: 'processing' })
  })

  it.each([false, 'true', 1])(
    'approved + entryRegistered %s → approved-not-opened definitivo (nunca admitted)',
    (entryRegistered) => {
      expect(interpretKioskSessionStatus({ residentResponse: 'approved', entryRegistered })).toEqual({
        kind: 'resolved',
        outcome: 'approved-not-opened',
      })
    },
  )

  it('denied → denied', () => {
    expect(interpretKioskSessionStatus({ residentResponse: 'denied', entryRegistered: null })).toEqual({
      kind: 'resolved',
      outcome: 'denied',
    })
  })

  it('pendiente y activa → sigue esperando', () => {
    expect(interpretKioskSessionStatus({ active: true, residentResponse: 'pending', entryRegistered: null })).toEqual({
      kind: 'waiting',
    })
  })

  it('sesión terminada sin respuesta → closed', () => {
    expect(interpretKioskSessionStatus({ active: false, residentResponse: 'pending' })).toEqual({ kind: 'closed' })
  })

  it('respuesta ilegible → sigue esperando (no inventa una decisión)', () => {
    expect(interpretKioskSessionStatus('<html>')).toEqual({ kind: 'waiting' })
  })
})

describe('buildResidentOutcomeMessages (fail-closed)', () => {
  it('admitted: única que instruye la bienvenida e ingreso', () => {
    const messages = buildResidentOutcomeMessages('admitted')

    expect(messages.agentInstruction).toMatch(/bienvenida/i)
    expect(messages.agentInstruction).toMatch(/puede ingresar/i)
    expect(messages.transcript).toMatch(/acceso quedó habilitado/i)
    expect(messages.panelResponse).toBe('approved')
  })

  it('approved-not-opened: aprobada, el acceso no se abrió automáticamente, que espere a conserjería y NO que pase', () => {
    const messages = buildResidentOutcomeMessages('approved-not-opened')

    expect(messages.agentInstruction).toMatch(/aprob/i)
    expect(messages.agentInstruction).toMatch(/acceso NO se abrió automáticamente/i)
    expect(messages.agentInstruction).toMatch(/espere/i)
    expect(messages.agentInstruction).toMatch(/conserjería/i)
    expect(messages.agentInstruction).toMatch(/NO le digas al visitante que pase/)
    expect(messages.agentInstruction).not.toMatch(/bienvenida|puede ingresar/i)
    expect(messages.transcript).toMatch(/el acceso no se abrió automáticamente/i)
    expect(messages.transcript).not.toMatch(/puede ingresar|pase\b/i)
    expect(messages.panelResponse).toBe('approved-not-opened')
  })

  it('closed: no pudo completarse o expiró, puede reintentar o contactar a conserjería, y cuelga', () => {
    const messages = buildResidentOutcomeMessages('closed')

    expect(messages.agentInstruction).toMatch(/no pudo completarse o expiró/i)
    expect(messages.agentInstruction).toMatch(/intentarlo de nuevo/i)
    expect(messages.agentInstruction).toMatch(/conserjería/i)
    expect(messages.agentInstruction).toMatch(/finalizar_llamada\(\)/)
    expect(messages.agentInstruction).toMatch(/NO le digas al visitante que pase/)
    expect(messages.agentInstruction).not.toMatch(/bienvenida|puede ingresar/i)
    expect(messages.panelResponse).toBe('unanswered')
  })

  it('no-response: el residente no respondió, intentar más tarde o conserjería, y cuelga', () => {
    const messages = buildResidentOutcomeMessages('no-response')

    expect(messages.agentInstruction).toMatch(/no respondió/i)
    expect(messages.agentInstruction).toMatch(/más tarde/i)
    expect(messages.agentInstruction).toMatch(/conserjería/i)
    expect(messages.agentInstruction).toMatch(/finalizar_llamada\(\)/)
    expect(messages.agentInstruction).not.toMatch(/bienvenida|puede ingresar/i)
    expect(messages.transcript).toMatch(/no respondió/i)
    expect(messages.panelResponse).toBe('unanswered')
  })

  it('denied: no puede ingresar', () => {
    const messages = buildResidentOutcomeMessages('denied')

    expect(messages.agentInstruction).toMatch(/no puede ingresar/i)
    expect(messages.agentInstruction).not.toMatch(/bienvenida/i)
    expect(messages.transcript).toMatch(/rechazó/i)
    expect(messages.panelResponse).toBe('denied')
  })

  it('un payload inesperado termina en el mensaje sin "pase"', () => {
    const outcome = interpretResidentResponsePayload({ approved: true, entryRegistered: 'yes' }, SESSION_ID)
    expect(outcome).not.toBeNull()

    const messages = buildResidentOutcomeMessages(outcome ?? 'denied')
    expect(messages.agentInstruction).not.toMatch(/bienvenida|puede ingresar/i)
    expect(messages.panelResponse).toBe('approved-not-opened')
  })
})
