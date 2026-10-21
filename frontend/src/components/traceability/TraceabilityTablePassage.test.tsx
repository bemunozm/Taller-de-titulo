import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { AccessAttempt, AttemptPassage } from '@/api/DetectionsAPI'
import { renderWithProviders } from '@/test/renderWithProviders'
import TraceabilityTable from './TraceabilityTable'

const detectionsApi = vi.hoisted(() => ({
  listAccessAttempts: vi.fn<() => Promise<AccessAttempt[]>>(),
}))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function passage(cameraIds: string[]): AttemptPassage {
  return {
    id: 'pas',
    direction: 'exit',
    directionSource: 'line',
    firstSeenAt: '2026-10-21T12:00:00.000Z',
    lastSeenAt: '2026-10-21T12:00:05.000Z',
    sightingCount: cameraIds.length,
    sightings: cameraIds.map((cameraId, index) => ({
      detectionId: `det-${index}`,
      cameraId,
      at: '2026-10-21T12:00:00.000Z',
      direction: 'exit' as const,
      directionSource: 'line' as const,
    })),
  }
}

function makeAttempt(id: string, plate: string, extra: Partial<AccessAttempt> = {}): AccessAttempt {
  return {
    id,
    decision: 'Registrado',
    method: 'Patente - Salida',
    createdAt: '2026-10-21T12:00:00.000Z',
    detection: { id: `det-${id}`, cameraId: 'cam-a', plate, createdAt: '2026-10-21T12:00:00.000Z' },
    ...extra,
  }
}

describe('TraceabilityTable: pasadas multicámara', () => {
  it('muestra "×N cámaras" solo si varias cámaras distintas vieron el paso', async () => {
    detectionsApi.listAccessAttempts.mockResolvedValue([
      makeAttempt('11111111-aaaa', 'AAAA11', { passage: passage(['cam-a', 'cam-b']) }),
      makeAttempt('22222222-bbbb', 'BBBB22', { passage: passage(['cam-a']) }),
      makeAttempt('33333333-cccc', 'CCCC33', { passage: passage(['cam-a', 'cam-a']) }),
      makeAttempt('44444444-dddd', 'DDDD44'),
      makeAttempt('55555555-eeee', 'EEEE55', { passage: null }),
    ])
    renderWithProviders(<TraceabilityTable />)
    await screen.findByRole('row', { name: /AAAA11/ })

    expect(within(screen.getByRole('row', { name: /AAAA11/ })).getByText('×2 cámaras')).toBeInTheDocument()
    for (const plate of [/BBBB22/, /CCCC33/, /DDDD44/, /EEEE55/]) {
      expect(within(screen.getByRole('row', { name: plate })).queryByText(/cámaras/)).not.toBeInTheDocument()
    }
  })
})
