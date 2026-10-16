import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CreateVisitFormData, UpdateVisitFormData, User, UserSummary, Visit } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VisitForm } from './VisitForm'

const visitApi = vi.hoisted(() => ({
  createVisit: vi.fn<(formData: CreateVisitFormData) => Promise<Visit>>(),
  updateVisit: vi.fn<(variables: { id: string; formData: UpdateVisitFormData }) => Promise<Visit>>(),
}))
vi.mock('@/api/VisitAPI', () => visitApi)

const userApi = vi.hoisted(() => ({ getUserOptions: vi.fn<() => Promise<UserSummary[]>>() }))
vi.mock('@/api/UserAPI', () => userApi)

// Conserje/Administrador: con users.read el anfitrión sale de GET /users.
const permissionsState = vi.hoisted(() => ({
  permissions: ['users.read'] as string[],
  user: undefined as User | undefined,
}))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) => permissionsState.permissions.includes(permission),
    isSuperAdmin: false,
    user: permissionsState.user,
    isLoading: false,
  }),
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.permissions = ['users.read']
  permissionsState.user = undefined
})

const host: User = {
  id: '55555555-5555-4555-8555-555555555555',
  rut: '11.111.111-1',
  name: 'Rosa Residente',
  email: 'rosa@example.com',
  phone: '+56911111111',
  confirmed: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
}

const visit: Visit = {
  id: '66666666-6666-4666-8666-666666666666',
  type: 'pedestrian',
  status: 'pending',
  visitorName: 'Pedro Visitante',
  usedCount: 0,
  maxUses: null,
  qrCode: 'qr-credencial-secreta-456',
  validFrom: new Date('2026-10-08T12:00:00Z'),
  validUntil: new Date('2026-10-08T20:00:00Z'),
  createdAt: new Date('2026-10-08T11:00:00Z'),
  updatedAt: new Date('2026-10-08T11:00:00Z'),
  host,
}

async function submitEdit(onSuccess = vi.fn()) {
  userApi.getUserOptions.mockResolvedValue([host])
  const user = userEvent.setup()
  const { queryClient } = renderWithProviders(<VisitForm visit={visit} onSuccess={onSuccess} />)
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

  // El anfitrión ya cargó: el formulario es válido tal cual.
  await screen.findByRole('option', { name: /Rosa Residente/ })
  await user.click(screen.getByRole('button', { name: 'Actualizar Visita' }))

  return { invalidateSpy, onSuccess }
}

describe('VisitForm al editar', () => {
  it('tras un 409 muestra el mensaje del backend y refresca la lista de visitas', async () => {
    const backendMessage = 'No se puede editar la visita: está activa'
    visitApi.updateVisit.mockRejectedValueOnce(new Error(backendMessage))

    const { invalidateSpy, onSuccess } = await submitEdit()

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(backendMessage))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visits'] }))
    expect(visitApi.updateVisit.mock.calls[0]?.[0]).toMatchObject({ id: visit.id })
    expect(toastMock.success).not.toHaveBeenCalled()
    // El formulario sigue abierto para que el usuario vea el error.
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('al guardar bien también refresca la lista y cierra (control positivo)', async () => {
    visitApi.updateVisit.mockResolvedValueOnce(visit)

    const { invalidateSpy, onSuccess } = await submitEdit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(toastMock.success).toHaveBeenCalledWith('Visita actualizada exitosamente')
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['visits'] }))
  })
})

describe('VisitForm: anfitriones con la proyección mínima de GET /users', () => {
  it('lista { id, name, family } sin depender del email', async () => {
    userApi.getUserOptions.mockResolvedValue([
      { id: '77777777-7777-4777-8777-777777777777', name: 'Nora Mínima', family: { id: 'f-1', name: 'Familia Pérez' } },
      { id: '88888888-8888-4888-8888-888888888888', name: 'Tomás Sinfamilia', family: null },
    ])

    renderWithProviders(<VisitForm onSuccess={vi.fn()} />)

    expect(await screen.findByRole('option', { name: 'Nora Mínima · Familia Pérez' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tomás Sinfamilia' })).toBeInTheDocument()
  })

  it('sin users.read (Residente) no pide GET /users y ofrece al propio usuario', async () => {
    permissionsState.permissions = []
    permissionsState.user = { ...host, family: null }

    renderWithProviders(<VisitForm onSuccess={vi.fn()} />)

    expect(await screen.findByRole('option', { name: 'Rosa Residente' })).toBeInTheDocument()
    expect(userApi.getUserOptions).not.toHaveBeenCalled()
  })
})
