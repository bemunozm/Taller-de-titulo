import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type { AccessAttempt, AnomalyListPage } from '@/api/DetectionsAPI'
import { renderWithProviders } from '@/test/renderWithProviders'
import TraceabilityView from './TraceabilityView'

const detectionsApi = vi.hoisted(() => ({
  listAccessAttempts: vi.fn<() => Promise<AccessAttempt[]>>(),
  listAnomalies: vi.fn<() => Promise<AnomalyListPage>>(),
}))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeAttempt(id: string, decision: string): AccessAttempt {
  return {
    id,
    decision,
    method: 'lpr',
    createdAt: '2026-10-08T12:00:00.000Z',
    detection: {
      id: `det-${id}`,
      cameraId: 'cam-entrada',
      plate: `PLT${id}`,
      createdAt: '2026-10-08T12:00:00.000Z',
    },
  }
}

describe('TraceabilityView: estadísticas', () => {
  it('"Accesos Aprobados" cuenta los Permitido; un Duplicado no suma', async () => {
    detectionsApi.listAccessAttempts.mockResolvedValue([
      makeAttempt('1', 'Permitido'),
      makeAttempt('2', 'Permitido'),
      makeAttempt('3', 'Duplicado'),
      makeAttempt('4', 'Denegado'),
    ])
    detectionsApi.listAnomalies.mockResolvedValue({ items: [], total: 0 })
    renderWithProviders(<TraceabilityView />)

    const total = screen.getByRole('region', { name: 'Total de Intentos' })
    await waitFor(() => expect(within(total).getByText('4')).toBeInTheDocument())

    const approved = screen.getByRole('region', { name: 'Accesos Aprobados' })
    expect(within(approved).getByText('2')).toBeInTheDocument()
    expect(within(approved).getByText('50.0% del total')).toBeInTheDocument()

    const denied = screen.getByRole('region', { name: 'Accesos Denegados' })
    expect(within(denied).getByText('1')).toBeInTheDocument()
    expect(within(denied).getByText('25.0% del total')).toBeInTheDocument()
  })
})

describe('TraceabilityView: pestaña por URL', () => {
  it('?tab=anomalies abre la pestaña de anomalías (vuelta desde el detalle)', async () => {
    detectionsApi.listAccessAttempts.mockResolvedValue([])
    detectionsApi.listAnomalies.mockResolvedValue({ items: [], total: 0 })
    renderWithProviders(<TraceabilityView />, { route: '/traceability?tab=anomalies' })

    expect(await screen.findByText('Historial de Anomalías IA')).toBeInTheDocument()
  })
})
