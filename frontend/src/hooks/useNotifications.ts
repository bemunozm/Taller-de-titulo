import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { webSocketService } from '@/services/WebSocketService'
import { NotificationsAPI } from '@/api/NotificationsAPI'
import type { AppNotification, NotificationPayload } from '@/types/index'
import { useAuth } from './useAuth'

interface UseNotificationsResult {
  notifications: AppNotification[]
  unreadCount: number
  isConnected: boolean
  isLoading: boolean
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearAll: () => void
  requestPermission: () => Promise<NotificationPermission>
  hasPermission: boolean
  refreshNotifications: () => Promise<void>
}

/**
 * Hook para gestionar notificaciones en tiempo real mediante WebSocket
 */
export function useNotifications(): UseNotificationsResult {
  const { data: user } = useAuth()
  const queryClient = useQueryClient()
  const [isConnected, setIsConnected] = useState(false)
  const BrowserNotification = typeof window !== 'undefined' ? window.Notification : undefined
  const [hasPermission, setHasPermission] = useState(
    BrowserNotification?.permission === 'granted'
  )
  const hasConnected = useRef(false)

  /**
   * Query para obtener notificaciones usando TanStack Query
   */
  const { data: notificationsResponse, isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => NotificationsAPI.getNotifications({ limit: 50 }),
    enabled: !!user?.id,
    staleTime: 30000, // 30 segundos
    refetchInterval: 60000, // Refrescar cada minuto
  })

  /**
   * Convertir notificaciones de backend a formato del frontend
   */
  const notifications: AppNotification[] = notificationsResponse?.notifications.map(n => ({
    id: n.id,
    payload: {
      title: n.title,
      message: n.message,
      type: n.type,
      priority: n.priority,
      timestamp: new Date(n.createdAt),
      data: n.data,
      requiresAction: n.requiresAction,
    },
    read: n.read,
    receivedAt: new Date(n.createdAt),
  })) || []

  /**
   * Función para refrescar notificaciones manualmente
   */
  const refreshNotifications = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] })
  }, [queryClient, user?.id])

  /**
   * Mutación para marcar notificaciones como leídas
   */
  const markAsReadMutation = useMutation({
    mutationFn: (notificationIds: string[]) => NotificationsAPI.markAsRead(notificationIds),
    onMutate: async (notificationIds) => {
      // Cancelar queries en progreso
      await queryClient.cancelQueries({ queryKey: ['notifications', user?.id] })

      // Snapshot del valor anterior
      const previousNotifications = queryClient.getQueryData(['notifications', user?.id])

      // Actualizar optimistamente
      queryClient.setQueryData(['notifications', user?.id], (old: any) => {
        if (!old) return old
        return {
          ...old,
          notifications: old.notifications.map((n: any) =>
            notificationIds.includes(n.id) ? { ...n, read: true, readAt: new Date().toISOString() } : n
          ),
          unreadCount: old.unreadCount - notificationIds.length,
        }
      })

      return { previousNotifications }
    },
    onError: (err, _variables, context) => {
      // Revertir en caso de error
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.id], context.previousNotifications)
      }
      console.error('[useNotifications] Error marking as read:', err)
    },
    onSuccess: () => {
      console.log('[useNotifications] ✅ Notificación marcada como leída en el servidor')
    },
    onSettled: () => {
      // Invalidar para refrescar
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] })
    },
  })

  /**
   * Mutación para marcar todas como leídas
   */
  const markAllAsReadMutation = useMutation({
    mutationFn: () => NotificationsAPI.markAllAsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications', user?.id] })
      const previousNotifications = queryClient.getQueryData(['notifications', user?.id])

      queryClient.setQueryData(['notifications', user?.id], (old: any) => {
        if (!old) return old
        return {
          ...old,
          notifications: old.notifications.map((n: any) => ({ ...n, read: true, readAt: new Date().toISOString() })),
          unreadCount: 0,
        }
      })

      return { previousNotifications }
    },
    onError: (err, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.id], context.previousNotifications)
      }
      console.error('[useNotifications] Error marking all as read:', err)
    },
    onSuccess: () => {
      console.log('[useNotifications] ✅ Todas las notificaciones marcadas como leídas en el servidor')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] })
    },
  })

  /**
   * Mutación para eliminar todas las notificaciones
   */
  const clearAllMutation = useMutation({
    mutationFn: () => NotificationsAPI.deleteAll(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications', user?.id] })
      const previousNotifications = queryClient.getQueryData(['notifications', user?.id])

      queryClient.setQueryData(['notifications', user?.id], {
        notifications: [],
        total: 0,
        unreadCount: 0,
      })

      return { previousNotifications }
    },
    onError: (err, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.id], context.previousNotifications)
      }
      console.error('[useNotifications] Error deleting all notifications:', err)
    },
    onSuccess: () => {
      console.log('[useNotifications] ✅ Todas las notificaciones eliminadas del servidor')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] })
    },
  })

  /**
   * Solicita permiso para mostrar notificaciones del navegador
   */
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    const BrowserNotification = typeof window !== 'undefined' ? window.Notification : undefined
    
    if (!BrowserNotification) {
      console.warn('Las notificaciones no están soportadas en este navegador')
      return 'denied'
    }

    if (BrowserNotification.permission === 'granted') {
      setHasPermission(true)
      return 'granted'
    }

    if (BrowserNotification.permission === 'denied') {
      return 'denied'
    }

    try {
      const permission = await BrowserNotification.requestPermission()
      setHasPermission(permission === 'granted')
      return permission
    } catch (error) {
      console.error('Error al solicitar permiso de notificaciones:', error)
      return 'denied'
    }
  }, [])

  /**
   * Muestra una notificación del navegador
   */
  const showBrowserNotification = useCallback((payload: NotificationPayload) => {
    const BrowserNotification = typeof window !== 'undefined' ? window.Notification : undefined
    
    if (!hasPermission || !BrowserNotification) {
      return
    }

    try {
      const notification = new BrowserNotification(payload.title, {
        body: payload.message,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: payload.type,
        requireInteraction: false,
        silent: false,
      })

      // Auto-cerrar después de 5 segundos
      setTimeout(() => notification.close(), 5000)

      // Manejar click en la notificación
      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    } catch (error) {
      console.error('Error al mostrar notificación del navegador:', error)
    }
  }, [hasPermission])

  /**
   * Maneja las notificaciones entrantes del WebSocket
   */
  const handleNotification = useCallback((payload: NotificationPayload) => {
    console.log('[useNotifications] 📬 Nueva notificación recibida por WebSocket:', payload)
    
    // Mostrar notificación del navegador
    showBrowserNotification(payload)
    
    // Invalidar query para refrescar desde el servidor
    queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] })
  }, [showBrowserNotification, queryClient, user?.id])

  /**
   * Conecta al WebSocket cuando el usuario está autenticado
   */
  useEffect(() => {
    if (!user?.id) {
      // Si no hay usuario, desconectar
      if (hasConnected.current) {
        console.log('[useNotifications] No hay usuario, desconectando WebSocket')
        webSocketService.disconnect()
        setIsConnected(false)
        hasConnected.current = false
      }
      return
    }

    // Conectar solo una vez. La auth real es la cookie httpOnly de better-auth
    // (Fase 0 #20) — el gate es `user?.id` de arriba, ya no un token en localStorage.
    if (!hasConnected.current) {
      console.log('[useNotifications] 🔌 Iniciando conexión WebSocket...')
      console.log('[useNotifications] Usuario ID:', user.id)

      webSocketService.connect()
      
      // Esperar un momento para que la conexión se establezca
      // antes de registrar al usuario (ahora registerUser maneja esto automáticamente)
      setTimeout(() => {
        console.log('[useNotifications] 📝 Registrando usuario en WebSocket...')
        webSocketService.registerUser(user.id)
      }, 500)
      
      hasConnected.current = true
    }

    // Verificar conexión periódicamente
    const checkConnection = setInterval(() => {
      const connected = webSocketService.isConnected()
      setIsConnected(connected)
      
      if (!connected && hasConnected.current) {
        console.warn('[useNotifications] ⚠️ WebSocket desconectado')
      }
    }, 1000)

    return () => {
      clearInterval(checkConnection)
    }
  }, [user?.id])

  /**
   * Suscribe al servicio de notificaciones
   */
  useEffect(() => {
    const unsubscribe = webSocketService.subscribe(handleNotification)
    return () => {
      unsubscribe()
    }
  }, [handleNotification])

  /**
   * Marca una notificación como leída
   */
  const markAsRead = useCallback((id: string) => {
    console.log('[useNotifications] 📖 Marcando notificación como leída:', id)
    markAsReadMutation.mutate([id])
  }, [markAsReadMutation])

  /**
   * Marca todas las notificaciones como leídas
   */
  const markAllAsRead = useCallback(() => {
    console.log('[useNotifications] 📖 Marcando todas las notificaciones como leídas')
    markAllAsReadMutation.mutate()
  }, [markAllAsReadMutation])

  /**
   * Limpia todas las notificaciones
   */
  const clearAll = useCallback(() => {
    console.log('[useNotifications] 🗑️ Eliminando todas las notificaciones')
    clearAllMutation.mutate()
  }, [clearAllMutation])

  /**
   * Calcula el número de notificaciones no leídas
   */
  const unreadCount = notifications.filter((n) => !n.read).length

  return {
    notifications,
    unreadCount,
    isConnected,
    isLoading,
    markAsRead,
    markAllAsRead,
    clearAll,
    requestPermission,
    hasPermission,
    refreshNotifications,
  }
}
