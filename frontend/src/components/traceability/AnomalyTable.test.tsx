import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnomalyListFilters, AnomalyListItem, AnomalyListPage } from '@/api/DetectionsAPI'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import { Route, Routes } from 'react-router-dom'
import AnomalyTable, { ANOMALY_PAGE_SIZE } from './AnomalyTable'

const detectionsApi = vi.hoisted(() => ({
  listAnomalies: vi.fn<(filters?: AnomalyListFilters) => Promise<AnomalyListPage>>(),
}))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)

beforeEach(() => {
  vi.clearAllMocks()
})

const ANOMALY: AnomalyListItem = {
  id: '11111111-1111-4111-8111-111111111111',
  cameraId: 'cam-porton',
  anomalyType: 'intrusion',
  confidence: 0.92,
  suspicionLevel: null,
  aiReasoning: null,
  timestamp: '2026-10-08T12:00:00.000Z',
  status: 'open',
}

function page(items: AnomalyListItem[], total = items.length): AnomalyListPage {
  return { items, total }
}

describe('AnomalyTable (GET /anomalies con la sesión)', () => {
  it('lista las anomalías y tolera columnas nulas', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY]))
    renderWithProviders(<AnomalyTable />)

    expect(await screen.findByText('cam-porton')).toBeInTheDocument()
    expect(screen.getByText('Sin evaluar')).toBeInTheDocument()
    expect(screen.getByText('Sin evaluación disponible')).toBeInTheDocument()
  })

  it('vacío: lo dice explícitamente', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([]))
    renderWithProviders(<AnomalyTable />)

    expect(await screen.findByText('No hay anomalías registradas')).toBeInTheDocument()
  })

  it('error: lo muestra (no como "sin anomalías") y permite reintentar', async () => {
    detectionsApi.listAnomalies.mockRejectedValueOnce(
      new ApiError('Tu sesión no permite ver las anomalías', 401),
    )
    detectionsApi.listAnomalies.mockResolvedValueOnce(page([ANOMALY]))
    const user = userEvent.setup()
    renderWithProviders(<AnomalyTable />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión no permite ver las anomalías')
    expect(screen.queryByText('No hay anomalías registradas')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Reintentar/ }))

    await waitFor(() => expect(screen.getByText('cam-porton')).toBeInTheDocument())
  })

  it('pide la primera página con el tope de filas y sin filtros', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY]))
    renderWithProviders(<AnomalyTable />)

    await screen.findByText('cam-porton')
    expect(detectionsApi.listAnomalies).toHaveBeenCalledWith({
      status: undefined,
      type: undefined,
      limit: ANOMALY_PAGE_SIZE,
      offset: 0,
    })
  })
})

describe('AnomalyTable: estado de revisión e IA', () => {
  it('cada fila muestra el badge de su estado', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(
      page([
        ANOMALY,
        { ...ANOMALY, id: 'b', status: 'reviewed' },
        { ...ANOMALY, id: 'c', status: 'dismissed' },
        { ...ANOMALY, id: 'd', status: 'false_alarm' },
      ]),
    )
    renderWithProviders(<AnomalyTable />)

    await screen.findAllByText('cam-porton')
    const body = screen.getAllByRole('rowgroup')[1]
    expect(within(body).getByText('Abierta')).toBeInTheDocument()
    expect(within(body).getByText('Revisada')).toBeInTheDocument()
    expect(within(body).getByText('Descartada')).toBeInTheDocument()
    expect(within(body).getByText('Falsa alarma')).toBeInTheDocument()
  })

  it('con aiStatus "pending" indica "Analizando…" en vez de "Sin evaluar"', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([{ ...ANOMALY, aiStatus: 'pending' }]))
    renderWithProviders(<AnomalyTable />)

    await screen.findByText('cam-porton')
    expect(screen.getAllByText('Analizando…').length).toBeGreaterThan(0)
    expect(screen.queryByText('Sin evaluar')).not.toBeInTheDocument()
    expect(screen.queryByText('Sin evaluación disponible')).not.toBeInTheDocument()
  })

  it('marca el posible falso positivo de la IA y el análisis fallido', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(
      page([
        { ...ANOMALY, aiStatus: 'done', aiFalsePositive: true, aiReasoning: 'Parece una sombra' },
        { ...ANOMALY, id: 'f', aiStatus: 'failed' },
      ]),
    )
    renderWithProviders(<AnomalyTable />)

    await screen.findAllByText('cam-porton')
    expect(screen.getByText('Posible falso positivo')).toBeInTheDocument()
    expect(screen.getByText('Parece una sombra')).toBeInTheDocument()
    expect(screen.getByText('El análisis de la IA falló')).toBeInTheDocument()
  })
})

