import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Socket } from 'socket.io-client'
import type { AnomalyHighlight } from '@/helpers/securityAlerts'
import {
  ANOMALY_HIGHLIGHT_EVENT,
  NOTIFICATION_EVENT,
  REALTIME_RECOVERY_MAX_ATTEMPTS,
  REALTIME_STABLE_CONNECTION_MS,
  WebSocketService,
  type RealtimeSession,
} from './WebSocketService'

type Listener = (...args: unknown[]) => void

/** Doble mínimo de `Socket` con lo que usa el servicio. */
class FakeSocket {
  active = true
  readonly listeners = new Map<string, Listener[]>()
  readonly connect = vi.fn()
  readonly disconnect = vi.fn()
  readonly emit = vi.fn()
  readonly removeAllListeners = vi.fn(() => {
    this.listeners.clear()
  })

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  fire(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((listener) => listener(...args))
  }

  /** Rechazo del middleware: `connect_error` y socket.io ya no reintenta solo. */
  rejectHandshake(message = 'unauthorized'): void {
    this.active = false
    this.fire('connect_error', new Error(message))
  }
}

function setup() {
  const sockets: FakeSocket[] = []
  const factory = vi.fn<(url: string, options: unknown) => Socket>(() => {
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket as unknown as Socket
  })
  const service = new WebSocketService(factory)
  return { service, factory, sockets }
}

function session(userId = 'user-1', isValid = true) {
  const verifySession = vi.fn<RealtimeSession['verifySession']>(async () => isValid)
  return { userId, verifySession }
}

