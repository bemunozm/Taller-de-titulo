import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createTestQueryClient } from '@/test/renderWithProviders'
import { useAuth } from './useAuth'

const authApiMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOutUser: vi.fn(),
}))
vi.mock('@/api/AuthAPI', () => authApiMock)

const webSocketServiceMock = vi.hoisted(() => ({ disconnect: vi.fn() }))
vi.mock('@/services/WebSocketService', () => ({ webSocketService: webSocketServiceMock }))

beforeEach(() => {
  vi.clearAllMocks()
  authApiMock.getUser.mockResolvedValue({ id: 'user-1', name: 'Ana' })
  authApiMock.signOutUser.mockResolvedValue(undefined)
})

describe('useAuth: logout', () => {
  it('cierra el socket de la sesión antes de cerrar la sesión en el servidor', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.logout()
    })

    expect(webSocketServiceMock.disconnect).toHaveBeenCalledTimes(1)
    expect(authApiMock.signOutUser).toHaveBeenCalledTimes(1)
    expect(webSocketServiceMock.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      authApiMock.signOutUser.mock.invocationCallOrder[0],
    )
  })
})
