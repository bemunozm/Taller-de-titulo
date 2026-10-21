import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User, Vehicle } from '@/types/index'
import { ApiError } from '@/helpers/httpErrors'
import { INACTIVE_VEHICLE_DELETE_FORBIDDEN_MESSAGE } from '@/helpers/vehicleAccess'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VehicleTable } from './VehicleTable'

const vehicleApi = vi.hoisted(() => ({ deleteVehicle: vi.fn<(id: string) => Promise<void>>() }))
vi.mock('@/api/VehicleAPI', () => vehicleApi)

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

const ME: User = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Rosa Residente',
  rut: '11.111.111-1',
  email: 'rosa@example.com',
  phone: '+56911111111',
  confirmed: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  deletedAt: null,
  roles: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Residente' }],
}

const permissionsState = vi.hoisted(() => ({
  permissions: [] as string[],
  isSuperAdmin: false,
  user: undefined as User | undefined,
}))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    user: permissionsState.user,
    isSuperAdmin: permissionsState.isSuperAdmin,
    hasPermission: (permission: string) => permissionsState.permissions.includes(permission),
    isLoading: false,
  }),
}))

function makeVehicle(id: string, plate: string, active: boolean): Vehicle {
  return {
    id,
    plate,
    active,
    owner: { id: ME.id, name: ME.name },
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  }
}

const ACTIVE = makeVehicle('33333333-3333-4333-8333-333333333333', 'ACTV11', true)
const INACTIVE = makeVehicle('44444444-4444-4444-8444-444444444444', 'INAC22', false)

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.permissions = []
  permissionsState.isSuperAdmin = false
  permissionsState.user = ME
  vehicleApi.deleteVehicle.mockResolvedValue(undefined)
})

async function openMenu(user: ReturnType<typeof userEvent.setup>, plate: string) {
  await user.click(screen.getByRole('button', { name: `Acciones del vehículo ${plate}` }))
  // Control positivo: "Editar" siempre está, así que el menú está abierto.
  await screen.findByRole('menuitem', { name: /Editar/ })
}

describe('VehicleTable: eliminar vehículos inactivos', () => {
  it('Residente: no ofrece eliminar un vehículo inactivo propio', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleTable vehicles={[ACTIVE, INACTIVE]} onEdit={vi.fn()} />)

    await openMenu(user, INACTIVE.plate)

    expect(screen.queryByRole('menuitem', { name: /Eliminar/ })).not.toBeInTheDocument()
  })

  it('Residente: sí ofrece eliminar uno activo (control positivo)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleTable vehicles={[ACTIVE, INACTIVE]} onEdit={vi.fn()} />)

    await openMenu(user, ACTIVE.plate)

    expect(screen.getByRole('menuitem', { name: /Eliminar/ })).toBeInTheDocument()
  })

  it('con condominium.view-all sí ofrece eliminar un inactivo', async () => {
    permissionsState.permissions = ['condominium.view-all']
    const user = userEvent.setup()
    renderWithProviders(<VehicleTable vehicles={[INACTIVE]} onEdit={vi.fn()} />)

    await openMenu(user, INACTIVE.plate)

    expect(screen.getByRole('menuitem', { name: /Eliminar/ })).toBeInTheDocument()
  })

  it('si igual llega un 403 se muestra un mensaje claro y se refresca la lista', async () => {
    vehicleApi.deleteVehicle.mockRejectedValueOnce(new ApiError('No puedes eliminar este vehículo', 403))
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(<VehicleTable vehicles={[ACTIVE]} onEdit={vi.fn()} />)
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await openMenu(user, ACTIVE.plate)
    await user.click(screen.getByRole('menuitem', { name: /Eliminar/ }))
    await user.click(await screen.findByRole('button', { name: /Eliminar/ }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('No puedes eliminar este vehículo'))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles'] })
    expect(toastMock.error).not.toHaveBeenCalledWith(INACTIVE_VEHICLE_DELETE_FORBIDDEN_MESSAGE)
  })
})