describe('AnomalyTable: filtros y paginación en el servidor', () => {
  it('filtrar por estado vuelve a pedir al servidor desde la primera página', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY]))
    const user = userEvent.setup()
    renderWithProviders(<AnomalyTable />)
    await screen.findByText('cam-porton')

    await user.selectOptions(screen.getByLabelText('Filtrar por estado'), 'false_alarm')

    await waitFor(() =>
      expect(detectionsApi.listAnomalies).toHaveBeenLastCalledWith({
        status: 'false_alarm',
        type: undefined,
        limit: ANOMALY_PAGE_SIZE,
        offset: 0,
      }),
    )
  })

  it('filtrar por tipo envía el tipo', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY]))
    const user = userEvent.setup()
    renderWithProviders(<AnomalyTable />)
    await screen.findByText('cam-porton')

    await user.selectOptions(screen.getByLabelText('Filtrar por tipo'), 'loitering')

    await waitFor(() =>
      expect(detectionsApi.listAnomalies).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'loitering', offset: 0 })),
    )
  })

  it('con un filtro sin resultados dice que ninguna coincide (no "no hay anomalías")', async () => {
    detectionsApi.listAnomalies.mockResolvedValueOnce(page([ANOMALY]))
    detectionsApi.listAnomalies.mockResolvedValue(page([]))
    const user = userEvent.setup()
    renderWithProviders(<AnomalyTable />)
    await screen.findByText('cam-porton')

    await user.selectOptions(screen.getByLabelText('Filtrar por estado'), 'dismissed')

    expect(await screen.findByText('Ninguna anomalía coincide con los filtros')).toBeInTheDocument()
  })

  it('"Limpiar filtros" quita los filtros y vuelve a la primera página', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY]))
    const user = userEvent.setup()
    renderWithProviders(<AnomalyTable />)
    await screen.findByText('cam-porton')

    await user.selectOptions(screen.getByLabelText('Filtrar por estado'), 'reviewed')
    await user.click(await screen.findByRole('button', { name: 'Limpiar filtros' }))

    await waitFor(() =>
      expect(detectionsApi.listAnomalies).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: undefined, type: undefined, offset: 0 }),
      ),
    )
    expect(screen.getByLabelText('Filtrar por estado')).toHaveValue('')
  })

  it('pagina con el total del servidor: Siguiente pide el offset de la página 2', async () => {
    const total = ANOMALY_PAGE_SIZE + 5
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY], total))
    const user = userEvent.setup()
    renderWithProviders(<AnomalyTable />)
    await screen.findByText('cam-porton')

    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()
    expect(screen.getByText(`1–1 de ${total}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Siguiente/ }))

    await waitFor(() =>
      expect(detectionsApi.listAnomalies).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: ANOMALY_PAGE_SIZE, limit: ANOMALY_PAGE_SIZE }),
      ),
    )
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled()
  })

  it('cambiar un filtro estando en la página 2 vuelve a la 1', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY], ANOMALY_PAGE_SIZE * 3))
    const user = userEvent.setup()
    renderWithProviders(<AnomalyTable />)
    await screen.findByText('cam-porton')

    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('Página 2 de 3')
    await user.selectOptions(screen.getByLabelText('Filtrar por estado'), 'open')

    await waitFor(() =>
      expect(detectionsApi.listAnomalies).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'open', offset: 0 }),
      ),
    )
    expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument()
  })

  it('sin anomalías no muestra la paginación', async () => {
    detectionsApi.listAnomalies.mockResolvedValue(page([]))
    renderWithProviders(<AnomalyTable />)

    await screen.findByText('No hay anomalías registradas')
    expect(screen.queryByRole('navigation', { name: 'Paginación de anomalías' })).not.toBeInTheDocument()
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
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY]))
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
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY]))
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
    detectionsApi.listAnomalies.mockResolvedValue(page([ANOMALY]))
    const user = userEvent.setup()
    renderWithRoutes()

    await screen.findByText('cam-porton')
    await user.click(screen.getAllByRole('link', { name: /Ver detalle de la anomalía/ })[2])

    expect(await screen.findByText('Pantalla de detalle')).toBeInTheDocument()
  })
})
