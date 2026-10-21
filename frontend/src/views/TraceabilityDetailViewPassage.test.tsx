import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { AccessAttempt, AttemptPassage } from '@/api/DetectionsAPI'
import { renderWithProviders } from '@/test/renderWithProviders'
import TraceabilityDetailView from './TraceabilityDetailView'

const detectionsApi = vi.hoisted(() => ({ listAccessAttempts: vi.fn<() => Promise<AccessAttempt[]>>() }))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)
const cameraApi = vi.hoisted(() => ({ listCameras: vi.fn() }))
vi.mock('@/api/CameraAPI', () => cameraApi)
vi.mock('@/api/PendingDetectionsAPI', () => ({
  respondToPendingDetection: vi.fn(),
  isPendingAlreadyRespondedError: () => false,
}))
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const SNAPSHOT_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/'
const FRAME_URL = 'https://cdn.example.cl/frames/001.jpg'

const PASSAGE: AttemptPassage = {
  id: 'pas-1',
  direction: 'exit',
  directionSource: 'line',
  firstSeenAt: '2026-10-21T12:00:00.000Z',
  lastSeenAt: '2026-10-21T12:00:07.000Z',
  sightingCount: 2,
  sightings: [
    {
      detectionId: 'det-2',
      cameraId: 'cam-b',
      at: '2026-10-21T12:00:07.000Z',
      direction: 'unknown',
      directionSource: 'none',
      full_frame_path: null,
      snapshot_jpeg_b64: SNAPSHOT_B64,
    },
    {
      detectionId: 'det-1',
      cameraId: 'cam-a',
      at: '2026-10-21T12:00:00.000Z',
      direction: 'exit',
      directionSource: 'line',
      full_frame_path: FRAME_URL,
      snapshot_jpeg_b64: null,
    },
  ],
}

function makeAttempt(passage: AttemptPassage | null | undefined, method = 'Patente - Registro'): AccessAttempt {
  return {
    id: 'att-1',
    decision: 'Registrado',
    method,
    createdAt: '2026-10-21T12:00:00.000Z',
    detection: { id: 'det-1', cameraId: 'cam-a', plate: 'ZZZZ99', createdAt: '2026-10-21T12:00:00.000Z' },
    ...(passage === undefined ? {} : { passage }),
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

beforeEach(() => {
  vi.clearAllMocks()
  cameraApi.listCameras.mockResolvedValue([
    { id: 'cam-a', name: 'Portón HD' },
    { id: 'cam-b', name: 'Estacionamiento 03' },
  ])
})

describe('TraceabilityDetailView: pasada', () => {
  it('muestra la dirección de la pasada y su fuente en lenguaje humano', async () => {
    renderDetail(makeAttempt(PASSAGE))

    const direction = await screen.findByText('Dirección')
    const details = direction.nextElementSibling as HTMLElement
    expect(details).toHaveTextContent('Salida')
    expect(details).toHaveTextContent('cruce de línea')
  })

  it.each([
    ['camera', 'cámara de entrada/salida'],
    ['motion', 'movimiento'],
    ['width', 'tamaño de la patente'],
  ] as const)('fuente %s se muestra como "%s"', async (source, label) => {
    renderDetail(makeAttempt({ ...PASSAGE, directionSource: source }))

    const details = (await screen.findByText('Dirección')).nextElementSibling as HTMLElement
    expect(details).toHaveTextContent(label)
  })

  it('lista cada cámara que vio el paso con su nombre, hora, dirección e imagen', async () => {
    renderDetail(makeAttempt(PASSAGE))

    const section = await screen.findByRole('region', { name: 'Cámaras que vieron este paso' })
    const items = within(section).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    // Orden cronológico: primero Portón HD (12:00:00), luego Estacionamiento 03.
    expect(items[0]).toHaveTextContent('Portón HD')
    expect(items[0]).toHaveTextContent('Salida')
    expect(items[0]).toHaveTextContent('cruce de línea')
    expect(within(items[0]!).getByAltText('Frame capturado')).toHaveAttribute('src', FRAME_URL)
    expect(items[1]).toHaveTextContent('Estacionamiento 03')
    expect(within(items[1]!).getByAltText('Recorte de la patente')).toHaveAttribute(
      'src',
      `data:image/jpeg;base64,${SNAPSHOT_B64}`,
    )
  })

  it('un avistamiento sin imagen válida muestra el mensaje vacío, no una ruta', async () => {
    const passage: AttemptPassage = {
      ...PASSAGE,
      sightings: [{ ...PASSAGE.sightings[0]!, full_frame_path: String.raw`C:\lpr\frame.jpg`, snapshot_jpeg_b64: '<x>' }],
    }
    renderDetail(makeAttempt(passage))

    const section = await screen.findByRole('region', { name: 'Cámaras que vieron este paso' })
    expect(within(section).getByText('Sin imagen de esta cámara')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('frame.jpg')
  })

  it('si la cámara no está en la lista muestra su id', async () => {
    cameraApi.listCameras.mockResolvedValue([])
    renderDetail(makeAttempt(PASSAGE))

    const section = await screen.findByRole('region', { name: 'Cámaras que vieron este paso' })
    expect(within(section).getByText('cam-b')).toBeInTheDocument()
  })

  it('pasada con dirección sin determinar no repite "sin determinar"', async () => {
    renderDetail(makeAttempt({ ...PASSAGE, direction: 'unknown', directionSource: 'none' }))

    const details = (await screen.findByText('Dirección')).nextElementSibling as HTMLElement
    expect(details.textContent).toBe('Sin determinar')
  })

  it.each([
    ['sin la clave passage (datos antiguos)', undefined],
    ['passage null', null],
  ])('%s: sin sección de cámaras y la dirección sale del método', async (_name, passage) => {
    renderDetail(makeAttempt(passage, 'Patente - Entrada'))

    const details = (await screen.findByText('Dirección')).nextElementSibling as HTMLElement
    expect(details).toHaveTextContent('Entrada')
    expect(screen.queryByRole('region', { name: 'Cámaras que vieron este paso' })).not.toBeInTheDocument()
  })
})
