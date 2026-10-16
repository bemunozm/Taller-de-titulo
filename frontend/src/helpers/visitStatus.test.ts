import { describe, expect, it } from 'vitest'
import type { VisitStatus } from '@/types/index'
import {
  VISIT_STATUSES,
  canCancelVisit,
  canCheckInVisit,
  canCheckOutVisit,
  canEditVisit,
  canShowVisitQr,
  countVisitsByStatus,
  getVisitPlate,
  getVisitScanState,
  getVisitScanValidation,
  getVisitStatusColor,
  getVisitStatusLabel,
  getVisitStatusPluralLabel,
  isVisitStatus,
  type ScannableVisit,
} from './visitStatus'

describe('getVisitStatusLabel / getVisitStatusColor', () => {
  it.each<[VisitStatus, string, string]>([
    ['awaiting_approval', 'Esperando aprobación', 'orange'],
    ['pending', 'Pendiente', 'amber'],
    ['active', 'Activa', 'lime'],
    ['ready', 'Lista para Reingresar', 'cyan'],
    ['completed', 'Completada', 'sky'],
    ['cancelled', 'Cancelada', 'zinc'],
    ['expired', 'Expirada', 'rose'],
    ['denied', 'Rechazada', 'red'],
  ])('%s -> "%s" (%s)', (status, label, color) => {
    expect(getVisitStatusLabel(status)).toBe(label)
    expect(getVisitStatusColor(status)).toBe(color)
  })

  it('distingue "esperando aprobación" de "pendiente" (una solicitud no es una visita aprobada)', () => {
    expect(getVisitStatusColor('awaiting_approval')).not.toBe(getVisitStatusColor('pending'))
    expect(getVisitStatusLabel('awaiting_approval')).not.toBe(getVisitStatusLabel('pending'))
  })

  it.each(['something_new', '', 'PENDING', 'toString', '__proto__', null, undefined])(
    'usa el fallback neutro para el estado desconocido %s',
    (status) => {
      expect(getVisitStatusLabel(status)).toBe('Desconocido')
      expect(getVisitStatusPluralLabel(status)).toBe('Desconocidos')
      expect(getVisitStatusColor(status)).toBe('zinc')
    },
  )

  it('tiene etiqueta plural para cada estado (opciones del filtro)', () => {
    expect(getVisitStatusPluralLabel('awaiting_approval')).toBe('Esperando aprobación')
    expect(getVisitStatusPluralLabel('pending')).toBe('Pendientes')
    for (const status of VISIT_STATUSES) {
      expect(getVisitStatusPluralLabel(status)).not.toBe('Desconocidos')
    }
  })
})

describe('VISIT_STATUSES / isVisitStatus', () => {
  it('incluye awaiting_approval primero, en orden del ciclo de vida', () => {
    expect(VISIT_STATUSES[0]).toBe('awaiting_approval')
    expect(VISIT_STATUSES).toHaveLength(8)
  })

  it('reconoce solo los estados del contrato', () => {
    expect(isVisitStatus('awaiting_approval')).toBe(true)
    expect(isVisitStatus('ready')).toBe(true)
    expect(isVisitStatus('approved')).toBe(false)
    expect(isVisitStatus(42)).toBe(false)
  })
})

describe('reglas de acciones por estado', () => {
  // Espejo de la máquina de estados del backend: fuera de estas celdas responde 409.
  it.each<[VisitStatus, boolean, boolean, boolean, boolean]>([
    // status, checkIn, checkOut, cancel, edit
    ['awaiting_approval', false, false, false, false],
    ['pending', true, false, true, true],
    ['active', false, true, false, false],
    ['ready', true, false, false, true],
    ['completed', false, false, false, false],
    ['cancelled', false, false, false, false],
    ['expired', false, false, false, false],
    ['denied', false, false, false, false],
  ])('%s: checkIn=%s checkOut=%s cancel=%s edit=%s', (status, checkIn, checkOut, cancel, edit) => {
    expect(canCheckInVisit(status)).toBe(checkIn)
    expect(canCheckOutVisit(status)).toBe(checkOut)
    expect(canCancelVisit(status)).toBe(cancel)
    expect(canEditVisit(status)).toBe(edit)
  })

  it('no permite ninguna acción sobre un estado desconocido', () => {
    expect(canCheckInVisit('something_new')).toBe(false)
    expect(canCheckOutVisit('something_new')).toBe(false)
    expect(canCancelVisit('something_new')).toBe(false)
    expect(canEditVisit('something_new')).toBe(false)
  })
})

