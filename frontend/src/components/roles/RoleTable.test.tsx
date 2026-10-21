import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Role } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { RoleTable } from './RoleTable'

const roleApi = vi.hoisted(() => ({ deleteRole: vi.fn() }))
vi.mock('@/api/RoleAPI', () => roleApi)

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const permissionsState = vi.hoisted(() => ({ isSuperAdmin: false }))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    hasRole: () => false,
    hasAnyRole: () => false,
    isSuperAdmin: permissionsState.isSuperAdmin,
    userPermissions: [],
    user: undefined,
    isLoading: false,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.isSuperAdmin = false
})

const systemRole: Role = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Administrador',
  description: 'Gestión del condominio',
  isSystem: true,
  permissions: [],
}

const customRole: Role = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Jardinero',
  description: 'Rol personalizado',
  isSystem: false,
  permissions: [],
}

function renderRoles() {
  return renderWithProviders(<RoleTable roles={[systemRole, customRole]} />)
}

describe('RoleTable para el Administrador del condominio', () => {
  it('no muestra acciones: ni la columna ni los menús', () => {
    renderRoles()

    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Acciones del rol/ })).not.toBeInTheDocument()
    // Control positivo: la tabla sí se renderizó con ambos roles.
    expect(screen.getByRole('row', { name: /Jardinero/ })).toBeInTheDocument()
  })

  it('marca los roles de sistema', () => {
    renderRoles()

    expect(within(screen.getByRole('row', { name: /Administrador/ })).getByText('Sistema')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Jardinero/ })).queryByText('Sistema')).not.toBeInTheDocument()
  })
})

describe('RoleTable para el super-admin', () => {
  beforeEach(() => {
    permissionsState.isSuperAdmin = true
  })

  it('un rol de sistema no ofrece editar ni eliminar', () => {
    renderRoles()

    const systemRow = screen.getByRole('row', { name: /Administrador/ })
    expect(within(systemRow).queryByRole('button', { name: /Acciones del rol/ })).not.toBeInTheDocument()
    expect(within(systemRow).getByText('Rol de sistema')).toBeInTheDocument()
  })

  it('un rol personalizado ofrece editar y eliminar', async () => {
    const user = userEvent.setup()
    renderRoles()

    await user.click(screen.getByRole('button', { name: 'Acciones del rol Jardinero' }))

    expect(await screen.findByRole('menuitem', { name: /Editar/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Eliminar/ })).toBeInTheDocument()
  })
})
