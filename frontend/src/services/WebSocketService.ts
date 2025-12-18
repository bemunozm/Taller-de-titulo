import { io, Socket } from 'socket.io-client'
import type { NotificationPayload } from '@/types/index'

type NotificationCallback = (notification: NotificationPayload) => void
type VisitorApprovalCallback = (data: any) => void

class WebSocketService {
  private socket: Socket | null = null
  private listeners: Set<NotificationCallback> = new Set()
  private visitorApprovalListeners: Set<VisitorApprovalCallback> = new Set()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 3000
  private isIntentionalDisconnect = false
  private onConnectCallback: (() => void) | null = null

  /**
   * Conecta al servidor WebSocket
   * @param token Token JWT del usuario autenticado
   */
  connect(token: string): void {
    if (this.socket?.connected) {
      console.log('[WebSocket] Ya está conectado')
      return
    }

    console.log('[WebSocket] Conectando al servidor...')
    this.isIntentionalDisconnect = false

    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3000'

    this.socket = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
    })

    this.setupListeners()
  }

  /**
   * Conecta al servidor WebSocket sin autenticación (para vistas públicas)
   * Usado en casos como el Conserje Digital donde no hay usuario autenticado
   */
  connectAnonymous(): void {
    if (this.socket?.connected) {
      console.log('[WebSocket] Ya está conectado')
      return
    }

    console.log('[WebSocket] Conectando al servidor (modo anónimo)...')
    this.isIntentionalDisconnect = false

    const wsUrl = import.meta.env.VITE_WS_URL || 'http://localhost:3000'

    this.socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
    })

    this.setupListeners()
  }

  /**
   * Configura los listeners de eventos del socket
   */
  private setupListeners(): void {
    if (!this.socket) return

    this.socket.on('connect', () => {
      console.log('[WebSocket] Conectado exitosamente')
      this.reconnectAttempts = 0
      
      // Ejecutar callbacks de conexión (por ejemplo, registrar usuario)
      if (this.onConnectCallback) {
        this.onConnectCallback()
      }
    })

    this.socket.on('disconnect', (reason) => {
      console.log('[WebSocket] Desconectado:', reason)
      
      if (!this.isIntentionalDisconnect && reason === 'io server disconnect') {
        // El servidor cerró la conexión, intentar reconectar manualmente
        console.log('[WebSocket] Intentando reconectar...')
        this.attemptReconnect()
      }
    })

    this.socket.on('connect_error', (error) => {
      console.error('[WebSocket] Error de conexión:', error.message)
      this.reconnectAttempts++
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('[WebSocket] Máximo de intentos de reconexión alcanzado')
      }
    })

    this.socket.on('notification', (payload: NotificationPayload) => {
      console.log('[WebSocket] 📬 Notificación recibida:', payload)
      this.notifyListeners(payload)
    })

    this.socket.on('visitor:arrival', (data: any) => {
      console.log('[WebSocket] 🚗 Solicitud de aprobación de visitante recibida:', data)
      console.log('[WebSocket] Número de listeners registrados:', this.visitorApprovalListeners.size)
      this.notifyVisitorApprovalListeners(data)
    })

    this.socket.on('error', (error: Error) => {
      console.error('[WebSocket] Error:', error)
    })
  }

  /**
   * Intenta reconectar al servidor
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      setTimeout(() => {
        console.log(`[WebSocket] Reintento ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}`)
        this.socket?.connect()
      }, this.reconnectDelay)
    }
  }

  /**
   * Registra el usuario en el servidor WebSocket
   * Si el socket no está conectado aún, espera a que se conecte
   * @param userId ID del usuario
   */
  registerUser(userId: string): void {
    const doRegister = () => {
      if (!this.socket?.connected) {
        console.warn('[WebSocket] Socket no conectado al intentar registrar usuario')
        return
      }

      console.log('[WebSocket] Registrando usuario:', userId)
      this.socket.emit('register', { userId })
      
      // Listener para confirmar registro
      this.socket.once('register', (response: any) => {
        if (response.success) {
          console.log('[WebSocket] ✅ Usuario registrado exitosamente:', userId)
        } else {
          console.error('[WebSocket] ❌ Error al registrar usuario:', response)
        }
      })
    }

    if (this.socket?.connected) {
      // Si ya está conectado, registrar inmediatamente
      doRegister()
    } else {
      // Si no está conectado, esperar al evento 'connect'
      console.log('[WebSocket] Esperando conexión para registrar usuario...')
      this.onConnectCallback = doRegister
    }
  }

  /**
   * Desconecta del servidor WebSocket
   */
  disconnect(): void {
    if (!this.socket) return

    console.log('[WebSocket] Desconectando...')
    this.isIntentionalDisconnect = true
    this.socket.disconnect()
    this.socket = null
    this.listeners.clear()
    this.visitorApprovalListeners.clear()
    this.reconnectAttempts = 0
  }

  /**
   * Suscribe un callback para recibir notificaciones
   * @param callback Función que se ejecutará cuando llegue una notificación
   */
  subscribe(callback: NotificationCallback): () => void {
    this.listeners.add(callback)
    
    // Retorna función para desuscribirse
    return () => {
      this.listeners.delete(callback)
    }
  }

  /**
   * Notifica a todos los listeners sobre una nueva notificación
   */
  private notifyListeners(payload: NotificationPayload): void {
    this.listeners.forEach((callback) => {
      try {
        callback(payload)
      } catch (error) {
        console.error('[WebSocket] Error en callback de notificación:', error)
      }
    })
  }

  /**
   * Suscribe un callback para recibir solicitudes de aprobación de visitantes
   * @param callback Función que se ejecutará cuando llegue una solicitud
   */
  subscribeToVisitorApprovals(callback: VisitorApprovalCallback): () => void {
    this.visitorApprovalListeners.add(callback)
    
    // Retorna función para desuscribirse
    return () => {
      this.visitorApprovalListeners.delete(callback)
    }
  }

  /**
   * Notifica a todos los listeners sobre una solicitud de aprobación de visitante
   */
  private notifyVisitorApprovalListeners(data: any): void {
    this.visitorApprovalListeners.forEach((callback) => {
      try {
        callback(data)
      } catch (error) {
        console.error('[WebSocket] Error en callback de aprobación de visitante:', error)
      }
    })
  }

  /**
   * Verifica si el socket está conectado
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false
  }

  /**
   * Obtiene el ID del socket actual
   */
  getSocketId(): string | undefined {
    return this.socket?.id
  }

  /**
   * Obtiene el socket para operaciones avanzadas
   * ADVERTENCIA: Usar con precaución
   */
  getSocket(): Socket | null {
    return this.socket
  }

  /**
   * Método de debug para diagnosticar el estado del WebSocket
   */
  debugInfo(): void {
    console.log('[WebSocket Debug] ===============================');
    console.log('[WebSocket Debug] Socket exists:', !!this.socket);
    console.log('[WebSocket Debug] Socket connected:', this.socket?.connected);
    console.log('[WebSocket Debug] Socket ID:', this.socket?.id);
    console.log('[WebSocket Debug] Notification listeners:', this.listeners.size);
    console.log('[WebSocket Debug] Visitor approval listeners:', this.visitorApprovalListeners.size);
    
    if (this.socket) {
      // Listar todos los eventos registrados
      const events = (this.socket as any)._callbacks;
      if (events) {
        console.log('[WebSocket Debug] Registered events:', Object.keys(events));
      }
    }
    
    console.log('[WebSocket Debug] ===============================');
  }
}

// Singleton
export const webSocketService = new WebSocketService()

// Exponer para debugging en consola
if (typeof window !== 'undefined') {
  (window as any).webSocketDebug = () => webSocketService.debugInfo();
}
