import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'
import { parseAnomalyHighlight, type AnomalyHighlight } from '@/helpers/securityAlerts'

type SocketFactory = (url: string, options: Partial<ManagerOptions & SocketOptions>) => Socket
type NotificationHandler = (payload: unknown) => void
type AnomalyHighlightHandler = (highlight: AnomalyHighlight) => void
type StatusListener = () => void

/**
 * - `idle`: sin sesión (o sin `VITE_WS_URL`), no hay socket.
 * - `connecting`: socket creado, esperando el primer CONNECT.
 * - `connected`.
 * - `reconnecting`: red caída (socket.io reintenta solo) o recuperación tras
 *   un cierre del servidor con la sesión HTTP todavía válida.
 * - `session-ended`: el servidor rechazó o cerró el socket y la sesión ya no
 *   vale (o se agotaron las recuperaciones). Se espera un nuevo login.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'session-ended'

export interface RealtimeSession {
  /** Usuario dueño de la sesión: otro id es otra sesión y otro socket. */
  userId: string
  /**
   * Revalida la sesión por HTTP después de que el servidor rechazara o
   * cerrara el socket. Resuelve `true` solo si sigue siendo la de `userId`.
   */
  verifySession: () => Promise<boolean>
}

export const NOTIFICATION_EVENT = 'notification'
export const ANOMALY_HIGHLIGHT_EVENT = 'security:anomaly_highlight'

/** Red caída: socket.io reintenta solo, 2 s → máx. 30 s, sin tope de intentos. */
export const REALTIME_RECONNECT_DELAY_MS = 2_000
export const REALTIME_RECONNECT_DELAY_MAX_MS = 30_000
/**
 * Rechazo o cierre del servidor con la sesión HTTP aún válida: hasta 3
 * reintentos (2 s, 4 s, 8 s, ±20 %) y luego se espera un nuevo login.
 */
export const REALTIME_RECOVERY_BASE_MS = 2_000
export const REALTIME_RECOVERY_MAX_ATTEMPTS = 3
/** Tiempo conectado tras el que se reinicia el presupuesto de recuperaciones. */
export const REALTIME_STABLE_CONNECTION_MS = 30_000

function resolveSocketUrl(): string | null {
  const raw: unknown = import.meta.env.VITE_WS_URL
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null
  }
  return raw.trim().replace(/\/+$/, '')
}

async function isSessionStillValid(session: RealtimeSession): Promise<boolean> {
  try {
    return await session.verifySession()
  } catch {
    return false
  }
}

/**
 * Socket de la app de residentes y conserjes: namespace raíz, autenticado en
 * el handshake por la cookie de sesión de better-auth (`withCredentials`).
 * Hay un solo socket por pestaña y lo gobierna `RealtimeConnection` según el
 * estado de login: conecta con un usuario autenticado y se cierra en logout.
 * El servidor asigna las salas; el cliente no emite nada (sin `register` ni
 * `join_room`).
 *
 * Ante un rechazo del middleware (`connect_error` con el socket inactivo,
 * p. ej. `unauthorized`) o un `io server disconnect` (sesión expirada,
 * cerrada o revocada), socket.io no reintenta y este servicio tampoco lo hace
 * a ciegas: revalida la sesión por HTTP y solo si sigue vigente reintenta,
 * con backoff y un máximo de `REALTIME_RECOVERY_MAX_ATTEMPTS`. Si no, se
 * queda en `session-ended` hasta el próximo login.
 *
 * El kiosko usa su propio socket en `/hub` (`KioskSocketService`).
 */
export class WebSocketService {
  private readonly createSocket: SocketFactory
  private socket: Socket | null = null
  private session: RealtimeSession | null = null
  private status: RealtimeStatus = 'idle'
  private recoveryAttempts = 0
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private isVerifying = false
  private readonly notificationHandlers = new Set<NotificationHandler>()
  private readonly anomalyHandlers = new Set<AnomalyHighlightHandler>()
  private readonly statusListeners = new Set<StatusListener>()

  constructor(createSocket: SocketFactory = io) {
    this.createSocket = createSocket
  }