describe('canShowVisitQr', () => {
  it.each<[VisitStatus, boolean]>([
    ['awaiting_approval', false],
    ['pending', true],
    ['active', true],
    ['ready', true],
    ['completed', false],
    ['cancelled', false],
    ['expired', false],
    ['denied', false],
  ])('%s con qrCode -> %s', (status, expected) => {
    expect(canShowVisitQr({ status, qrCode: 'a1b2c3' })).toBe(expected)
  })

  it.each([null, undefined, ''])('no muestra el QR de una visita pending sin código (%s)', (qrCode) => {
    expect(canShowVisitQr({ status: 'pending', qrCode })).toBe(false)
  })

  it('no muestra el QR de un estado desconocido', () => {
    expect(canShowVisitQr({ status: 'something_new', qrCode: 'a1b2c3' })).toBe(false)
  })
})

describe('getVisitPlate', () => {
  const vehicle = { plate: 'ABCD12' }

  it('usa la patente del vehículo asociado', () => {
    expect(getVisitPlate({ vehicle, requestedPlate: 'ZZZZ99' })).toBe('ABCD12')
  })

  it('usa requestedPlate cuando la solicitud aún no tiene vehículo', () => {
    expect(getVisitPlate({ vehicle: null, requestedPlate: 'WXYZ34' })).toBe('WXYZ34')
    expect(getVisitPlate({ requestedPlate: 'WXYZ34' })).toBe('WXYZ34')
  })

  it('devuelve null sin vehículo ni patente solicitada', () => {
    expect(getVisitPlate({ vehicle: null, requestedPlate: null })).toBeNull()
    expect(getVisitPlate({})).toBeNull()
  })
})

describe('countVisitsByStatus', () => {
  it('cuenta cada estado, con ceros explícitos e ignorando estados desconocidos', () => {
    const counts = countVisitsByStatus([
      { status: 'awaiting_approval' },
      { status: 'awaiting_approval' },
      { status: 'pending' },
      { status: 'active' },
      { status: 'something_new' },
    ])

    expect(counts).toEqual({
      awaiting_approval: 2,
      pending: 1,
      active: 1,
      ready: 0,
      completed: 0,
      cancelled: 0,
      expired: 0,
      denied: 0,
    })
  })
})

