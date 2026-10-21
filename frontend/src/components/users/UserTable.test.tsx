import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Role, User } from '@/types/index'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import { UserTable } from './UserTable'

const userApi = vi.hoisted(() => ({
  DELETE_USER_CONFLICT_MESSAGE: 'El usuario tiene datos asociados y no se puede eliminar.',
  deleteUser: vi.fn<(id: string) => Promise<{ affected: number }>>(),
  disableUser: vi.fn<(id: string) => Promise<{ message: string; affected: number }>>(),
  enableUser: vi.fn<(id: string) => Promise<{ message: string; affected: number }>>(),
}))
vi.mock('@/api/UserAPI', () => userApi)

const ANONYMIZED_ENABLE_MESSAGE =
  'Esta cuenta ya fue anonimizada (Ley 21.719): sus datos se borraron y no se puede volver a habilitar.'

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

const SELF_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

function makeUser(id: string, name: string): User {
  return {
    id,
    name,
    rut: '11.111.111-1',
    email: `${id.slice(0, 4)}@example.com`,
    phone: '+56911111111',
    confirmed: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
  }
}

const SELF = makeUser(SELF_ID, 'Ana Administradora')
const OTHER = makeUser(OTHER_ID, 'Bruno Residente')

const authState = vi.hoisted(() => ({
  user: undefined as User | undefined,
  isSuperAdmin: false,
  permissions: ['users.read', 'users.update', 'users.delete', 'visits.read'] as string[],
}))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    user: authState.user,
    isSuperAdmin: authState.isSuperAdmin,
    userPermissions: authState.permissions,
    hasPermission: (permission: string) => authState.permissions.includes(permission),
    isLoading: false,
  }),
}))

// Catálogo de GET /roles: completa los permisos que GET /users no trae.
const perm = (name: string) => ({ id: `p-${name}`, name, description: '', module: 'm', action: 'a' })
const RESIDENT_ROLE: Role = { id: '33333333-3333-4333-8333-333333333333', name: 'Residente', permissions: [perm('visits.read')] }
const DEV_ROLE: Role = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Desarrollador',
  permissions: [perm('visits.read'), perm('mediamtx.update')],
}
const roleApi = vi.hoisted(() => ({ listRoles: vi.fn<() => Promise<Role[]>>() }))
vi.mock('@/api/RoleAPI', () => roleApi)

beforeEach(() => {
  vi.clearAllMocks()
  authState.user = SELF
  authState.isSuperAdmin = false
  authState.permissions = ['users.read', 'users.update', 'users.delete', 'visits.read']
  roleApi.listRoles.mockResolvedValue([RESIDENT_ROLE, DEV_ROLE])
  userApi.disableUser.mockResolvedValue({ message: 'ok', affected: 1 })
})

function renderTable() {
  return renderWithProviders(<UserTable users={[SELF, OTHER]} onEdit={vi.fn()} />)
}

describe('UserTable: acciones sobre uno mismo', () => {
  it('sobre el propio usuario solo se ofrece editar', async () => {
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: `Acciones de ${SELF.name}` }))

    expect(await screen.findByRole('menuitem', { name: /Editar/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Deshabilitar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Eliminar/ })).not.toBeInTheDocument()
  })

  it('sobre otro usuario sí ofrece deshabilitar y eliminar (control positivo)', async () => {
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: `Acciones de ${OTHER.name}` }))

    expect(await screen.findByRole('menuitem', { name: /Deshabilitar/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Eliminar/ })).toBeInTheDocument()
  })
})

describe('UserTable: 409 al eliminar', () => {
  it('sugiere deshabilitar y lo hace al confirmar', async () => {
    const conflict = 'El usuario tiene visitas registradas; deshabilítalo en vez de eliminarlo'
    userApi.deleteUser.mockRejectedValueOnce(new ApiError(conflict, 409))
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: `Acciones de ${OTHER.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: /Eliminar/ }))
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('No se puede eliminar: deshabilítalo')).toBeInTheDocument()
    expect(screen.getByText(conflict, { exact: false })).toBeInTheDocument()
    expect(toastMock.error).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Deshabilitar' }))

    // useMutation pasa un segundo argumento (contexto): se mira solo el id.
    await waitFor(() => expect(userApi.disableUser).toHaveBeenCalledTimes(1))
    expect(userApi.disableUser.mock.calls[0]?.[0]).toBe(OTHER_ID)
    expect(userApi.deleteUser.mock.calls[0]?.[0]).toBe(OTHER_ID)
  })

  it('otro error al eliminar se muestra como toast', async () => {
    userApi.deleteUser.mockRejectedValueOnce(new ApiError('No puedes eliminar este usuario', 403))
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: `Acciones de ${OTHER.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: /Eliminar/ }))
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('No puedes eliminar este usuario'))
    expect(screen.queryByText('No se puede eliminar: deshabilítalo')).not.toBeInTheDocument()
  })
})