/** Deja correr los microtasks pendientes (la revalidación es async). */
async function flushVerification(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_WS_URL', 'http://ws.test/')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('WebSocketService: conexión ligada a la sesión', () => {
  it('conecta al namespace raíz con la cookie de sesión (withCredentials) y sin token', () => {
    const { service, factory } = setup()

    service.connect(session())

    expect(factory).toHaveBeenCalledTimes(1)
    const [url, options] = factory.mock.calls[0]
    expect(url).toBe('http://ws.test')
    expect(options).toEqual(expect.objectContaining({ withCredentials: true }))
    expect(options).not.toHaveProperty('auth')
    expect(service.getStatus()).toBe('connecting')
  })

  it('es idempotente para el mismo usuario, también mientras conecta', () => {
    const { service, factory, sockets } = setup()

    service.connect(session())
    service.connect(session())
    sockets[0].fire('connect')
    service.connect(session())

    expect(factory).toHaveBeenCalledTimes(1)
    expect(service.isConnected()).toBe(true)
  })

  it('no emite nada al servidor: sin register, join_room ni leave_room', () => {
    const { service, sockets } = setup()

    service.connect(session())
    sockets[0].fire('connect')
    sockets[0].fire('disconnect', 'transport close')
    sockets[0].fire('connect')
    service.disconnect()

    expect(sockets[0].emit).not.toHaveBeenCalled()
  })

  it('no escucha los eventos retirados (visitor:arrival, security:anomaly_detected)', () => {
    const { service, sockets } = setup()

    service.connect(session())

    expect(sockets[0].listeners.has('visitor:arrival')).toBe(false)
    expect(sockets[0].listeners.has('security:anomaly_detected')).toBe(false)
    expect(sockets[0].listeners.has(ANOMALY_HIGHLIGHT_EVENT)).toBe(true)
  })

  it('logout (disconnect) cierra el socket y un nuevo login abre otro', () => {
    const { service, factory, sockets } = setup()
    service.connect(session())
    sockets[0].fire('connect')

    service.disconnect()

    expect(sockets[0].removeAllListeners).toHaveBeenCalled()
    expect(sockets[0].disconnect).toHaveBeenCalled()
    expect(service.getStatus()).toBe('idle')

    service.connect(session())
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('otro usuario cierra el socket anterior y abre uno nuevo', () => {
    const { service, factory, sockets } = setup()
    service.connect(session('user-1'))

    service.connect(session('user-2'))

    expect(sockets[0].disconnect).toHaveBeenCalled()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('sin VITE_WS_URL no abre socket', () => {
    vi.stubEnv('VITE_WS_URL', '')
    const { service, factory } = setup()

    service.connect(session())

    expect(factory).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('idle')
  })

  it('avisa los cambios de estado a sus suscriptores', () => {
    const { service, sockets } = setup()
    const listener = vi.fn()
    service.onStatusChange(listener)

    service.connect(session())
    sockets[0].fire('connect')

    expect(listener).toHaveBeenCalledTimes(2)
    expect(service.getStatus()).toBe('connected')
  })
})

describe('WebSocketService: rechazo o cierre del servidor', () => {
  it('connect_error unauthorized sin sesión válida: no reintenta y espera un nuevo login', async () => {
    const { service, factory, sockets } = setup()
    const current = session('user-1', false)
    service.connect(current)

    sockets[0].rejectHandshake('unauthorized')
    await flushVerification()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(current.verifySession).toHaveBeenCalledTimes(1)
    expect(sockets[0].connect).not.toHaveBeenCalled()
    expect(sockets[0].disconnect).toHaveBeenCalled()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(service.getStatus()).toBe('session-ended')

    service.connect(session('user-1'))
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('io server disconnect (sesión expirada o revocada) sin sesión válida: no reintenta', async () => {
    const { service, sockets } = setup()
    const current = session('user-1', false)
    service.connect(current)
    sockets[0].fire('connect')

    sockets[0].active = false
    sockets[0].fire('disconnect', 'io server disconnect')
    await flushVerification()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(current.verifySession).toHaveBeenCalledTimes(1)
    expect(sockets[0].connect).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('session-ended')
  })

  it('si la revalidación falla (red), se trata como sesión no válida', async () => {
    const { service, sockets } = setup()
    service.connect({ userId: 'user-1', verifySession: () => Promise.reject(new Error('network')) })

    sockets[0].rejectHandshake()
    await flushVerification()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(sockets[0].connect).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('session-ended')
  })

  it('con la sesión HTTP aún válida reintenta con backoff, como máximo REALTIME_RECOVERY_MAX_ATTEMPTS veces', async () => {
    const { service, sockets } = setup()
    const current = session('user-1', true)
    service.connect(current)
    const socket = sockets[0]

    // 1.er reintento: 2 s ±20 %.
    socket.rejectHandshake()
    await flushVerification()
    await vi.advanceTimersByTimeAsync(1_599)
    expect(socket.connect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(801)
    expect(socket.connect).toHaveBeenCalledTimes(1)

    // El servidor vuelve a rechazar: los siguientes esperan más (4 s, 8 s).
    for (let attempt = 2; attempt <= REALTIME_RECOVERY_MAX_ATTEMPTS; attempt += 1) {
      socket.rejectHandshake()
      await flushVerification()
      await vi.advanceTimersByTimeAsync(2_000 * 2 ** (attempt - 1) * 1.2 + 1)
      expect(socket.connect).toHaveBeenCalledTimes(attempt)
    }

    // Agotado el presupuesto: no hay bucle, se espera un nuevo login.
    socket.rejectHandshake()
    await flushVerification()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(socket.connect).toHaveBeenCalledTimes(REALTIME_RECOVERY_MAX_ATTEMPTS)
    expect(service.getStatus()).toBe('session-ended')
  })

  it('una conexión estable reinicia el presupuesto de reintentos', async () => {
    const { service, sockets } = setup()
    service.connect(session('user-1', true))
    const socket = sockets[0]

    for (let attempt = 1; attempt <= REALTIME_RECOVERY_MAX_ATTEMPTS; attempt += 1) {
      socket.rejectHandshake()
      await flushVerification()
      await vi.advanceTimersByTimeAsync(60_000)
    }
    expect(socket.connect).toHaveBeenCalledTimes(REALTIME_RECOVERY_MAX_ATTEMPTS)

    socket.active = true
    socket.fire('connect')
    await vi.advanceTimersByTimeAsync(REALTIME_STABLE_CONNECTION_MS)

    socket.active = false
    socket.fire('disconnect', 'io server disconnect')
    await flushVerification()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(socket.connect).toHaveBeenCalledTimes(REALTIME_RECOVERY_MAX_ATTEMPTS + 1)
  })

  it('un corte de red (socket activo) lo reintenta socket.io: no revalida ni reconecta a mano', async () => {
    const { service, sockets } = setup()
    const current = session()
    service.connect(current)

    sockets[0].fire('connect_error', new Error('xhr poll error'))
    sockets[0].fire('disconnect', 'transport close')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(current.verifySession).not.toHaveBeenCalled()
    expect(sockets[0].connect).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('reconnecting')
  })

  it('una revalidación que termina después del logout no reconecta nada', async () => {
    const { service, sockets } = setup()
    let resolveVerification: (isValid: boolean) => void = () => undefined
    service.connect({
      userId: 'user-1',
      verifySession: () =>
        new Promise<boolean>((resolve) => {
          resolveVerification = resolve
        }),
    })

    sockets[0].rejectHandshake()
    service.disconnect()
    resolveVerification(true)
    await flushVerification()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(sockets[0].connect).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('idle')
  })

  it('una revalidación vieja que falla no cierra el socket del nuevo login', async () => {
    const { service, sockets } = setup()
    let resolveVerification: (isValid: boolean) => void = () => undefined
    service.connect({
      userId: 'user-1',
      verifySession: () =>
        new Promise<boolean>((resolve) => {
          resolveVerification = resolve
        }),
    })

    sockets[0].rejectHandshake()
    service.connect(session('user-2'))
    resolveVerification(false)
    await flushVerification()

    expect(sockets[1].disconnect).not.toHaveBeenCalled()
    expect(service.getStatus()).toBe('connecting')
  })
})

describe('WebSocketService: eventos', () => {
  it('entrega `notification` a los suscriptores y la suscripción sobrevive a un nuevo login', () => {
    const { service, sockets } = setup()
    const handler = vi.fn()
    service.onNotification(handler)

    service.connect(session())
    sockets[0].fire(NOTIFICATION_EVENT, { title: 'Visita', message: 'Llegó Ana' })
    service.disconnect()
    service.connect(session())
    sockets[1].fire(NOTIFICATION_EVENT, { title: 'Visita', message: 'Llegó Luis' })

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith({ title: 'Visita', message: 'Llegó Luis' })
  })

  it('un handler que falla no impide notificar a los demás', () => {
    const { service, sockets } = setup()
    const failing = vi.fn(() => {
      throw new Error('boom')
    })
    const healthy = vi.fn()
    service.onNotification(failing)
    service.onNotification(healthy)

    service.connect(session())
    sockets[0].fire(NOTIFICATION_EVENT, { title: 'x' })

    expect(healthy).toHaveBeenCalledTimes(1)
  })

  it('normaliza security:anomaly_highlight y descarta los payloads sin id', () => {
    const { service, sockets } = setup()
    const handler = vi.fn<(highlight: AnomalyHighlight) => void>()
    const off = service.onAnomalyHighlight(handler)
    service.connect(session())

    sockets[0].fire(ANOMALY_HIGHLIGHT_EVENT, { cameraId: 'cam-1', severity: 'HIGH' })
    sockets[0].fire(ANOMALY_HIGHLIGHT_EVENT, {
      anomalyId: 'anom-1',
      cameraId: 'cam-1',
      cameraName: 'Acceso norte',
      type: 'intrusion',
      severity: 'high',
      reasoning: 'Persona en zona restringida',
      timestamp: '2026-10-09T03:15:00.000Z',
      snapshotJpegB64: 'ignored',
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      anomalyId: 'anom-1',
      cameraId: 'cam-1',
      cameraName: 'Acceso norte',
      type: 'intrusion',
      severity: 'HIGH',
      reasoning: 'Persona en zona restringida',
      timestamp: new Date('2026-10-09T03:15:00.000Z'),
    })

    off()
    sockets[0].fire(ANOMALY_HIGHLIGHT_EVENT, { anomalyId: 'anom-2' })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
