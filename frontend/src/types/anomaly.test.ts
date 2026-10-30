import { describe, expect, it } from 'vitest'
import { parseAnomalyEvent, parseAnomalyListItem, parseAnomalyListPage } from './anomaly'

const FULL = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: 'org-1',
  cameraId: 'cam-1',
  anomalyType: 'intrusion',
  confidence: 0.9,
  snapshotJpegB64: '/9j/4AAQ',
  durationSeconds: 12,
  trackId: 3,
  suspicionLevel: 'HIGH',
  aiReasoning: 'Persona en zona restringida',
  timestamp: '2026-10-08T12:00:00.000Z',
  status: 'open',
  resolvedById: null,
  resolvedAt: null,
  resolutionNote: null,
  aiStatus: 'done',
  aiFalsePositive: false,
}

function without(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
}

describe('parseAnomalyEvent', () => {
  it('lee una anomalía completa', () => {
    expect(parseAnomalyEvent(FULL)).toEqual(FULL)
  })

  it('acepta columnas nulas', () => {
    const parsed = parseAnomalyEvent({ ...FULL, snapshotJpegB64: null, suspicionLevel: null, aiReasoning: null, trackId: null })
    expect(parsed).toMatchObject({ snapshotJpegB64: null, suspicionLevel: null, aiReasoning: null, trackId: null })
  })

  it('un campo defectuoso cae a un valor neutro sin tirar el resto', () => {
    const parsed = parseAnomalyEvent({ ...FULL, confidence: 'alta', durationSeconds: 'x', timestamp: 5 })
    expect(parsed).toMatchObject({ id: FULL.id, confidence: 0, durationSeconds: null, timestamp: '' })
  })

  it('una fila anterior a la revisión (sin status ni aiStatus) queda abierta y sin estado de IA', () => {
    const legacy = without(FULL, 'status', 'aiStatus', 'aiFalsePositive')
    const parsed = parseAnomalyEvent(legacy)
    expect(parsed?.status).toBe('open')
    expect(parsed?.aiStatus ?? null).toBeNull()
    expect(parsed?.aiFalsePositive ?? null).toBeNull()
  })

  it('un status o aiStatus desconocido cae a "open" / null', () => {
    expect(parseAnomalyEvent({ ...FULL, status: 'archivada', aiStatus: 'quizas' })).toMatchObject({
      status: 'open',
      aiStatus: null,
    })
  })

  it.each(['open', 'reviewed', 'dismissed', 'false_alarm'])('conserva el estado %s', (status) => {
    expect(parseAnomalyEvent({ ...FULL, status })?.status).toBe(status)
  })

  it.each(['pending', 'done', 'failed', 'skipped'])('conserva aiStatus %s', (aiStatus) => {
    expect(parseAnomalyEvent({ ...FULL, aiStatus })?.aiStatus).toBe(aiStatus)
  })

  it('lee la resolución', () => {
    const parsed = parseAnomalyEvent({
      ...FULL,
      status: 'false_alarm',
      resolvedById: 'user-1',
      resolvedAt: '2026-10-09T10:00:00.000Z',
      resolutionNote: 'Era el jardinero',
    })
    expect(parsed).toMatchObject({
      status: 'false_alarm',
      resolvedById: 'user-1',
      resolvedAt: '2026-10-09T10:00:00.000Z',
      resolutionNote: 'Era el jardinero',
    })
  })

  it.each([[null], [undefined], ['texto'], [42], [[]], [{}], [{ id: '' }], [{ id: 7 }]])(
    'sin id válido (%j) devuelve null',
    (raw) => {
      expect(parseAnomalyEvent(raw)).toBeNull()
    },
  )
})

describe('parseAnomalyListItem / parseAnomalyListPage', () => {
  it('una fila del listado no inventa foto', () => {
    const row = without(FULL, 'snapshotJpegB64')
    expect(parseAnomalyListItem(row)).not.toHaveProperty('snapshotJpegB64')
  })

  it('lee { items, total }', () => {
    const row = without(FULL, 'snapshotJpegB64')
    const page = parseAnomalyListPage({ items: [row, { ...row, id: 'otra' }], total: 57 })
    expect(page.items.map((item) => item.id)).toEqual([FULL.id, 'otra'])
    expect(page.total).toBe(57)
  })

  it('descarta filas sin id y usa la cantidad de filas si el total falta o es inválido', () => {
    const page = parseAnomalyListPage({ items: [{ id: 'a' }, { nada: true }, null], total: 'muchas' })
    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(1)
  })

  it('un total menor que las filas recibidas no se respeta', () => {
    expect(parseAnomalyListPage({ items: [{ id: 'a' }, { id: 'b' }], total: 1 }).total).toBe(2)
  })

  it('acepta un arreglo suelto (forma anterior) como una sola página', () => {
    const page = parseAnomalyListPage([{ id: 'a' }, { id: 'b' }])
    expect(page).toMatchObject({ total: 2 })
    expect(page.items).toHaveLength(2)
  })

  it.each([[null], [undefined], ['x'], [{}], [{ items: 'no' }]])('forma inesperada (%j) = página vacía', (raw) => {
    expect(parseAnomalyListPage(raw)).toEqual({ items: [], total: 0 })
  })
})
