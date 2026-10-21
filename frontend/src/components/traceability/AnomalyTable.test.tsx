import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnomalyEvent } from '@/api/DetectionsAPI'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Route, Routes } from 'react-router-dom'
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

describe('AnomalyTable: navegación al detalle', () => {
  function renderWithRoutes() {
    return renderWithProviders(
      <Routes>
        <Route path="/" element={<AnomalyTable />} />
        <Route path="/traceability/anomalies/:id" element={<p>Pantalla de detalle</p>} />
      </Routes>,
    )
  }

  it('cada fila enlaza al detalle de su anomalía, con nombre accesible', async () => {
    detectionsApi.listAnomalies.mockResolvedValue([ANOMALY])
    renderWithRoutes()

    await screen.findByText('cam-porton')
    const links = screen.getAllByRole('link', { name: /Ver detalle de la anomalía/ })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('href', `/traceability/anomalies/${ANOMALY.id}`)
    }
    // Solo el enlace de la primera celda entra en el orden de tabulación.
    expect(links.filter((link) => link.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('con el teclado: Enter sobre el enlace abre el detalle', async () => {
    detectionsApi.listAnomalies.mockResolvedValue([ANOMALY])
    const user = userEvent.setup()
    renderWithRoutes()

    await screen.findByText('cam-porton')
    await user.tab() // filtros
    const first = screen.getAllByRole('link', { name: /Ver detalle de la anomalía/ })[0]
    first.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByText('Pantalla de detalle')).toBeInTheDocument()
  })

  it('click en la fila (el enlace que la cubre) abre el detalle', async () => {
    detectionsApi.listAnomalies.mockResolvedValue([ANOMALY])
    const user = userEvent.setup()
    renderWithRoutes()

    await screen.findByText('cam-porton')
    await user.click(screen.getAllByRole('link', { name: /Ver detalle de la anomalía/ })[2])

    expect(await screen.findByText('Pantalla de detalle')).toBeInTheDocument()
  })
})