  /**
   * Abre el socket de la sesión. Es idempotente para el mismo usuario
   * (también mientras conecta); con otro usuario cierra el anterior.
   */
  connect(session: RealtimeSession): void {
    if (this.socket && this.session?.userId === session.userId) {
      this.session = session
      return
    }

    this.disconnect()

    const url = resolveSocketUrl()
    if (!url) {
      // Sin URL no hay tiempo real; las notificaciones se refrescan por polling.
      return
    }

    this.session = session
    const socket = this.createSocket(url, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: REALTIME_RECONNECT_DELAY_MS,
      reconnectionDelayMax: REALTIME_RECONNECT_DELAY_MAX_MS,
    })
    this.socket = socket
    this.setStatus('connecting')

    socket.on('connect', () => {
      this.setStatus('connected')
      this.clearStableTimer()
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null
        this.recoveryAttempts = 0
      }, REALTIME_STABLE_CONNECTION_MS)
    })

    socket.on('connect_error', () => {
      this.clearStableTimer()
      if (socket.active) {
        // Error de transporte: socket.io reintenta solo con su backoff.
        this.setStatus('reconnecting')
        return
      }
      this.handleServerEnded(socket)
    })

    socket.on('disconnect', (reason) => {
      this.clearStableTimer()
      if (reason === 'io server disconnect') {
        this.handleServerEnded(socket)
        return
      }
      this.setStatus('reconnecting')
    })

    socket.on(NOTIFICATION_EVENT, (payload: unknown) => {
      this.notificationHandlers.forEach((handler) => {
        try {
          handler(payload)
        } catch {
          // Aislado a propósito: el error es del handler, no del socket.
        }
      })
    })

    socket.on(ANOMALY_HIGHLIGHT_EVENT, (payload: unknown) => {
      const highlight = parseAnomalyHighlight(payload)
      if (!highlight) {
        return
      }
      this.anomalyHandlers.forEach((handler) => {
        try {
          handler(highlight)
        } catch {
          // Aislado a propósito: el error es del handler, no del socket.
        }
      })
    })
  }

  /** Cierre intencional (logout, sin sesión, kiosko). Los handlers suscritos se conservan. */
  disconnect(): void {
    this.teardown()
    this.session = null
    this.recoveryAttempts = 0
    this.setStatus('idle')
  }

  /** `notification` del usuario (payload sin validar: lo interpreta el consumidor). */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler)
    return () => {
      this.notificationHandlers.delete(handler)
    }
  }

  /** `security:anomaly_highlight` ya normalizado; los payloads sin id se descartan. */
  onAnomalyHighlight(handler: AnomalyHighlightHandler): () => void {
    this.anomalyHandlers.add(handler)
    return () => {
      this.anomalyHandlers.delete(handler)
    }
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  getStatus(): RealtimeStatus {
    return this.status
  }

  isConnected(): boolean {
    return this.status === 'connected'
  }

  /** Rechazo del middleware o `io server disconnect`: revalidar antes de reintentar. */
  private handleServerEnded(socket: Socket): void {
    const session = this.session
    if (socket !== this.socket || !session || this.isVerifying || this.recoveryTimer) {
      return
    }

    this.isVerifying = true
    this.setStatus('reconnecting')

    void isSessionStillValid(session).then((isValid) => {
      if (socket !== this.socket) {
        // Logout u otro usuario mientras se revalidaba: ese socket ya no existe.
        return
      }
      this.isVerifying = false
      if (!isValid || this.recoveryAttempts >= REALTIME_RECOVERY_MAX_ATTEMPTS) {
        this.endSession()
        return
      }
      this.scheduleRecovery(socket)
    })
  }

  private scheduleRecovery(socket: Socket): void {
    const exponential = REALTIME_RECOVERY_BASE_MS * 2 ** this.recoveryAttempts
    const delay = exponential * (0.8 + Math.random() * 0.4)
    this.recoveryAttempts += 1

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      if (socket === this.socket) {
        socket.connect()
      }
    }, delay)
  }

  /** La sesión terminó para el servidor: sin socket hasta el próximo `connect` (login). */
  private endSession(): void {
    this.teardown()
    this.session = null
    this.recoveryAttempts = 0
    this.setStatus('session-ended')
  }

  private teardown(): void {
    this.clearStableTimer()
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }
    this.isVerifying = false

    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }

  private setStatus(next: RealtimeStatus): void {
    if (this.status === next) {
      return
    }
    this.status = next
    this.statusListeners.forEach((listener) => listener())
  }
}

export const webSocketService = new WebSocketService()
