import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CondominiumOption, CreateUserByAdminPayload, Family, Role, User } from '@/types/index'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import { UserForm } from './UserForm'

const userApi = vi.hoisted(() => ({
  createUser: vi.fn<(payload: CreateUserByAdminPayload) => Promise<User>>(),
  updateUser: vi.fn(),
}))
vi.mock('@/api/UserAPI', () => userApi)

const roleApi = vi.hoisted(() => ({ listRoles: vi.fn<() => Promise<Role[]>>() }))
vi.mock('@/api/RoleAPI', () => roleApi)

const familyApi = vi.hoisted(() => ({ getFamilies: vi.fn<() => Promise<Family[]>>() }))
vi.mock('@/api/FamilyAPI', () => familyApi)

const onboardingApi = vi.hoisted(() => ({ listCondominiums: vi.fn<() => Promise<CondominiumOption[]>>() }))
vi.mock('@/api/OnboardingAPI', () => onboardingApi)

const permissionsState = vi.hoisted(() => ({
  isSuperAdmin: false,
  permissions: [] as string[],
  user: undefined as User | undefined,
}))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    isSuperAdmin: permissionsState.isSuperAdmin,
    userPermissions: permissionsState.permissions,
    user: permissionsState.user,
    isLoading: false,
  }),
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

// El combobox de Headless UI no aporta nada a estos tests: checkboxes simples.
interface RolePickerProps {
  options: Role[]
  selectedIds?: string[]
  onChange: (ids: string[]) => void
}
vi.mock('@/components/ui/MultiSelectCombobox', () => ({
  default: ({ options, selectedIds = [], onChange }: RolePickerProps) => (
    <div>
      {options.map((role) => (
        <label key={role.id}>
          <input
            type="checkbox"
            checked={selectedIds.includes(role.id)}
            onChange={(event) =>
              onChange(
                event.target.checked ? [...selectedIds, role.id] : selectedIds.filter((id) => id !== role.id),
              )
            }
          />
          {role.name}
        </label>
      ))}
    </div>
  ),
}))

const RESIDENT_ROLE: Role = { id: '11111111-1111-4111-8111-111111111111', name: 'Residente' }
const SUPER_ROLE: Role = { id: '22222222-2222-4222-8222-222222222222', name: 'Super Administrador' }
const CONDOMINIUM: CondominiumOption = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Condominio San Lorenzo',
  slug: 'san-lorenzo',
}

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.isSuperAdmin = false
  permissionsState.permissions = []
  permissionsState.user = undefined
  roleApi.listRoles.mockResolvedValue([RESIDENT_ROLE, SUPER_ROLE])
  familyApi.getFamilies.mockResolvedValue([])
  onboardingApi.listCondominiums.mockResolvedValue([CONDOMINIUM])
  userApi.createUser.mockImplementation(async () => {
    throw new Error('no se espera en este test')
  })
})

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>, roleName: string) {
  await user.type(screen.getByPlaceholderText('Juan Carlos Pérez'), 'Nueva Persona')
  await user.click(screen.getByPlaceholderText('12345678-9'))
  await user.paste('11.111.111-1')
  await user.type(screen.getByPlaceholderText('usuario@ejemplo.com'), 'nueva@example.com')
  await user.click(await screen.findByRole('checkbox', { name: roleName }))
}

