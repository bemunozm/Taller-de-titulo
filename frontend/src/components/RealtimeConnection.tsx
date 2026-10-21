import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getUser } from '@/api/AuthAPI'
import { useAuth } from '@/hooks/useAuth'
import { isKioskRoute } from '@/helpers/kiosk'
import { webSocketService } from '@/services/WebSocketService'

/** Revalida por HTTP que la sesión siga siendo de `userId` (actualiza el caché `['user']`). */
async function isSessionOwnedBy(queryClient: QueryClient, userId: string): Promise<boolean> {
  try {
    const current = await queryClient.fetchQuery({ queryKey: ['user'], queryFn: getUser, staleTime: 0 })
    return current.id === userId
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Notificación del navegador para un `notification` del socket, si el
 * usuario la permitió. El payload trae datos del visitante: no va a consola.
 */
function showBrowserNotification(payload: unknown): void {
  const BrowserNotification = typeof window !== 'undefined' ? window.Notification : undefined
  if (!BrowserNotification || BrowserNotification.permission !== 'granted' || !isRecord(payload)) {
    return
  }
  const { title, message, type } = payload
  if (typeof title !== 'string' || title.trim() === '') {
    return
  }

  try {
    const notification = new BrowserNotification(title, {
      body: typeof message === 'string' ? message : undefined,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: typeof type === 'string' ? type : undefined,
    })
    setTimeout(() => notification.close(), 5_000)
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch {
    // Sin notificación del navegador; la notificación igual llega a la app.
  }
}

/**
 * Único dueño del socket de la sesión humana (`webSocketService`): conecta
 * cuando hay un usuario autenticado, desconecta sin sesión (logout, sesión
 * caída) y en el kiosko, y reconecta tras un nuevo login. También es el único
 * suscriptor de `notification`: muestra la notificación del navegador y
 * refresca la lista, una sola vez por evento.
 */
export function RealtimeConnection() {
  const { pathname } = useLocation()
  // El kiosko es un dispositivo público: ahí ni se consulta la sesión humana.
  return isKioskRoute(pathname) ? <RealtimeOff /> : <SessionRealtimeConnection />
}

function RealtimeOff() {
  useEffect(() => {
    webSocketService.disconnect()
  }, [])
  return null
}

function SessionRealtimeConnection() {
  const queryClient = useQueryClient()
  const { data: user, isError } = useAuth()
  const sessionUserId = user && !isError ? user.id : undefined

  useEffect(() => {
    if (sessionUserId === undefined) {
      webSocketService.disconnect()
      return
    }
    webSocketService.connect({
      userId: sessionUserId,
      verifySession: () => isSessionOwnedBy(queryClient, sessionUserId),
    })
  }, [sessionUserId, queryClient])

  useEffect(() => {
    if (sessionUserId === undefined) {
      return
    }
    return webSocketService.onNotification((payload) => {
      showBrowserNotification(payload)
      void queryClient.invalidateQueries({ queryKey: ['notifications', sessionUserId] })
    })
  }, [sessionUserId, queryClient])

  return null
}
