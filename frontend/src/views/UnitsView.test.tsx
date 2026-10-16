import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { CondominiumOption, Unit, UnitStats } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import UnitsView from './UnitsView'

const unitApi = vi.hoisted(() => ({
  getUnits: vi.fn<(includeInactive?: boolean) => Promise<Unit[]>>(),
  getUnitStats: vi.fn<() => Promise<UnitStats>>(),
  createBulkUnits: vi.fn(),
  createUnit: vi.fn(),
  updateUnit: vi.fn(),
  deleteUnit: vi.fn(),
}))
vi.mock('@/api/UnitAPI', () => unitApi)

// El selector de condominio (solo super-admin) pide la lista a la API.
const onboardingApi = vi.hoisted(() => ({ listCondominiums: vi.fn(async () => [] as CondominiumOption[]) }))
vi.mock('@/api/OnboardingAPI', () => onboardingApi)

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const permissionsState = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) => permissionsState.permissions.includes(permission),
    hasAnyPermission: (...permissions: string[]) =>
      permissions.some((permission) => permissionsState.permissions.includes(permission)),
    hasAllPermissions: (...permissions: string[]) =>
      permissions.every((permission) => permissionsState.permissions.includes(permission)),
    hasRole: () => false,
    hasAnyRole: () => false,
    isSuperAdmin: false,
    userPermissions: permissionsState.permissions,
    user: undefined,
    isLoading: false,
  }),
}))

const UNIT: Unit = {
  id: '11111111-1111-4111-8111-111111111111',
  identifier: 'A-101',
  block: 'A',
  number: '101',
  floor: 1,
  type: 'departamento',
  active: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  unitApi.getUnits.mockResolvedValue([UNIT])
  unitApi.getUnitStats.mockResolvedValue({ total: 10, occupied: 6, available: 3, inactive: 1 })
})

describe('UnitsView: estadísticas según units.view-stats', () => {
  it('sin el permiso (Conserje/Seguridad/Residente) no pide GET /units/stats', async () => {
    permissionsState.permissions = ['units.read']
    renderWithProviders(<UnitsView />)

    expect(await screen.findByText('A-101')).toBeInTheDocument()
    expect(unitApi.getUnitStats).not.toHaveBeenCalled()
    expect(screen.queryByText('Total de Unidades')).not.toBeInTheDocument()
    // Tampoco ofrece crear unidades sin units.create.
    expect(screen.queryByRole('button', { name: /Nueva Unidad/ })).not.toBeInTheDocument()
  })

  it('con el permiso (Administrador) sí las pide y las muestra', async () => {
    permissionsState.permissions = ['units.read', 'units.view-stats', 'units.create']
    renderWithProviders(<UnitsView />)

    await waitFor(() => expect(unitApi.getUnitStats).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Total de Unidades')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nueva Unidad/ })).toBeInTheDocument()
  })
})
