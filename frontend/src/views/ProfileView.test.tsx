import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/renderWithProviders'
import { PROFILE_PRIVACY_PATH } from '@/helpers/privacyPolicy'
import ProfileView from './ProfileView'

// Sin VITE_API_URL en los tests: la instancia real de axios no se construye.
vi.mock('@/lib/axios', () => ({ default: { get: vi.fn(), post: vi.fn() }, authApi: { post: vi.fn() } }))

const authApi = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@/api/AuthAPI', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/AuthAPI')>()),
  getUser: authApi.getUser,
}))

const ME = {
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
  roles: [],
  family: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  authApi.getUser.mockResolvedValue(ME)
})

describe('ProfileView: "Privacidad y mis datos"', () => {
  it('el enlace de la política (/my-profile#privacidad) abre directo la sección', async () => {
    renderWithProviders(<ProfileView />, { route: PROFILE_PRIVACY_PATH })

    expect(await screen.findByRole('heading', { name: 'Privacidad y mis datos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descargar mis datos' })).toBeInTheDocument()
  })

  it('sin hash abre "Información Personal" y la sección se elige desde el menú', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProfileView />, { route: '/my-profile' })

    await screen.findByText('Ana Residente', { selector: 'h1' })
    expect(screen.queryByRole('heading', { name: 'Privacidad y mis datos' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Privacidad y mis datos/ }))
    expect(screen.getByRole('heading', { name: 'Privacidad y mis datos' })).toBeInTheDocument()
  })
})