describe('UserTable: usuarios con permisos que el actor no tiene', () => {
  // GET /users trae los roles sin permisos (solo id y nombre).
  const DEV_USER: User = { ...makeUser('55555555-5555-4555-8555-555555555555', 'Diego Desarrollador'), roles: [{ id: DEV_ROLE.id, name: DEV_ROLE.name }] }
  const RESIDENT_USER: User = { ...makeUser('66666666-6666-4666-8666-666666666666', 'Rita Residente'), roles: [{ id: RESIDENT_ROLE.id, name: RESIDENT_ROLE.name }] }
  const SUPER_USER: User = { ...makeUser('77777777-7777-4777-8777-777777777777', 'Sara Super'), roles: [{ id: 'r-super', name: 'Super Administrador' }] }

  it('oculta editar/deshabilitar/eliminar sobre quien tiene permisos de más', async () => {
    renderWithProviders(<UserTable users={[SELF, DEV_USER, RESIDENT_USER, SUPER_USER]} onEdit={vi.fn()} />)

    // El catálogo de roles llega y completa los permisos del Desarrollador.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: `Acciones de ${DEV_USER.name}` })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: `Acciones de ${SUPER_USER.name}` })).not.toBeInTheDocument()
    expect(screen.getAllByText('Sin acciones')).toHaveLength(2)
    // Control positivo: sobre un Residente sí hay acciones.
    expect(screen.getByRole('button', { name: `Acciones de ${RESIDENT_USER.name}` })).toBeInTheDocument()
  })

  it('el super-admin conserva las acciones sobre todos', async () => {
    authState.isSuperAdmin = true
    renderWithProviders(<UserTable users={[SELF, DEV_USER, SUPER_USER]} onEdit={vi.fn()} />)

    expect(await screen.findByRole('button', { name: `Acciones de ${DEV_USER.name}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Acciones de ${SUPER_USER.name}` })).toBeInTheDocument()
    expect(screen.queryByText('Sin acciones')).not.toBeInTheDocument()
  })

  it('si igual llega un 403, se muestra el mensaje del backend', async () => {
    userApi.disableUser.mockRejectedValueOnce(
      new ApiError('No puedes modificar a este usuario: tiene permisos que tú no tienes', 403),
    )
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: `Acciones de ${OTHER.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: /Deshabilitar/ }))
    await user.click(await screen.findByRole('button', { name: 'Deshabilitar' }))

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('No puedes modificar a este usuario: tiene permisos que tú no tienes'),
    )
  })
})

describe('UserTable: deshabilitar = anonimización a los 30 días (Ley 21.719)', () => {
  const DISABLED: User = {
    ...makeUser('88888888-8888-4888-8888-888888888888', 'Carla Deshabilitada'),
    deletedAt: new Date(2026, 9, 1, 12, 0),
  }
  const ANONYMIZED: User = {
    ...makeUser('99999999-9999-4999-8999-999999999999', 'Usuario eliminado'),
    email: 'deleted+99999999-9999-4999-8999-999999999999@vigilia.invalid',
    rut: null,
    phone: null,
    deletedAt: new Date(2026, 8, 1, 12, 0),
    anonymizedAt: '2026-10-01T03:00:00.000Z',
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('el diálogo avisa la anonimización irreversible con su fecha aproximada', async () => {
    // Solo el reloj: userEvent sigue con timers reales.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 9, 12, 0))
    const user = userEvent.setup()
    renderTable()

    await user.click(screen.getByRole('button', { name: `Acciones de ${OTHER.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: /Deshabilitar/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('en 30 días (aprox. el 8 de noviembre de 2026)')
    expect(dialog).toHaveTextContent('anonimiza de forma irreversible')
    expect(dialog).toHaveTextContent('ya no se podrá volver a habilitar')
    expect(dialog).toHaveTextContent('sus vehículos se borran')
    expect(dialog).toHaveTextContent('sus visitas quedan sin sus datos personales')
    expect(dialog).not.toHaveTextContent(/se conservar[aá]n|seguirán asociados/)
  })

  it('una cuenta deshabilitada muestra cuándo se anonimiza', () => {
    renderWithProviders(<UserTable users={[SELF, DISABLED]} onEdit={vi.fn()} />)

    expect(screen.getByText('Se anonimiza el 31 de octubre de 2026')).toBeInTheDocument()
  })

  it('habilitar una cuenta ya anonimizada (409) muestra un mensaje claro y refresca la lista', async () => {
    userApi.enableUser.mockRejectedValueOnce(new ApiError(ANONYMIZED_ENABLE_MESSAGE, 409))
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(<UserTable users={[SELF, DISABLED]} onEdit={vi.fn()} />)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: `Acciones de ${DISABLED.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: /Habilitar/ }))
    await user.click(await screen.findByRole('button', { name: 'Habilitar' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(ANONYMIZED_ENABLE_MESSAGE))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] })
  })

  it('una cuenta anonimizada se ve neutra: sin email marcador, RUT ni teléfono, y sin editar/habilitar', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UserTable users={[SELF, ANONYMIZED]} onEdit={vi.fn()} />)

    const row = screen.getByText('Usuario eliminado').closest('tr') as HTMLElement
    expect(within(row).getByText('Anonimizada')).toBeInTheDocument()
    expect(row).not.toHaveTextContent('vigilia.invalid')
    expect(row).not.toHaveTextContent('null')
    expect(within(row).getAllByText('—')).toHaveLength(2)

    await user.click(within(row).getByRole('button', { name: `Acciones de ${ANONYMIZED.name}` }))
    expect(await screen.findByRole('menuitem', { name: /Eliminar/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Habilitar/ })).not.toBeInTheDocument()
  })
})
