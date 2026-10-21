import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@/types/index'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import { PersonalInfoSection } from './PersonalInfoSection'

const authApi = vi.hoisted(() => ({
  updateProfile: vi.fn<(formData: { name: string; phone?: string; age?: number }) => Promise<string>>(),
  uploadProfilePicture: vi.fn(),
  deleteProfilePicture: vi.fn(),
}))
vi.mock('@/api/AuthAPI', () => authApi)

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

const ME: User = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ana Residente',
  rut: '11.111.111-1',
  email: 'ana@example.com',
  phone: '+56911111111',
  age: 30,
  confirmed: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  deletedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PersonalInfoSection: 409 de teléfono duplicado (perfil propio)', () => {
  it('marca el teléfono con el mensaje del backend', async () => {
    authApi.updateProfile.mockRejectedValueOnce(new ApiError('El teléfono ya está en uso', 409, 'phone'))
    const user = userEvent.setup()
    renderWithProviders(<PersonalInfoSection user={ME} />)

    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('El teléfono ya está en uso'))
    expect(await screen.findByText('El teléfono ya está en uso')).toBeInTheDocument()
    expect(authApi.updateProfile.mock.calls[0]?.[0]).toMatchObject({ name: ME.name, phone: ME.phone })
  })

  it('otro error solo avisa (sin marcar el teléfono)', async () => {
    authApi.updateProfile.mockRejectedValueOnce(new ApiError('Error al actualizar el perfil', 500))
    const user = userEvent.setup()
    renderWithProviders(<PersonalInfoSection user={ME} />)

    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Error al actualizar el perfil'))
    expect(screen.queryByText('El teléfono ya está en uso')).not.toBeInTheDocument()
  })
})
