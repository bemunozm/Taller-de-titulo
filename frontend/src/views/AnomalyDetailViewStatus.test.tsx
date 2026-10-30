import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import type { AnomalyEvent } from '@/api/DetectionsAPI'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import AnomalyDetailView from './AnomalyDetailView'

const detectionsApi = vi.hoisted(() => ({
  getAnomaly: vi.fn<(id: string) => Promise<AnomalyEvent>>(),
  updateAnomalyStatus: vi.fn<(id: string, status: string, note?: string) => Promise<AnomalyEvent>>(),
}))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)

const cameraApi = vi.hoisted(() => ({ listCameras: vi.fn() }))
vi.mock('@/api/CameraAPI', () => cameraApi)

const permissionsState = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    userPermissions: permissionsState.permissions,
    hasPermission: (permission: string) => permissionsState.permissions.includes(permission),
  }),
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

const SNAPSHOT_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/'
const ID = '11111111-1111-4111-8111-111111111111'
const RESOLVE = 'anomalies.resolve'

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
  status: 'open',
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/traceability/anomalies/:id" element={<AnomalyDetailView />} />
    </Routes>,
    { route: `/traceability/anomalies/${ID}` },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.permissions = []
  cameraApi.listCameras.mockResolvedValue([{ id: 'cam-uuid-1', name: 'Portón principal' }])
})

describe('AnomalyDetailView: estado de revisión', () => {
  it('muestra el badge de estado; sin anomalies.resolve no hay acciones', async () => {
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    renderDetail()

    expect(await screen.findByText('Estado: Abierta')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Acciones de revisión' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar revisada' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument()
  })

  it('sin anomalies.resolve tampoco se puede reabrir una anomalía resuelta', async () => {
    detectionsApi.getAnomaly.mockResolvedValue({ ...FULL, status: 'reviewed' })
    renderDetail()

    expect(await screen.findByText('Estado: Revisada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument()
  })

  it('con anomalies.resolve y una anomalía abierta ofrece Revisada, Descartar y Falsa alarma', async () => {
    permissionsState.permissions = [RESOLVE]
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    renderDetail()

    const actions = await screen.findByRole('group', { name: 'Acciones de revisión' })
    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Marcar revisada',
      'Descartar',
      'Falsa alarma',
    ])
  })

  it('"Marcar revisada" pide nota opcional, llama al PATCH y actualiza la vista conservando la foto', async () => {
    permissionsState.permissions = [RESOLVE]
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    const withoutPhoto: AnomalyEvent = { ...FULL, snapshotJpegB64: undefined }
    detectionsApi.updateAnomalyStatus.mockResolvedValue({
      ...withoutPhoto,
      status: 'reviewed',
      resolvedById: 'user-9',
      resolvedByName: 'Ana Pérez',
      resolvedAt: '2026-10-09T10:00:00.000Z',
      resolutionNote: 'Era un vecino',
    })
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Marcar revisada' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Marcar como revisada')).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox'), 'Era un vecino')
    await user.click(within(dialog).getByRole('button', { name: 'Marcar revisada' }))

    await waitFor(() => expect(detectionsApi.updateAnomalyStatus).toHaveBeenCalledWith(ID, 'reviewed', 'Era un vecino'))
    expect(toastMock.success).toHaveBeenCalledWith('Anomalía marcada como revisada')
    expect(await screen.findByText('Estado: Revisada')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', `data:image/jpeg;base64,${SNAPSHOT_B64}`)
    // Una vez resuelta solo se puede reabrir, y la resolución queda a la vista.
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument()
    const resolution = screen.getByRole('region', { name: 'Resolución' })
    expect(within(resolution).getByText('Era un vecino')).toBeInTheDocument()
    expect(within(resolution).getByText('Ana Pérez')).toBeInTheDocument()
    expect(within(resolution).queryByText('user-9')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each([
    ['Descartar', 'dismissed', 'Anomalía descartada'],
    ['Falsa alarma', 'false_alarm', 'Anomalía marcada como falsa alarma'],
  ] as const)('"%s" envía el estado %s con nota vacía si no se escribe nada', async (label, status, message) => {
    permissionsState.permissions = [RESOLVE]
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    detectionsApi.updateAnomalyStatus.mockResolvedValue({ ...FULL, status })
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: label }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog)
      .getAllByRole('button')
      .find((button) => button.textContent !== 'Cancelar')
    expect(confirm).toBeDefined()
    await user.click(confirm as HTMLElement)

    await waitFor(() => expect(detectionsApi.updateAnomalyStatus).toHaveBeenCalledWith(ID, status, ''))
    expect(toastMock.success).toHaveBeenCalledWith(message)
  })

  it('"Reabrir" aparece en una anomalía resuelta y vuelve a "open"', async () => {
    permissionsState.permissions = [RESOLVE]
    detectionsApi.getAnomaly.mockResolvedValue({ ...FULL, status: 'dismissed', resolvedById: 'user-9' })
    detectionsApi.updateAnomalyStatus.mockResolvedValue({ ...FULL, status: 'open' })
    const user = userEvent.setup()
    renderDetail()

    expect(await screen.findByText('Estado: Descartada')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reabrir' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Reabrir' }))

    await waitFor(() => expect(detectionsApi.updateAnomalyStatus).toHaveBeenCalledWith(ID, 'open', ''))
    expect(await screen.findByText('Estado: Abierta')).toBeInTheDocument()
  })

  it('muestra "Usuario eliminado" si hay resolvedById sin nombre, y nada si no hay resolvedById', async () => {
    detectionsApi.getAnomaly.mockResolvedValueOnce({ ...FULL, status: 'dismissed', resolvedById: 'user-9', resolvedByName: null })
    const first = renderDetail()
    expect(await screen.findByText('Usuario eliminado')).toBeInTheDocument()
    first.unmount()

    detectionsApi.getAnomaly.mockResolvedValueOnce({ ...FULL, status: 'dismissed', resolvedById: null })
    renderDetail()
    await screen.findByText('Estado: Descartada')
    expect(screen.queryByText('Usuario eliminado')).not.toBeInTheDocument()
  })

  it('el diálogo advierte no escribir datos personales en la nota', async () => {
    permissionsState.permissions = [RESOLVE]
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(await screen.findByText('No escribas nombres, RUT ni otros datos personales; la nota queda registrada.')).toBeInTheDocument()
  })

  it('cancelar el diálogo no llama al PATCH', async () => {
    permissionsState.permissions = [RESOLVE]
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Descartar' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(detectionsApi.updateAnomalyStatus).not.toHaveBeenCalled()
    expect(screen.getByText('Estado: Abierta')).toBeInTheDocument()
  })

  it('si el PATCH falla avisa con un toast, deja el diálogo abierto y no cambia el estado', async () => {
    permissionsState.permissions = [RESOLVE]
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    detectionsApi.updateAnomalyStatus.mockRejectedValue(new ApiError('No tienes permiso para resolver anomalías', 403))
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Falsa alarma' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Marcar falsa alarma/ }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('No tienes permiso para resolver anomalías'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Estado: Abierta')).toBeInTheDocument()
  })

  it('la nota no admite más de 500 caracteres', async () => {
    permissionsState.permissions = [RESOLVE]
    detectionsApi.getAnomaly.mockResolvedValue(FULL)
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(within(await screen.findByRole('dialog')).getByRole('textbox')).toHaveAttribute('maxlength', '500')
  })
})

