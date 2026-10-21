import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Vehicle, Visit, VisitStatus } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VisitTable } from './VisitTable'

// Sin red: cada test decide si la mutación resuelve o falla.
const visitApi = vi.hoisted(() => ({
  deleteVisit: vi.fn(async (): Promise<void> => undefined),
  checkInVisit: vi.fn(async (): Promise<void> => undefined),
  checkOutVisit: vi.fn(async (): Promise<void> => undefined),
  cancelVisit: vi.fn(async (): Promise<void> => undefined),
}))
vi.mock('@/api/VisitAPI', () => visitApi)

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

// Todos los permisos concedidos: si una acción no aparece, es por el estado.
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    hasRole: () => true,
    hasAnyRole: () => true,
    userPermissions: [],
    user: undefined,
    isLoading: false,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const HOUR_MS = 60 * 60 * 1000

// Ventana relativa al reloj real: el check-in depende de `new Date()`, así que
// una ventana fija haría que el resultado cambie según la hora en que se corre.
function makeVisit(overrides: Partial<Visit>): Visit {
  const now = Date.now()
  return {
    id: '00000000-0000-4000-8000-000000000000',
    type: 'pedestrian',
    status: 'pending',
    visitorName: 'Visitante',
    usedCount: 0,
    maxUses: null,
    qrCode: null,
    validFrom: new Date(now - HOUR_MS),
    validUntil: new Date(now + HOUR_MS),
    createdAt: new Date(now - 2 * HOUR_MS),
    updatedAt: new Date(now - 2 * HOUR_MS),
    ...overrides,
  }
}

function makeVehicle(plate: string): Vehicle {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    plate,
    brand: 'Toyota',
    model: 'Yaris',
    createdAt: new Date('2026-10-01T11:00:00Z'),
    updatedAt: new Date('2026-10-01T11:00:00Z'),
  }
}

const awaitingVisit = makeVisit({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'awaiting_approval',
  visitorName: 'Ana Solicitud',
})

const pendingVisit = makeVisit({
  id: '22222222-2222-4222-8222-222222222222',
  status: 'pending',
  visitorName: 'Bruno Aprobado',
})

function renderTable(visits: Visit[] = [awaitingVisit, pendingVisit]) {
  return renderWithProviders(<VisitTable visits={visits} onEdit={() => undefined} />)
}

async function openActionsMenu(user: ReturnType<typeof userEvent.setup>, visitorName: string) {
  await user.click(screen.getByRole('button', { name: `Acciones de la visita de ${visitorName}` }))
  // Control positivo: "Eliminar" no depende del estado, así que el menú está abierto.
  await screen.findByRole('menuitem', { name: /Eliminar/ })
}

// Consulta por texto: `*ByRole('row', { name })` recalcula el nombre accesible de toda la tabla.
function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest('tr')
  if (!row) throw new Error(`No hay fila para ${text}`)
  return row
}

describe('VisitTable con una visita en awaiting_approval', () => {
  it('muestra el badge "Esperando aprobación" en su fila', () => {
    renderTable()

    const row = rowOf('Ana Solicitud')
    expect(within(row).getByText('Esperando aprobación')).toBeInTheDocument()

    const pendingRow = rowOf('Bruno Aprobado')
    expect(within(pendingRow).getByText('Pendiente')).toBeInTheDocument()
  })

  it('no ofrece check-in para la solicitud sin aprobar', async () => {
    const user = userEvent.setup()
    renderTable()

    await openActionsMenu(user, 'Ana Solicitud')

    expect(screen.queryByRole('menuitem', { name: /Registrar entrada/ })).not.toBeInTheDocument()
  })

  it('sí ofrece check-in para una visita pendiente (control positivo)', async () => {
    const user = userEvent.setup()
    renderTable()

    await openActionsMenu(user, 'Bruno Aprobado')

    expect(screen.getByRole('menuitem', { name: /Registrar entrada/ })).toBeInTheDocument()
  })

  it('permite filtrar por "Esperando aprobación"', async () => {
    const user = userEvent.setup()
    renderTable()

    const statusFilter = screen.getByRole('combobox', { name: 'Filtrar por estado' })
    expect(
      within(statusFilter).getByRole('option', { name: 'Esperando aprobación' }),
    ).toBeInTheDocument()

    await user.selectOptions(statusFilter, 'awaiting_approval')

    expect(rowOf('Ana Solicitud')).toBeInTheDocument()
    expect(screen.queryByText('Bruno Aprobado')).not.toBeInTheDocument()
  })
})

describe('VisitTable: acciones según el estado (espejo de los 409 del backend)', () => {
  it.each<[VisitStatus, { cancel: boolean; edit: boolean; qr: boolean }]>([
    ['awaiting_approval', { cancel: false, edit: false, qr: false }],
    ['pending', { cancel: true, edit: true, qr: true }],
    ['active', { cancel: false, edit: false, qr: true }],
    ['ready', { cancel: false, edit: true, qr: true }],
    ['completed', { cancel: false, edit: false, qr: false }],
    ['cancelled', { cancel: false, edit: false, qr: false }],
    ['expired', { cancel: false, edit: false, qr: false }],
    ['denied', { cancel: false, edit: false, qr: false }],
  ])('%s: %o', async (status, expected) => {
    const user = userEvent.setup()
    // Con qrCode en todos: si "Ver código QR" no aparece, es por el estado.
    renderTable([makeVisit({ status, visitorName: 'Carla Estado', qrCode: 'a1b2c3d4' })])

    await openActionsMenu(user, 'Carla Estado')

    const cancelItem = screen.queryByRole('menuitem', { name: /Cancelar visita/ })
    const editItem = screen.queryByRole('menuitem', { name: /Editar/ })
    const qrItem = screen.queryByRole('menuitem', { name: /Ver código QR/ })

    expect(cancelItem !== null, '"Cancelar visita" visible').toBe(expected.cancel)
    expect(editItem !== null, '"Editar" visible').toBe(expected.edit)
    expect(qrItem !== null, '"Ver código QR" visible').toBe(expected.qr)
  })

  it('no ofrece el QR de una visita pending sin código', async () => {
    const user = userEvent.setup()
    renderTable([makeVisit({ visitorName: 'Diego SinQR', qrCode: null })])

    await openActionsMenu(user, 'Diego SinQR')

    expect(screen.queryByRole('menuitem', { name: /Ver código QR/ })).not.toBeInTheDocument()
  })
})