describe('getVisitScanValidation', () => {
  const NOW = new Date('2026-10-08T15:00:00Z')

  function makeVisit(overrides: Partial<ScannableVisit> = {}): ScannableVisit {
    return {
      status: 'pending',
      validFrom: new Date('2026-10-08T12:00:00Z'),
      validUntil: new Date('2026-10-08T20:00:00Z'),
      maxUses: null,
      usedCount: 0,
      ...overrides,
    }
  }

  it('awaiting_approval: avisa que el residente aún no aprueba, aunque esté dentro de la ventana', () => {
    expect(getVisitScanValidation(makeVisit({ status: 'awaiting_approval' }), NOW)).toEqual({
      type: 'warning',
      message: 'La visita aún no fue aprobada por el residente',
      description: 'El código QR no es válido hasta que el residente apruebe la solicitud',
    })
  })

  it('awaiting_approval: el estado manda sobre la ventana vencida', () => {
    const visit = makeVisit({
      status: 'awaiting_approval',
      validUntil: new Date('2026-10-08T14:00:00Z'),
    })
    expect(getVisitScanValidation(visit, NOW)?.message).toBe(
      'La visita aún no fue aprobada por el residente',
    )
  })

  it('denied: error de visita rechazada', () => {
    expect(getVisitScanValidation(makeVisit({ status: 'denied' }), NOW)).toEqual({
      type: 'error',
      message: 'La visita fue rechazada',
      description: 'No se puede registrar entrada ni salida',
    })
  })

  it('cancelled: error de visita cancelada', () => {
    expect(getVisitScanValidation(makeVisit({ status: 'cancelled' }), NOW)).toEqual({
      type: 'error',
      message: 'La visita fue cancelada',
      description: 'No se puede registrar entrada ni salida',
    })
  })

  it('expired (estado): error de visita expirada con su fecha límite', () => {
    const result = getVisitScanValidation(makeVisit({ status: 'expired' }), NOW)
    expect(result).toMatchObject({ type: 'error', message: 'La visita expiró' })
    expect(result?.description).toMatch(/^Válida hasta: /)
  })

  it('completed: informa que la visita ya terminó', () => {
    expect(getVisitScanValidation(makeVisit({ status: 'completed' }), NOW)).toEqual({
      type: 'info',
      message: 'La visita ya está completada',
      description: 'No se pueden realizar más acciones',
    })
  })

  it.each<VisitStatus>(['pending', 'active', 'ready'])(
    '%s dentro de la ventana y con usos disponibles: sin advertencias',
    (status) => {
      expect(getVisitScanValidation(makeVisit({ status, maxUses: 3, usedCount: 1 }), NOW)).toBeNull()
    },
  )

  it('pending fuera de la ventana: expirada', () => {
    const visit = makeVisit({ validUntil: new Date('2026-10-08T14:00:00Z') })
    expect(getVisitScanValidation(visit, NOW)).toMatchObject({
      type: 'error',
      message: 'La visita expiró',
    })
  })

  it('pending antes de su inicio: aún no válida', () => {
    const visit = makeVisit({ validFrom: new Date('2026-10-08T16:00:00Z') })
    const result = getVisitScanValidation(visit, NOW)
    expect(result).toMatchObject({ type: 'warning', message: 'La visita aún no es válida' })
    expect(result?.description).toMatch(/^Válida desde: /)
  })

  it('acepta fechas como string ISO (respuesta cruda de la API)', () => {
    const visit = makeVisit({ validFrom: '2026-10-08T16:00:00Z', validUntil: '2026-10-08T20:00:00Z' })
    expect(getVisitScanValidation(visit, NOW)?.message).toBe('La visita aún no es válida')
  })

  it('pending con usos agotados: máximo de usos', () => {
    expect(getVisitScanValidation(makeVisit({ maxUses: 2, usedCount: 2 }), NOW)).toEqual({
      type: 'error',
      message: 'Se alcanzó el máximo de usos',
      description: 'Usos: 2 / 2',
    })
  })

  it('ready con usos agotados: máximo de usos (bloquea el reingreso)', () => {
    const visit = makeVisit({ status: 'ready', maxUses: 2, usedCount: 2 })
    expect(getVisitScanValidation(visit, NOW)?.message).toBe('Se alcanzó el máximo de usos')
  })

  it('active con maxUses=1 y su único uso consumido: sin advertencias (la salida sigue habilitada)', () => {
    const visit = makeVisit({ status: 'active', maxUses: 1, usedCount: 1 })
    expect(getVisitScanValidation(visit, NOW)).toBeNull()
  })

  it('active fuera de su ventana: advierte, sin tratarla como expirada', () => {
    const visit = makeVisit({
      status: 'active',
      maxUses: 1,
      usedCount: 1,
      validUntil: new Date('2026-10-08T14:00:00Z'),
    })
    expect(getVisitScanValidation(visit, NOW)).toEqual({
      type: 'warning',
      message: 'La visita superó su período válido',
      description: 'El visitante sigue dentro: registra su salida',
    })
  })

  it('estado desconocido: error (fail-closed)', () => {
    expect(getVisitScanValidation(makeVisit({ status: 'something_new' }), NOW)).toEqual({
      type: 'error',
      message: 'La visita tiene un estado desconocido',
      description: 'No se puede registrar entrada ni salida',
    })
  })
})

describe('getVisitScanState', () => {
  const NOW = new Date('2026-10-08T15:00:00Z')

  function makeVisit(overrides: Partial<ScannableVisit> = {}): ScannableVisit {
    return {
      status: 'pending',
      validFrom: new Date('2026-10-08T12:00:00Z'),
      validUntil: new Date('2026-10-08T20:00:00Z'),
      maxUses: null,
      usedCount: 0,
      ...overrides,
    }
  }

  it('awaiting_approval: ni entrada ni salida, con la advertencia de aprobación', () => {
    const state = getVisitScanState(makeVisit({ status: 'awaiting_approval' }), NOW)
    expect(state.canCheckIn).toBe(false)
    expect(state.canCheckOut).toBe(false)
    expect(state.validation?.message).toBe('La visita aún no fue aprobada por el residente')
  })

  it('pending dentro de la ventana: permite la entrada', () => {
    expect(getVisitScanState(makeVisit(), NOW)).toEqual({
      validation: null,
      canCheckIn: true,
      canCheckOut: false,
    })
  })

  it('pending antes de su inicio: no permite la entrada', () => {
    const state = getVisitScanState(makeVisit({ validFrom: new Date('2026-10-08T16:00:00Z') }), NOW)
    expect(state.canCheckIn).toBe(false)
    expect(state.validation?.type).toBe('warning')
  })

  it('active con maxUses=1 consumido: permite la salida, sin advertencias', () => {
    expect(getVisitScanState(makeVisit({ status: 'active', maxUses: 1, usedCount: 1 }), NOW)).toEqual({
      validation: null,
      canCheckIn: false,
      canCheckOut: true,
    })
  })

  it('active fuera de su ventana: la salida sigue habilitada', () => {
    const visit = makeVisit({ status: 'active', validUntil: new Date('2026-10-08T14:00:00Z') })
    expect(getVisitScanState(visit, NOW).canCheckOut).toBe(true)
  })
})