describe('AnomalyDetailView: análisis de la IA', () => {
  it('con aiStatus "pending" muestra "Analizando con IA…" y no "Sin evaluación disponible"', async () => {
    detectionsApi.getAnomaly.mockResolvedValue({ ...FULL, aiStatus: 'pending', suspicionLevel: null, aiReasoning: null })
    renderDetail()

    expect(await screen.findByText('Analizando con IA…')).toBeInTheDocument()
    expect(screen.queryByText('Sin evaluación disponible')).not.toBeInTheDocument()
    expect(screen.queryByText('Sin evaluar')).not.toBeInTheDocument()
    expect(screen.getAllByText('Analizando…').length).toBeGreaterThan(0)
  })

  it('al invalidar la consulta (security:anomaly_updated) pasa de "Analizando" al veredicto', async () => {
    detectionsApi.getAnomaly.mockResolvedValueOnce({ ...FULL, aiStatus: 'pending', suspicionLevel: null, aiReasoning: null })
    detectionsApi.getAnomaly.mockResolvedValue({ ...FULL, aiStatus: 'done' })
    const { queryClient } = renderDetail()

    await screen.findByText('Analizando con IA…')
    await queryClient.invalidateQueries({ queryKey: ['anomalies', 'detail', ID] })

    expect(await screen.findByText('Persona trepando el cerco perimetral')).toBeInTheDocument()
    expect(screen.queryByText('Analizando con IA…')).not.toBeInTheDocument()
    expect(screen.getByText('Riesgo Alta')).toBeInTheDocument()
  })

  it('con aiStatus "failed" y razonamiento del backend lo muestra tal cual', async () => {
    detectionsApi.getAnomaly.mockResolvedValue({ ...FULL, aiStatus: 'failed', suspicionLevel: null, aiReasoning: 'Análisis interrumpido. Evaluar manualmente.' })
    renderDetail()

    expect(await screen.findByText('Análisis interrumpido. Evaluar manualmente.')).toBeInTheDocument()
    expect(screen.queryByText(/El análisis de la IA falló/)).not.toBeInTheDocument()
  })

  it('avisa cuando la IA lo marcó como posible falso positivo', async () => {
    detectionsApi.getAnomaly.mockResolvedValue({ ...FULL, aiStatus: 'done', aiFalsePositive: true })
    renderDetail()

    expect(await screen.findByRole('note')).toHaveTextContent('podría ser un falso positivo')
    expect(screen.getByText('Persona trepando el cerco perimetral')).toBeInTheDocument()
  })

  it('sin falso positivo no muestra el aviso', async () => {
    detectionsApi.getAnomaly.mockResolvedValue({ ...FULL, aiStatus: 'done', aiFalsePositive: false })
    renderDetail()

    await screen.findByText('Persona trepando el cerco perimetral')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it.each([
    ['failed', 'El análisis de la IA falló. Revisa la evidencia manualmente.'],
    ['skipped', 'La IA no analizó este evento.'],
  ] as const)('con aiStatus "%s" y sin razonamiento lo explica', async (aiStatus, message) => {
    detectionsApi.getAnomaly.mockResolvedValue({ ...FULL, aiStatus, suspicionLevel: null, aiReasoning: null })
    renderDetail()

    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
