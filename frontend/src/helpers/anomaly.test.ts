import { describe, expect, it } from 'vitest'
import type { AnomalyEvent } from '@/types/anomaly'
import {
  anomalyDetailPath,
  ANOMALY_AI_POLL_MAX_UPDATES,
  ANOMALY_AI_POLL_MS,
  anomalyAiPollInterval,
  anomalyMetadata,
  anomalySeverity,
  anomalyStatusActions,
  anomalyStatusMeta,
  formatAnomalyConfidence,
  formatAnomalyDuration,
  resolveAnomalyCameraName,
} from './anomaly'

describe('anomaly helpers', () => {
  it('anomalyDetailPath codifica el id', () => {
    expect(anomalyDetailPath('abc')).toBe('/traceability/anomalies/abc')
    expect(anomalyDetailPath('../x')).toBe('/traceability/anomalies/..%2Fx')
  })

  it('anomalySeverity: niveles conocidos, desconocidos y vacío', () => {
    expect(anomalySeverity('HIGH')).toEqual({ label: 'Alta', color: 'red' })
    expect(anomalySeverity('medium')).toEqual({ label: 'Media', color: 'orange' })
    expect(anomalySeverity('LOW')).toEqual({ label: 'Baja', color: 'zinc' })
    expect(anomalySeverity('EXTREME')).toEqual({ label: 'EXTREME', color: 'zinc' })
    expect(anomalySeverity(null)).toBeNull()
    expect(anomalySeverity('')).toBeNull()
  })

  it('resolveAnomalyCameraName busca por id y por mountPath, con respaldo al identificador', () => {
    const cameras = [
      { id: 'uuid-1', name: 'Portón', mountPath: 'porton-1' },
      { id: 'uuid-2', name: '', location: 'Bodega' },
    ]
    expect(resolveAnomalyCameraName('uuid-1', cameras)).toBe('Portón')
    expect(resolveAnomalyCameraName('porton-1', cameras)).toBe('Portón')
    expect(resolveAnomalyCameraName('uuid-2', cameras)).toBe('Bodega')
    expect(resolveAnomalyCameraName('otra', cameras)).toBe('otra')
  })

  it('formatAnomalyConfidence y formatAnomalyDuration', () => {
    expect(formatAnomalyConfidence(0.917)).toBe('92%')
    expect(formatAnomalyDuration(45)).toBe('45 s')
    expect(formatAnomalyDuration(65)).toBe('1 min 5 s')
    expect(formatAnomalyDuration(null)).toBeNull()
    expect(formatAnomalyDuration(-1)).toBeNull()
  })

  it('anomalyMetadata omite la foto', () => {
    const anomaly: AnomalyEvent = {
      id: 'a',
      cameraId: 'c',
      anomalyType: 'intrusion',
      confidence: 0.5,
      status: 'open',
      snapshotJpegB64: '/9j/4AAQ',
      timestamp: '2026-10-08T12:00:00.000Z',
    }
    const meta = anomalyMetadata(anomaly)
    expect(meta).not.toHaveProperty('snapshotJpegB64')
    expect(meta).toMatchObject({ id: 'a', cameraId: 'c' })
  })

  it('anomalyStatusMeta da etiqueta y color a cada estado', () => {
    expect(anomalyStatusMeta('open')).toEqual({ label: 'Abierta', color: 'amber' })
    expect(anomalyStatusMeta('reviewed').label).toBe('Revisada')
    expect(anomalyStatusMeta('dismissed').label).toBe('Descartada')
    expect(anomalyStatusMeta('false_alarm').label).toBe('Falsa alarma')
  })

  it('una anomalía abierta se puede revisar, descartar o marcar falsa alarma', () => {
    expect(anomalyStatusActions('open').map((action) => action.target)).toEqual(['reviewed', 'dismissed', 'false_alarm'])
  })

  it.each(['reviewed', 'dismissed', 'false_alarm'] as const)('una anomalía %s solo se reabre', (status) => {
    const actions = anomalyStatusActions(status)
    expect(actions.map((action) => action.target)).toEqual(['open'])
    expect(actions[0].label).toBe('Reabrir')
  })

  it('anomalyAiPollInterval refresca solo mientras la IA analiza y con tope', () => {
    expect(anomalyAiPollInterval(true, 1)).toBe(ANOMALY_AI_POLL_MS)
    expect(anomalyAiPollInterval(false, 1)).toBe(false)
    expect(anomalyAiPollInterval(true, ANOMALY_AI_POLL_MAX_UPDATES)).toBe(false)
  })
})