describe('VisitTable: check-in según ventana de validez y usos (espejo del 400 del backend)', () => {
  const now = Date.now()

  it.each<[string, Partial<Visit>]>([
    ['pending que aún no empieza', { validFrom: new Date(now + HOUR_MS), validUntil: new Date(now + 2 * HOUR_MS) }],
    ['pending con la ventana vencida', { validFrom: new Date(now - 2 * HOUR_MS), validUntil: new Date(now - HOUR_MS) }],
    ['pending con los usos agotados', { maxUses: 1, usedCount: 1 }],
    ['ready con los usos agotados', { status: 'ready', maxUses: 2, usedCount: 2 }],
    ['ready con la ventana vencida', { status: 'ready', validUntil: new Date(now - HOUR_MS) }],
  ])('oculta "Registrar entrada": %s', async (_case, overrides) => {
    const user = userEvent.setup()
    renderTable([makeVisit({ visitorName: 'Hugo Fuera', ...overrides })])

    await openActionsMenu(user, 'Hugo Fuera')

    expect(screen.queryByRole('menuitem', { name: /Registrar entrada/ })).not.toBeInTheDocument()
  })

  it.each<[string, Partial<Visit>]>([
    ['pending dentro de la ventana y con usos', { maxUses: 1, usedCount: 0 }],
    ['ready dentro de la ventana y con usos', { status: 'ready', maxUses: 2, usedCount: 1 }],
    ['pending con usos ilimitados', { maxUses: null, usedCount: 5 }],
  ])('ofrece "Registrar entrada": %s (control positivo)', async (_case, overrides) => {
    const user = userEvent.setup()
    renderTable([makeVisit({ visitorName: 'Inés Dentro', ...overrides })])

    await openActionsMenu(user, 'Inés Dentro')

    expect(screen.getByRole('menuitem', { name: /Registrar entrada/ })).toBeInTheDocument()
  })

  it('una visita activa fuera de su ventana sigue ofreciendo la salida', async () => {
    const user = userEvent.setup()
    renderTable([
      makeVisit({
        status: 'active',
        visitorName: 'Juan Adentro',
        maxUses: 1,
        usedCount: 1,
        validUntil: new Date(now - HOUR_MS),
      }),
    ])

    await openActionsMenu(user, 'Juan Adentro')

    expect(screen.getByRole('menuitem', { name: /Registrar salida/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Registrar entrada/ })).not.toBeInTheDocument()
  })
})

describe('VisitTable: patente', () => {
  const requestedVisit = makeVisit({
    id: '33333333-3333-4333-8333-333333333333',
    type: 'vehicular',
    status: 'awaiting_approval',
    visitorName: 'Elena Solicitud',
    vehicle: null,
    requestedPlate: 'WXYZ34',
  })

  const vehicleVisit = makeVisit({
    id: '44444444-4444-4444-8444-444444444444',
    type: 'vehicular',
    visitorName: 'Felipe Vehiculo',
    vehicle: makeVehicle('ABCD12'),
  })

  it('muestra requestedPlate cuando la visita aún no tiene vehículo', () => {
    renderTable([requestedVisit, vehicleVisit])

    expect(within(rowOf('Elena Solicitud')).getByText('WXYZ34')).toBeInTheDocument()

    const vehicleRow = rowOf('Felipe Vehiculo')
    expect(within(vehicleRow).getByText('ABCD12')).toBeInTheDocument()
    expect(within(vehicleRow).getByText(/Toyota/)).toBeInTheDocument()
  })

  it('la búsqueda global encuentra la patente solicitada', async () => {
    const user = userEvent.setup()
    renderTable([requestedVisit, vehicleVisit])

    await user.type(screen.getByPlaceholderText('Buscar por nombre, RUT, patente...'), 'WXYZ')

    expect(rowOf('Elena Solicitud')).toBeInTheDocument()
    expect(screen.queryByText('Felipe Vehiculo')).not.toBeInTheDocument()
  })
})

describe('VisitTable: 409 del backend', () => {
  it('al cancelar muestra el mensaje del backend y refresca la lista', async () => {
    const backendMessage = 'No se puede cancelar la visita: está activa'
    visitApi.cancelVisit.mockRejectedValueOnce(new Error(backendMessage))
    const user = userEvent.setup()
    const { queryClient } = renderTable([pendingVisit])
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await openActionsMenu(user, 'Bruno Aprobado')
    await user.click(screen.getByRole('menuitem', { name: /Cancelar visita/ }))
    await user.click(await screen.findByRole('button', { name: 'Cancelar Visita' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(backendMessage))
    expect(toastMock.success).not.toHaveBeenCalled()
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visits'] }))
  })
})
