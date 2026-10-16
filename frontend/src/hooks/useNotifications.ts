import { useState, useCallback, useSyncExternalStore } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { webSocketService } from '@/services/WebSocketService'
import { NotificationsAPI, type GetNotificationsResponse } from '@/api/NotificationsAPI'
import type { AppNotification } from '@/types/index'
import { useAuth } from './useAuth'

const subscribeToRealtimeStatus = (onChange: () => void) => webSocketService.onStatusChange(onChange)
const getRealtimeStatus = () => webSocketService.getStatus()

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
 * Notificaciones del usuario (lista, leídas, permiso del navegador). El
 * socket y la suscripción a `notification` viven en `RealtimeConnection`
 * (uno por app, ligado al login): este hook no conecta nada.
 */
export function useNotifications(): UseNotificationsResult {
  const { data: user } = useAuth()
  const queryClient = useQueryClient()
  const isConnected = useSyncExternalStore(subscribeToRealtimeStatus, getRealtimeStatus) === 'connected'
  const BrowserNotification = typeof window !== 'undefined' ? window.Notification : undefined
  const [hasPermission, setHasPermission] = useState(
    BrowserNotification?.permission === 'granted'
  )

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
      queryClient.setQueryData<GetNotificationsResponse>(['notifications', user?.id], (old) => {
        if (!old) return old
        return {
          ...old,
          notifications: old.notifications.map((n) =>
            notificationIds.includes(n.id) ? { ...n, read: true, readAt: new Date().toISOString() } : n
          ),
          unreadCount: old.unreadCount - notificationIds.length,
        }
      })

      return { previousNotifications }
    },
    onError: (_error, _variables, context) => {
      // Revertir en caso de error
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.id], context.previousNotifications)
      }
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

      queryClient.setQueryData<GetNotificationsResponse>(['notifications', user?.id], (old) => {
        if (!old) return old
        return {
          ...old,
          notifications: old.notifications.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() })),
          unreadCount: 0,
        }
      })

      return { previousNotifications }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.id], context.previousNotifications)
      }
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
    onError: (_error, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.id], context.previousNotifications)
      }
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
    
    // Navegador sin soporte de notificaciones
    if (!BrowserNotification) {
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
    } catch {
      return 'denied'
    }
  }, [])

  /**
   * Marca una notificación como leída
   */
  const markAsRead = useCallback((id: string) => {
    markAsReadMutation.mutate([id])
  }, [markAsReadMutation])

  /**
   * Marca todas las notificaciones como leídas
   */
  const markAllAsRead = useCallback(() => {
    markAllAsReadMutation.mutate()
  }, [markAllAsReadMutation])

  /**
   * Limpia todas las notificaciones
   */
  const clearAll = useCallback(() => {
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
