import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import type { AnomalyEvent } from '@/api/DetectionsAPI'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import AnomalyDetailView from './AnomalyDetailView'

const detectionsApi = vi.hoisted(() => ({ getAnomaly: vi.fn<(id: string) => Promise<AnomalyEvent>>() }))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)

const cameraApi = vi.hoisted(() => ({ listCameras: vi.fn() }))
vi.mock('@/api/CameraAPI', () => cameraApi)

const downloadHelper = vi.hoisted(() => ({ saveBlobAsFile: vi.fn() }))
vi.mock('@/helpers/download', () => downloadHelper)

const SNAPSHOT_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/'
const ID = '11111111-1111-4111-8111-111111111111'

const FULL: AnomalyEvent = {
  id: ID,
  cameraId: 'cam-uuid-1',
  anomalyType: 'intrusion',
  confidence: 0.92,
  snapshotJpegB64: SNAPSHOT_B64,
  durationSeconds: 65,
  trackId: 7,
  suspicionLevel: 'HIGH',
  aiReasoning: 'Persona trepando el cerco perimetral',
  timestamp: '2026-10-08T12:00:00.000Z',
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

function renderDetail(path = `/traceability/anomalies/${ID}`) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/traceability/anomalies/:id" element={<AnomalyDetailView />} />
        <Route path="*" element={<p>Otra pantalla</p>} />
      </Routes>
      <LocationProbe />
    </>,
    { route: path },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  cameraApi.listCameras.mockResolvedValue([{ id: 'cam-uuid-1', name: 'Portón principal' }])
})

describe('AnomalyDetailView', () => {
  it('con datos completos muestra evidencia, cámara, tipo, riesgo, análisis y datos técnicos', async () => {
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    renderDetail()

    expect(await screen.findByRole('heading', { level: 1, name: 'Intrusión en zona prohibida' })).toBeInTheDocument()
    expect(detectionsApi.getAnomaly).toHaveBeenCalledWith(ID)

    expect(screen.getByRole('img')).toHaveAttribute('src', `data:image/jpeg;base64,${SNAPSHOT_B64}`)
    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAccessibleName('Captura de la anomalía en Portón principal'),
    )

    expect(screen.getByText('Riesgo Alta')).toBeInTheDocument()
    expect(screen.getByText('Persona trepando el cerco perimetral')).toBeInTheDocument()
    expect(screen.getByText('92%')).toBeInTheDocument()
    expect(screen.getByText('1 min 5 s')).toBeInTheDocument()
    expect(screen.getByText(ID)).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('sin imagen ni evaluación: lo dice y no rompe', async () => {
    detectionsApi.getAnomaly.mockResolvedValue({
      ...FULL,
      snapshotJpegB64: null,
      suspicionLevel: null,
      aiReasoning: null,
      durationSeconds: null,
      trackId: null,
    })
    renderDetail()

    expect(await screen.findByText('No hay imagen disponible')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Sin evaluación disponible')).toBeInTheDocument()
    expect(screen.getAllByText('Sin evaluar').length).toBeGreaterThan(0)
  })

  it('si el listado de cámaras falla, muestra el identificador de la cámara', async () => {
    cameraApi.listCameras.mockRejectedValue(new Error('403'))
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    renderDetail()

    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(screen.getAllByText('cam-uuid-1').length).toBeGreaterThan(0))
  })

  it('mientras carga muestra un estado de carga accesible', () => {
    detectionsApi.getAnomaly.mockReturnValue(new Promise(() => undefined))
    renderDetail()

    expect(screen.getByRole('status', { name: 'Cargando anomalía' })).toBeInTheDocument()
  })

  it('404: estado de error claro, sin reintentar, y vuelve a la pestaña de anomalías', async () => {
    detectionsApi.getAnomaly.mockRejectedValue(new ApiError('La anomalía no existe o no pertenece a tu condominio', 404))
    const user = userEvent.setup()
    renderDetail()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Anomalía no encontrada')
    expect(alert).toHaveTextContent('La anomalía no existe o no pertenece a tu condominio')
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
    expect(detectionsApi.getAnomaly).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /Volver a Trazabilidad/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/traceability?tab=anomalies')
  })

  it('403: indica falta de permiso', async () => {
    detectionsApi.getAnomaly.mockRejectedValue(new ApiError('No tienes permiso para ver la anomalía', 403))
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin acceso a esta anomalía')
  })

  it('error de red: permite reintentar', async () => {
    detectionsApi.getAnomaly.mockRejectedValueOnce(new ApiError('No se pudo cargar la anomalía', null))
    detectionsApi.getAnomaly.mockResolvedValueOnce(FULL)
    const user = userEvent.setup()
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la anomalía')
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Intrusión en zona prohibida' })).toBeInTheDocument()
  })

  it('"Descargar JSON" guarda los metadatos sin la foto', async () => {
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: /Descargar JSON/ }))

    expect(downloadHelper.saveBlobAsFile).toHaveBeenCalledTimes(1)
    const [blob, filename] = downloadHelper.saveBlobAsFile.mock.calls[0] as [Blob, string]
    expect(filename).toBe(`anomaly-${ID}-meta.json`)
    const text = await blob.text()
    expect(text).toContain(ID)
    expect(text).not.toContain(SNAPSHOT_B64)
  })
})
