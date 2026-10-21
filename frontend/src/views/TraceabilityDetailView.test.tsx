import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { AccessAttempt } from '@/api/DetectionsAPI'
import { renderWithProviders } from '@/test/renderWithProviders'
import TraceabilityDetailView from './TraceabilityDetailView'

const detectionsApi = vi.hoisted(() => ({ listAccessAttempts: vi.fn<() => Promise<AccessAttempt[]>>() }))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)
vi.mock('@/api/CameraAPI', () => ({ listCameras: async () => [] }))
vi.mock('@/api/PendingDetectionsAPI', () => ({
  respondToPendingDetection: vi.fn(),
  isPendingAlreadyRespondedError: () => false,
}))
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const SNAPSHOT_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/'
const LOCAL_PATH = String.raw`C:\lpr\detecciones\frame-001.jpg`
const FRAME_URL = 'https://cdn.example.cl/frames/001.jpg'

function makeAttempt(detection: { full_frame_path?: string | null; meta?: Record<string, unknown> }): AccessAttempt {
  return {
    id: 'att-1',
    decision: 'Registrado',
    method: 'Patente - Entrada',
    createdAt: '2026-10-20T12:00:00.000Z',
    detection: { id: 'det-1', cameraId: 'cam-1', plate: 'ZZZZ99', createdAt: '2026-10-20T12:00:00.000Z', ...detection },
  }
}

function renderDetail(attempt: AccessAttempt) {
  detectionsApi.listAccessAttempts.mockResolvedValue([attempt])
  return renderWithProviders(
    <Routes>
      <Route path="/t/:id" element={<TraceabilityDetailView />} />
    </Routes>,
    { route: '/t/att-1' },
  )
}

beforeEach(() => vi.clearAllMocks())

describe('TraceabilityDetailView: imagen capturada', () => {
  it('solo recorte (ruta local): muestra el recorte, sin la ruta ni "abrir original"', async () => {
    renderDetail(makeAttempt({ full_frame_path: LOCAL_PATH, meta: { snapshot_jpeg_b64: SNAPSHOT_B64 } }))

    const crop = await screen.findByAltText('Recorte de la patente')
    expect(crop).toHaveAttribute('src', `data:image/jpeg;base64,${SNAPSHOT_B64}`)
    expect(screen.queryByAltText('Frame capturado')).not.toBeInTheDocument()
    expect(screen.queryByText(/Abrir original/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('frame-001.jpg')
    expect(screen.getByText('Disponible')).toBeInTheDocument()
  })

  it('solo URL: muestra el cuadro y el enlace seguro', async () => {
    renderDetail(makeAttempt({ full_frame_path: FRAME_URL }))

    expect(await screen.findByAltText('Frame capturado')).toHaveAttribute('src', FRAME_URL)
    expect(screen.queryByAltText('Recorte de la patente')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Abrir original/ })
    expect(link).toHaveAttribute('href', FRAME_URL)
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('Disponible')).toBeInTheDocument()
  })

  it('ambas: muestra cuadro completo y recorte', async () => {
    renderDetail(makeAttempt({ full_frame_path: FRAME_URL, meta: { snapshot_jpeg_b64: SNAPSHOT_B64 } }))

    expect(await screen.findByAltText('Frame capturado')).toBeInTheDocument()
    expect(screen.getByAltText('Recorte de la patente')).toBeInTheDocument()
    expect(screen.getByText('Recorte de la patente')).toBeInTheDocument()
  })

  it('ninguna fuente válida: "No disponible" y sin imágenes', async () => {
    renderDetail(makeAttempt({ full_frame_path: LOCAL_PATH, meta: { snapshot_jpeg_b64: '<x>' } }))

    expect(await screen.findByText('No hay imagen disponible')).toBeInTheDocument()
    expect(screen.getByText('No disponible')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
