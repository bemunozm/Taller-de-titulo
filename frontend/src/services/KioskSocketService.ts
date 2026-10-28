import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'
import type { KioskCredential } from '@/services/kioskCredentialStore'

type EventHandler = (payload: unknown) => void
type SocketFactory = (url: string, options: Partial<ManagerOptions & SocketOptions>) => Socket

/** Backoff exponencial (con jitter) de los reintentos: 2 s → máx. 60 s. */
export const KIOSK_SOCKET_RETRY_BASE_MS = 2_000
export const KIOSK_SOCKET_RETRY_MAX_MS = 60_000
/**
 * El backoff se reinicia recién cuando la conexión lleva este tiempo estable
 * desde `hub:connected`.
 */
export const KIOSK_SOCKET_STABLE_CONNECTION_MS = 30_000
/** El servidor lo emite tras registrar el socket: recién ahí la conexión es válida. */
const HUB_CONNECTED_EVENT = 'hub:connected'

/**
 * Socket del kiosko web en el namespace `/hub`, autenticado como dispositivo
 * (`auth: { hubId, hubSecret }`), igual que `vigilia-hub`.
 *
 * Es una conexión aparte de `webSocketService` (namespace raíz, cookie del
 * residente): ni comparten instancia ni se desconectan entre sí.
 *
 * Solo recibe `visitor:response:<sessionId>` de las sesiones que inició esta
 * credencial. Los errores de socket NUNCA borran la credencial (eso solo lo
 * hace un 401 HTTP): se reintenta con backoff exponencial.
 *
 * El backoff NO se reinicia con `connect` ni al recibir `hub:connected`, sino
 * cuando la conexión sigue viva `KIOSK_SOCKET_STABLE_CONNECTION_MS` después
 * de `hub:connected`. Si dos pestañas usan el mismo hubId (el servidor aplica
 * last-wins y expulsa a la anterior con `io server disconnect`), cada
 * expulsión llega antes de ese plazo: la espera entre reconexiones sigue
 * creciendo (hasta 60 s) en vez de volver a 2 s en cada vuelta.
 */
export class KioskSocketService {
  private readonly createSocket: SocketFactory
  private socket: Socket | null = null
  private credential: KioskCredential | null = null
  private readonly handlers = new Map<string, Set<EventHandler>>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0

  constructor(createSocket: SocketFactory = io) {
    this.createSocket = createSocket
  }

  connect(credential: KioskCredential): void {
    if (
      this.socket &&
      this.credential?.hubId === credential.hubId &&
      this.credential.hubSecret === credential.hubSecret
    ) {
      return
    }

    this.disconnect()

    const baseUrl: unknown = import.meta.env.VITE_WS_URL
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
      // Sin URL configurada no hay socket; el polling de /status cubre la respuesta.
      return
    }

    this.credential = credential
    const socket = this.createSocket(`${baseUrl.trim().replace(/\/+$/, '')}/hub`, {
      auth: { hubId: credential.hubId, hubSecret: credential.hubSecret },
      transports: ['websocket'],
      // Cortes de red: los reintenta socket.io solo, con el mismo rango.
      reconnection: true,
      reconnectionDelay: KIOSK_SOCKET_RETRY_BASE_MS,
      reconnectionDelayMax: KIOSK_SOCKET_RETRY_MAX_MS,
    })

    socket.on(HUB_CONNECTED_EVENT, () => {
      this.clearStableTimer()
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null
        this.retryAttempt = 0
      }, KIOSK_SOCKET_STABLE_CONNECTION_MS)
    })

    // socket.io NO reintenta solo cuando el middleware del servidor rechaza
    // la credencial (`connect_error` con `socket.active === false`) ni cuando
    // el servidor cierra la conexión (`io server disconnect`: otra pestaña
    // con el mismo hubId, secret rotado). Se reintenta a mano con backoff.
    socket.on('connect_error', () => {
      this.clearStableTimer()
      if (!socket.active) {
        this.scheduleRetry()
      }
    })
    socket.on('disconnect', (reason) => {
      this.clearStableTimer()
      if (reason === 'io server disconnect') {
        this.scheduleRetry()
      }
    })

    socket.onAny((event: string, payload: unknown) => {
      this.handlers.get(event)?.forEach((handler) => handler(payload))
    })

    this.socket = socket
    this.listenForWakeUps()
  }

  /**
   * Reintenta ya, sin esperar el backoff. Lo llaman el regreso de la red, de
   * la pestaña o de la caché de páginas (`bfcache`): son los momentos en que
   * esperar hasta 60 s deja al kiosko sin respuesta del residente. Con el
   * socket conectado no hace nada (socket.io detecta los cortes con su ping).
   */
  reconnectNow(): void {
    const socket = this.socket
    if (!socket || socket.connected) {
      return
    }
    this.clearRetry()
    // `disconnect()` cancela el backoff interno de socket.io; sin él, `connect()`
    // no hace nada mientras la reconexión automática sigue "en curso".
    socket.disconnect()
    socket.connect()
  }

  disconnect(): void {
    this.stopListeningForWakeUps()
    this.clearRetry()
    this.clearStableTimer()
    this.retryAttempt = 0
    this.credential = null
    if (this.socket) {
      this.socket.offAny()
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
  }

  /** Id del socket en `/hub` (lo que se manda a `session/start`). */
  getSocketId(): string | undefined {
    return this.socket?.connected ? this.socket.id : undefined
  }

  /**
   * Suscribe un handler a un evento. Vive en el servicio, no en el socket:
   * sobrevive reconexiones y no depende de que el socket ya esté conectado.
   */
  on(event: string, handler: EventHandler): () => void {
    let eventHandlers = this.handlers.get(event)
    if (!eventHandlers) {
      eventHandlers = new Set()
      this.handlers.set(event, eventHandlers)
    }
    eventHandlers.add(handler)

    return () => {
      const current = this.handlers.get(event)
      current?.delete(handler)
      if (current?.size === 0) {
        this.handlers.delete(event)
      }
    }
  }

  private readonly handleOnline = (): void => {
    this.reconnectNow()
  }

  private readonly handlePageShow = (): void => {
    this.reconnectNow()
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.reconnectNow()
    }
  }

  private listenForWakeUps(): void {
    if (typeof window === 'undefined') {
      return
    }
    // Idempotente: `connect` ya pasó por `disconnect`, pero no cuesta nada asegurarlo.
    this.stopListeningForWakeUps()
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('pageshow', this.handlePageShow)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private stopListeningForWakeUps(): void {
    if (typeof window === 'undefined') {
      return
    }
    window.removeEventListener('online', this.handleOnline)
    window.removeEventListener('pageshow', this.handlePageShow)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private scheduleRetry(): void {
    if (!this.socket || this.retryTimer) {
      return
    }
    // 2 s, 4 s, 8 s… hasta 60 s, con ±20 % de jitter para no sincronizar reintentos.
    const exponential = Math.min(KIOSK_SOCKET_RETRY_MAX_MS, KIOSK_SOCKET_RETRY_BASE_MS * 2 ** this.retryAttempt)
    const delay = Math.min(KIOSK_SOCKET_RETRY_MAX_MS, exponential * (0.8 + Math.random() * 0.4))
    this.retryAttempt += 1

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.socket?.connect()
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }
}

export const kioskSocket = new KioskSocketService()
