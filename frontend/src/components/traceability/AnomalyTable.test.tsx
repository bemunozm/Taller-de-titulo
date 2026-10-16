import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnomalyEvent } from '@/api/DetectionsAPI'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import AnomalyTable from './AnomalyTable'

const detectionsApi = vi.hoisted(() => ({ listAnomalies: vi.fn<() => Promise<AnomalyEvent[]>>() }))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)

beforeEach(() => {
  vi.clearAllMocks()
})

const ANOMALY: AnomalyEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  cameraId: 'cam-porton',
  anomalyType: 'intrusion',
  confidence: 0.92,
  suspicionLevel: null,
  aiReasoning: null,
  timestamp: '2026-10-08T12:00:00.000Z',
}

describe('AnomalyTable (GET /anomalies con la sesión)', () => {
  it('lista las anomalías y tolera columnas nulas', async () => {
    detectionsApi.listAnomalies.mockResolvedValue([ANOMALY])
    renderWithProviders(<AnomalyTable />)

    expect(await screen.findByText('cam-porton')).toBeInTheDocument()
    expect(screen.getByText('Sin evaluar')).toBeInTheDocument()
    expect(screen.getByText('Sin evaluación disponible')).toBeInTheDocument()
  })

  it('vacío: lo dice explícitamente', async () => {
    detectionsApi.listAnomalies.mockResolvedValue([])
    renderWithProviders(<AnomalyTable />)

    expect(await screen.findByText('No hay anomalías registradas')).toBeInTheDocument()
  })

  it('error: lo muestra (no como "sin anomalías") y permite reintentar', async () => {
    detectionsApi.listAnomalies.mockRejectedValueOnce(
      new ApiError('Tu sesión no permite ver las anomalías', 401),
    )
    detectionsApi.listAnomalies.mockResolvedValueOnce([ANOMALY])
    const user = userEvent.setup()
    renderWithProviders(<AnomalyTable />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión no permite ver las anomalías')
    expect(screen.queryByText('No hay anomalías registradas')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Reintentar/ }))

    await waitFor(() => expect(screen.getByText('cam-porton')).toBeInTheDocument())
  })
})
