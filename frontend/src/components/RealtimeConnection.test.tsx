import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNavigate } from 'react-router-dom'
import type { RealtimeSession } from '@/services/WebSocketService'
import { renderWithProviders } from '@/test/renderWithProviders'
import { RealtimeConnection } from './RealtimeConnection'

interface FakeUser {
  id: string
  name: string
}

const authState = vi.hoisted(() => ({
  user: undefined as FakeUser | undefined,
  isError: false,
}))
const useAuthMock = vi.hoisted(() => vi.fn(() => ({ data: authState.user, isError: authState.isError })))
vi.mock('@/hooks/useAuth', () => ({ useAuth: useAuthMock }))

const authApiMock = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@/api/AuthAPI', () => authApiMock)

const socketState = vi.hoisted(() => ({
  notificationHandlers: new Set<(payload: unknown) => void>(),
}))
const webSocketServiceMock = vi.hoisted(() => ({
  connect: vi.fn<(session: RealtimeSession) => void>(),
  disconnect: vi.fn(),
  onNotification: vi.fn((handler: (payload: unknown) => void) => {
    socketState.notificationHandlers.add(handler)
    return () => {
      socketState.notificationHandlers.delete(handler)
    }
  }),
}))
vi.mock('@/services/WebSocketService', () => ({ webSocketService: webSocketServiceMock }))

const USER = { id: 'user-1', name: 'Ana' }

function GoToKiosk() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/digital-concierge')}>
      Ir al kiosko
    </button>
  )
}

function lastSession(): RealtimeSession {
  const session = webSocketServiceMock.connect.mock.lastCall?.[0]
  if (!session) {
    throw new Error('connect() no fue llamado')
  }
  return session
}

beforeEach(() => {
  vi.clearAllMocks()
  socketState.notificationHandlers.clear()
  authState.user = undefined
  authState.isError = false
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RealtimeConnection: ciclo de vida del socket', () => {
  it('sin usuario no conecta', () => {
    renderWithProviders(<RealtimeConnection />)

    expect(webSocketServiceMock.connect).not.toHaveBeenCalled()
    expect(webSocketServiceMock.disconnect).toHaveBeenCalled()
  })

  it('con un usuario autenticado conecta un socket a su nombre', () => {
    authState.user = USER

    renderWithProviders(<RealtimeConnection />)

    expect(webSocketServiceMock.connect).toHaveBeenCalledTimes(1)
    expect(lastSession().userId).toBe('user-1')
  })

  it('en el kiosko no conecta ni consulta la sesión humana', () => {
    authState.user = USER

    renderWithProviders(<RealtimeConnection />, { route: '/digital-concierge' })

    expect(useAuthMock).not.toHaveBeenCalled()
    expect(webSocketServiceMock.connect).not.toHaveBeenCalled()
    expect(webSocketServiceMock.disconnect).toHaveBeenCalled()
  })

  it('al navegar de la app al kiosko desconecta y deja de escuchar notificaciones', async () => {
    authState.user = USER
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <RealtimeConnection />
        <GoToKiosk />
      </>,
    )
    expect(webSocketServiceMock.connect).toHaveBeenCalledTimes(1)
    webSocketServiceMock.disconnect.mockClear()

    await user.click(screen.getByRole('button', { name: 'Ir al kiosko' }))

    expect(webSocketServiceMock.disconnect).toHaveBeenCalledTimes(1)
    expect(socketState.notificationHandlers.size).toBe(0)
  })

  it('si la sesión cae (error al leer el usuario) desconecta', () => {
    authState.user = USER
    authState.isError = true

    renderWithProviders(<RealtimeConnection />)

    expect(webSocketServiceMock.connect).not.toHaveBeenCalled()
    expect(webSocketServiceMock.disconnect).toHaveBeenCalled()
  })

  it('logout desconecta y un nuevo login vuelve a conectar', () => {
    authState.user = USER
    const { rerender } = renderWithProviders(<RealtimeConnection />)
    webSocketServiceMock.disconnect.mockClear()

    authState.user = undefined
    rerender(<RealtimeConnection />)
    expect(webSocketServiceMock.disconnect).toHaveBeenCalledTimes(1)

    authState.user = { id: 'user-2', name: 'Luis' }
    rerender(<RealtimeConnection />)
    expect(webSocketServiceMock.connect).toHaveBeenCalledTimes(2)
    expect(lastSession().userId).toBe('user-2')
  })

  it('un re-render con el mismo usuario no vuelve a conectar', () => {
    authState.user = USER
    const { rerender } = renderWithProviders(<RealtimeConnection />)

    authState.user = { ...USER }
    rerender(<RealtimeConnection />)

    expect(webSocketServiceMock.connect).toHaveBeenCalledTimes(1)
  })
})

describe('RealtimeConnection: revalidación de la sesión', () => {
  it.each([
    ['la sesión sigue siendo del mismo usuario', () => Promise.resolve(USER), true],
    ['la sesión es de otro usuario', () => Promise.resolve({ id: 'user-2', name: 'Luis' }), false],
    ['la sesión ya no existe (401)', () => Promise.reject(new Error('Unauthorized')), false],
  ] as const)('%s', async (_case, getUser, expected) => {
    authState.user = USER
    authApiMock.getUser.mockImplementation(getUser)
    renderWithProviders(<RealtimeConnection />)

    await expect(lastSession().verifySession()).resolves.toBe(expected)
    expect(authApiMock.getUser).toHaveBeenCalledTimes(1)
  })
})

describe('RealtimeConnection: notificaciones', () => {
  it('es el único suscriptor: refresca la lista del usuario una vez por evento', () => {
    authState.user = USER
    const { queryClient } = renderWithProviders(<RealtimeConnection />)
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    expect(socketState.notificationHandlers.size).toBe(1)
    act(() => {
      socketState.notificationHandlers.forEach((handler) => handler({ title: 'Visita', message: 'Llegó Ana' }))
    })

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications', 'user-1'] })
  })

  it('con el permiso del navegador concedido muestra la notificación del sistema', () => {
    const created: Array<{ title: string; options?: NotificationOptions }> = []
    class FakeNotification {
      static permission: NotificationPermission = 'granted'
      onclick: (() => void) | null = null
      readonly close = vi.fn()
      constructor(title: string, options?: NotificationOptions) {
        created.push({ title, options })
      }
    }
    vi.stubGlobal('Notification', FakeNotification)
    authState.user = USER
    renderWithProviders(<RealtimeConnection />)

    act(() => {
      socketState.notificationHandlers.forEach((handler) =>
        handler({ title: 'Visita en portería', message: 'Llegó Ana', type: 'VISITOR_ARRIVAL' }),
      )
    })

    expect(created).toEqual([
      {
        title: 'Visita en portería',
        options: expect.objectContaining({ body: 'Llegó Ana', tag: 'VISITOR_ARRIVAL' }),
      },
    ])
  })

  it('sin usuario no se suscribe', () => {
    renderWithProviders(<RealtimeConnection />)

    expect(socketState.notificationHandlers.size).toBe(0)
  })
})