describe('UserForm: selector de condominio', () => {
  it('no aparece para el Administrador y el payload no lleva organizationId', async () => {
    userApi.createUser.mockResolvedValueOnce({} as User)
    const user = userEvent.setup()
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    await fillRequiredFields(user, 'Residente')

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Crear Usuario' }))

    await waitFor(() => expect(userApi.createUser).toHaveBeenCalledTimes(1))
    const payload = userApi.createUser.mock.calls[0]?.[0]
    expect(payload).toMatchObject({
      name: 'Nueva Persona',
      email: 'nueva@example.com',
      rut: '11.111.111-1',
      roleIds: [RESIDENT_ROLE.id],
    })
    expect(payload).not.toHaveProperty('organizationId')
    expect(onboardingApi.listCondominiums).not.toHaveBeenCalled()
  })

  it('el super-admin debe elegir condominio y se envía como organizationId', async () => {
    permissionsState.isSuperAdmin = true
    userApi.createUser.mockResolvedValueOnce({} as User)
    const user = userEvent.setup()
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    await fillRequiredFields(user, 'Residente')
    const condominiumSelect = screen.getByRole('combobox', { name: 'Condominio *' })
    await screen.findByRole('option', { name: CONDOMINIUM.name })

    // Sin condominio: no se envía y se explica por qué.
    await user.click(screen.getByRole('button', { name: 'Crear Usuario' }))
    expect(await screen.findByText('Selecciona el condominio del usuario')).toBeInTheDocument()
    expect(userApi.createUser).not.toHaveBeenCalled()

    await user.selectOptions(condominiumSelect, CONDOMINIUM.id)
    await user.click(screen.getByRole('button', { name: 'Crear Usuario' }))

    await waitFor(() => expect(userApi.createUser).toHaveBeenCalledTimes(1))
    expect(userApi.createUser.mock.calls[0]?.[0]).toMatchObject({
      roleIds: [RESIDENT_ROLE.id],
      organizationId: CONDOMINIUM.id,
    })
  })

  it('al asignar "Super Administrador" el condominio es opcional', async () => {
    permissionsState.isSuperAdmin = true
    userApi.createUser.mockResolvedValueOnce({} as User)
    const user = userEvent.setup()
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    await fillRequiredFields(user, 'Super Administrador')

    expect(screen.getByRole('combobox', { name: 'Condominio (opcional)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Crear Usuario' }))

    await waitFor(() => expect(userApi.createUser).toHaveBeenCalledTimes(1))
    const payload = userApi.createUser.mock.calls[0]?.[0]
    expect(payload).toMatchObject({ roleIds: [SUPER_ROLE.id] })
    expect(payload).not.toHaveProperty('organizationId')
  })

  it('un 403 del backend se muestra tal cual', async () => {
    userApi.createUser.mockRejectedValueOnce(new Error('No puedes asignar el rol "Super Administrador"'))
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    renderWithProviders(<UserForm onSuccess={onSuccess} />)

    await fillRequiredFields(user, 'Residente')
    await user.click(screen.getByRole('button', { name: 'Crear Usuario' }))

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('No puedes asignar el rol "Super Administrador"'),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('UserForm: familias del condominio elegido (super-admin)', () => {
  const OTHER_CONDOMINIUM_ID = '44444444-4444-4444-8444-444444444444'

  function makeFamily(id: string, name: string, organizationId: string): Family {
    return {
      id,
      name,
      organizationId,
      active: true,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    }
  }

  it('solo ofrece las familias del condominio elegido', async () => {
    permissionsState.isSuperAdmin = true
    familyApi.getFamilies.mockResolvedValue([
      makeFamily('55555555-5555-4555-8555-555555555555', 'Familia San Lorenzo', CONDOMINIUM.id),
      makeFamily('66666666-6666-4666-8666-666666666666', 'Familia Ajena', OTHER_CONDOMINIUM_ID),
    ])
    const user = userEvent.setup()
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    const familySelect = screen.getByRole('combobox', { name: 'Familia (opcional)' })
    // Sin condominio elegido: ninguna familia de la plataforma.
    expect(await screen.findByRole('option', { name: 'Elige primero un condominio' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Familia San Lorenzo' })).not.toBeInTheDocument()

    await screen.findByRole('option', { name: CONDOMINIUM.name })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condominio *' }), CONDOMINIUM.id)

    expect(await screen.findByRole('option', { name: 'Familia San Lorenzo' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Familia Ajena' })).not.toBeInTheDocument()
    expect(familySelect).toHaveValue('')
  })

  it('el Administrador ve las familias que le da el backend, sin filtrar', async () => {
    familyApi.getFamilies.mockResolvedValue([
      makeFamily('55555555-5555-4555-8555-555555555555', 'Familia San Lorenzo', CONDOMINIUM.id),
    ])
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    expect(await screen.findByRole('option', { name: 'Familia San Lorenzo' })).toBeInTheDocument()
  })
})

describe('UserForm: roles asignables por el actor', () => {
  const perm = (name: string) => ({ id: `p-${name}`, name, description: '', module: 'm', action: 'a' })
  const ADMIN_ROLE: Role = {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Administrador',
    permissions: [perm('users.read'), perm('users.update'), perm('visits.read')],
  }
  const DEV_ROLE: Role = {
    id: '88888888-8888-4888-8888-888888888888',
    name: 'Desarrollador',
    permissions: [perm('visits.read'), perm('mediamtx.update')],
  }
  const RESIDENT_WITH_PERMS: Role = { ...RESIDENT_ROLE, permissions: [perm('visits.read')] }

  beforeEach(() => {
    roleApi.listRoles.mockResolvedValue([ADMIN_ROLE, DEV_ROLE, RESIDENT_WITH_PERMS, SUPER_ROLE])
    permissionsState.permissions = ['users.read', 'users.update', 'visits.read']
  })

  it('el Administrador solo ve roles con un subconjunto de sus permisos y nunca "Super Administrador"', async () => {
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    expect(await screen.findByRole('checkbox', { name: 'Residente' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Administrador' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Desarrollador' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Super Administrador' })).not.toBeInTheDocument()
  })

  it('el super-admin ve todos', async () => {
    permissionsState.isSuperAdmin = true
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    expect(await screen.findByRole('checkbox', { name: 'Desarrollador' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Super Administrador' })).toBeInTheDocument()
  })
})

describe('UserForm: edición', () => {
  const TARGET: User = {
    id: '99999999-9999-4999-8999-999999999999',
    name: 'Bruno Residente',
    rut: '11.111.111-1',
    email: 'bruno@example.com',
    phone: '+56911111111',
    confirmed: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    roles: [RESIDENT_ROLE],
  }

  beforeEach(() => {
    userApi.updateUser.mockResolvedValue({ affected: 1 })
  })

  it('sin cambiar roles no los reenvía (evita un 403 por roles no asignables)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UserForm user={TARGET} onSuccess={vi.fn()} />)

    await waitFor(() => expect(screen.getByPlaceholderText('Juan Carlos Pérez')).toHaveValue(TARGET.name))
    await user.click(screen.getByRole('button', { name: 'Actualizar Usuario' }))

    await waitFor(() => expect(userApi.updateUser).toHaveBeenCalledTimes(1))
    const variables = userApi.updateUser.mock.calls[0]?.[0] as { id: string; formData: Record<string, unknown> }
    expect(variables.id).toBe(TARGET.id)
    expect(variables.formData).not.toHaveProperty('roleIds')
    // PATCH /users/:id con emailVerified → 400: la UI nunca lo envía.
    expect(variables.formData).not.toHaveProperty('emailVerified')
  })

  it('sobre sí mismo (sin super-admin) los roles son de solo lectura', async () => {
    permissionsState.user = TARGET
    renderWithProviders(<UserForm user={TARGET} onSuccess={vi.fn()} />)

    expect(await screen.findByText('No puedes cambiar tus propios roles; pídeselo a otro administrador.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Residente' })).not.toBeInTheDocument()
  })
})

describe('UserForm: 409 de duplicados', () => {
  it('marca el campo nombrado por el backend', async () => {
    userApi.createUser.mockRejectedValueOnce(new ApiError('El RUT ya está registrado', 409))
    const user = userEvent.setup()
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    await fillRequiredFields(user, 'Residente')
    await user.click(screen.getByRole('button', { name: 'Crear Usuario' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('El RUT ya está registrado'))
    const rutInput = screen.getByPlaceholderText('12345678-9')
    expect(rutInput).toHaveAttribute('data-invalid')
    expect(screen.getAllByText('El RUT ya está registrado').length).toBeGreaterThan(0)
    expect(screen.getByPlaceholderText('usuario@ejemplo.com')).not.toHaveAttribute('data-invalid')
  })
})

describe('UserForm: 409 con campo estructurado', () => {
  it('usa `field` del backend para marcar el teléfono (aunque el texto no lo nombre)', async () => {
    userApi.createUser.mockRejectedValueOnce(new ApiError('Ese dato ya lo usa otra cuenta', 409, 'phone'))
    const user = userEvent.setup()
    renderWithProviders(<UserForm onSuccess={vi.fn()} />)

    await fillRequiredFields(user, 'Residente')
    await user.click(screen.getByRole('button', { name: 'Crear Usuario' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Ese dato ya lo usa otra cuenta'))
    expect(screen.getByPlaceholderText('Ingrese su número de teléfono')).toHaveAttribute('data-invalid')
    expect(screen.getByPlaceholderText('12345678-9')).not.toHaveAttribute('data-invalid')
  })
})

describe('UserForm: email al editar a otro usuario', () => {
  const OTHER_USER: User = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Olga Otra',
    rut: '11.111.111-1',
    email: 'olga@example.com',
    phone: '+56922222222',
    confirmed: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    roles: [RESIDENT_ROLE],
  }

  beforeEach(() => {
    userApi.updateUser.mockResolvedValue({ affected: 1 })
  })

  async function waitForLoaded() {
    await waitFor(() => expect(screen.getByPlaceholderText('usuario@ejemplo.com')).toHaveValue(OTHER_USER.email))
  }

  it('Administrador: solo lectura y el PATCH no lo lleva', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UserForm user={OTHER_USER} onSuccess={vi.fn()} />)
    await waitForLoaded()

    const email = screen.getByPlaceholderText('usuario@ejemplo.com')
    expect(email).toHaveAttribute('readonly')
    expect(screen.getByText('Solo el Super Administrador puede cambiar el correo desde aquí.')).toBeInTheDocument()

    await user.type(email, 'x')
    await user.click(screen.getByRole('button', { name: 'Actualizar Usuario' }))

    await waitFor(() => expect(userApi.updateUser).toHaveBeenCalledTimes(1))
    const variables = userApi.updateUser.mock.calls[0]?.[0] as { formData: Record<string, unknown> }
    expect(variables.formData).not.toHaveProperty('email')
  })

  it('super-admin: puede cambiarlo y solo viaja si cambió', async () => {
    permissionsState.isSuperAdmin = true
    const user = userEvent.setup()
    renderWithProviders(<UserForm user={OTHER_USER} onSuccess={vi.fn()} />)
    await waitForLoaded()

    const email = screen.getByPlaceholderText('usuario@ejemplo.com')
    expect(email).not.toHaveAttribute('readonly')
    await user.clear(email)
    await user.type(email, 'olga.nueva@example.com')
    await user.click(screen.getByRole('button', { name: 'Actualizar Usuario' }))

    await waitFor(() => expect(userApi.updateUser).toHaveBeenCalledTimes(1))
    const variables = userApi.updateUser.mock.calls[0]?.[0] as { formData: Record<string, unknown> }
    expect(variables.formData).toHaveProperty('email', 'olga.nueva@example.com')
  })

  it('super-admin sin tocarlo: no lo reenvía', async () => {
    permissionsState.isSuperAdmin = true
    const user = userEvent.setup()
    renderWithProviders(<UserForm user={OTHER_USER} onSuccess={vi.fn()} />)
    await waitForLoaded()

    await user.click(screen.getByRole('button', { name: 'Actualizar Usuario' }))

    await waitFor(() => expect(userApi.updateUser).toHaveBeenCalledTimes(1))
    const variables = userApi.updateUser.mock.calls[0]?.[0] as { formData: Record<string, unknown> }
    expect(variables.formData).not.toHaveProperty('email')
  })
})
