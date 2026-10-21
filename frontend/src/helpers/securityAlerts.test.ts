import { describe, expect, it } from 'vitest'
import {
  anomalyTypeLabel,
  canReceiveSecurityAlerts,
  parseAnomalyHighlight,
  toJpegDataUrl,
} from './securityAlerts'

describe('canReceiveSecurityAlerts', () => {
  it('exige detections.read y condominium.view-all', () => {
    expect(canReceiveSecurityAlerts({ isSuperAdmin: false, permissions: ['detections.read', 'condominium.view-all'] })).toBe(true)
    expect(canReceiveSecurityAlerts({ isSuperAdmin: false, permissions: ['detections.read'] })).toBe(false)
    expect(canReceiveSecurityAlerts({ isSuperAdmin: false, permissions: ['condominium.view-all'] })).toBe(false)
    expect(canReceiveSecurityAlerts({ isSuperAdmin: false, permissions: [] })).toBe(false)
  })

  it('el super-admin nunca, aunque tenga ambos permisos (el servidor no lo une a ninguna sala)', () => {
    expect(canReceiveSecurityAlerts({ isSuperAdmin: true, permissions: [] })).toBe(false)
    expect(canReceiveSecurityAlerts({ isSuperAdmin: true, permissions: ['detections.read', 'condominium.view-all'] })).toBe(false)
  })
})

describe('parseAnomalyHighlight', () => {
  it('lee el payload del contrato', () => {
    expect(
      parseAnomalyHighlight({
        anomalyId: 'anom-1',
        cameraId: 'cam-1',
        cameraName: 'Acceso norte',
        type: 'loitering',
        severity: 'medium',
        reasoning: 'Merodeo de 40 s',
        timestamp: 1_791_551_766_453,
      }),
    ).toEqual({
      anomalyId: 'anom-1',
      cameraId: 'cam-1',
      cameraName: 'Acceso norte',
      type: 'loitering',
      severity: 'MEDIUM',
      reasoning: 'Merodeo de 40 s',
      timestamp: new Date(1_791_551_766_453),
    })
  })

  it('tolera los nombres de la entidad (id, anomalyType, suspicionLevel, aiReasoning)', () => {
    expect(
      parseAnomalyHighlight({
        id: 'anom-2',
        anomalyType: 'intrusion',
        suspicionLevel: 'HIGH',
        aiReasoning: 'Intrusión',
      }),
    ).toEqual({
      anomalyId: 'anom-2',
      cameraId: null,
      cameraName: null,
      type: 'intrusion',
      severity: 'HIGH',
      reasoning: 'Intrusión',
      timestamp: null,
    })
  })

  it('un nivel desconocido o una fecha inválida quedan en null', () => {
    const highlight = parseAnomalyHighlight({ anomalyId: 'a', severity: 'CRITICAL', timestamp: 'ayer' })

    expect(highlight?.severity).toBeNull()
    expect(highlight?.timestamp).toBeNull()
  })

  it('ignora una imagen que venga en el payload', () => {
    expect(parseAnomalyHighlight({ anomalyId: 'a', snapshotJpegB64: '/9j/' })).not.toHaveProperty('snapshotJpegB64')
  })

  it.each([null, undefined, 'anom-1', 42, {}, { anomalyId: '   ' }, { anomalyId: 7 }])(
    'descarta un payload sin id (%j)',
    (raw) => {
      expect(parseAnomalyHighlight(raw)).toBeNull()
    },
  )
})

describe('anomalyTypeLabel', () => {
  it.each([
    ['intrusion', 'Intrusión en zona prohibida'],
    ['LOITERING', 'Merodeo prolongado'],
    ['otro', 'Actividad anómala'],
    ['constructor', 'Actividad anómala'],
    [null, 'Actividad anómala'],
  ])('%s → %s', (type, label) => {
    expect(anomalyTypeLabel(type)).toBe(label)
  })
})

describe('toJpegDataUrl', () => {
  it('arma la data URL de un base64 válido', () => {
    expect(toJpegDataUrl('/9j/4AAQ\nSkZJRg==')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==')
  })

  it('acepta una data URL ya armada', () => {
    expect(toJpegDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ')
  })

  it.each([null, undefined, '', '   ', 'javascript:alert(1)', '"><script>'])('rechaza %j', (value) => {
    expect(toJpegDataUrl(value)).toBeNull()
  })
})
