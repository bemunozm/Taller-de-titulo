import { describe, expect, it } from 'vitest'
import { parseAnomalyEvent } from './anomaly'

const FULL = {
  id: '11111111-1111-4111-8111-111111111111',
  cameraId: 'cam-1',
  anomalyType: 'intrusion',
  confidence: 0.9,
  snapshotJpegB64: '/9j/4AAQ',
  durationSeconds: 12,
  trackId: 3,
  suspicionLevel: 'HIGH',
  aiReasoning: 'Persona en zona restringida',
  timestamp: '2026-10-08T12:00:00.000Z',
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

  it.each([[null], [undefined], ['texto'], [42], [[]], [{}], [{ id: '' }], [{ id: 7 }]])(
    'sin id válido (%j) devuelve null',
    (raw) => {
      expect(parseAnomalyEvent(raw)).toBeNull()
    },
  )
})
