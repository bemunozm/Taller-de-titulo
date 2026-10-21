import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Socket } from 'socket.io-client'
import { KIOSK_SOCKET_STABLE_CONNECTION_MS, KioskSocketService } from './KioskSocketService'

type Listener = (...args: unknown[]) => void

/** Doble mínimo de `Socket` con lo que usa el servicio. */
class FakeSocket {
  id = 'hub-socket-1'
  connected = false
  active = true
  readonly listeners = new Map<string, Listener[]>()
  anyListener: Listener | null = null
  readonly connect = vi.fn()
  readonly disconnect = vi.fn()
  readonly removeAllListeners = vi.fn()
  readonly offAny = vi.fn(() => {
    this.anyListener = null
  })

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  onAny(listener: Listener): this {
    this.anyListener = listener
    return this
  }

  fire(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((listener) => listener(...args))
  }

  /** Evento del servidor (lo que socket.io entrega a `onAny`). */
  serverEmit(event: string, payload: unknown): void {
    this.anyListener?.(event, payload)
  }
}

const CREDENTIAL = { hubId: 'hub-kiosk-1', hubSecret: 'kiosk-secret' }

function setup() {
  const sockets: FakeSocket[] = []
  const factory = vi.fn<(url: string, options: unknown) => Socket>(() => {
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket as unknown as Socket
  })
  const service = new KioskSocketService(factory)
  return { service, factory, sockets }
}

beforeEach(() => {
  vi.stubEnv('VITE_WS_URL', 'http://ws.test/')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('KioskSocketService', () => {
  it('se conecta al namespace /hub con auth de dispositivo y solo websocket', () => {
    const { service, factory } = setup()

    service.connect(CREDENTIAL)

    expect(factory).toHaveBeenCalledWith(
      'http://ws.test/hub',
      expect.objectContaining({
        auth: { hubId: 'hub-kiosk-1', hubSecret: 'kiosk-secret' },
        transports: ['websocket'],
      }),
    )
  })

  it('no reconecta si ya está conectado con la misma credencial', () => {
    const { service, factory } = setup()

    service.connect(CREDENTIAL)
    service.connect({ ...CREDENTIAL })

    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('entrega visitor:response:<sessionId> solo a los handlers de esa sesión', () => {
    const { service, sockets } = setup()
    const handler = vi.fn()
    const otherHandler = vi.fn()
    service.on('visitor:response:s-1', handler)
    service.on('visitor:response:s-2', otherHandler)
    service.connect(CREDENTIAL)

    sockets[0].serverEmit('visitor:response:s-1', { approved: true, entryRegistered: true })

    expect(handler).toHaveBeenCalledWith({ approved: true, entryRegistered: true })
    expect(otherHandler).not.toHaveBeenCalled()
  })

  it('la función devuelta por on() desuscribe', () => {
    const { service, sockets } = setup()
    const handler = vi.fn()
    const off = service.on('visitor:response:s-1', handler)
    service.connect(CREDENTIAL)

    off()
    sockets[0].serverEmit('visitor:response:s-1', { approved: true })

    expect(handler).not.toHaveBeenCalled()
  })

  it('getSocketId solo devuelve el id con el socket conectado', () => {
    const { service, sockets } = setup()
    service.connect(CREDENTIAL)

    expect(service.getSocketId()).toBeUndefined()
    sockets[0].connected = true
    expect(service.getSocketId()).toBe('hub-socket-1')
  })

  /** Rechazo del middleware: `connect_error` y socket.io ya no reintenta solo. */
  function rejectHandshake(socket: FakeSocket): void {
    socket.active = false
    socket.fire('connect_error', new Error('unauthorized'))
  }

  // Con ±20 % de jitter, el intento n espera entre 0,8·2^n·2 s y 1,2·2^n·2 s.
  it('si el middleware rechaza la credencial, reintenta con backoff 2 s → 4 s (sin tocar la credencial)', () => {
    vi.useFakeTimers()
    const { service, sockets } = setup()
    service.connect(CREDENTIAL)
    const socket = sockets[0]

    rejectHandshake(socket)
    vi.advanceTimersByTime(1_599)
    expect(socket.connect).not.toHaveBeenCalled()
    vi.advanceTimersByTime(801)
    expect(socket.connect).toHaveBeenCalledTimes(1)

    rejectHandshake(socket)
    vi.advanceTimersByTime(3_199)
    expect(socket.connect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_601)
    expect(socket.connect).toHaveBeenCalledTimes(2)
  })

  /** Lleva el backoff al tercer intento (~8 s) con dos rechazos seguidos. */
  function escalateBackoff(socket: FakeSocket): void {
    rejectHandshake(socket)
    vi.advanceTimersByTime(2_400)
    rejectHandshake(socket)
    vi.advanceTimersByTime(4_800)
    expect(socket.connect).toHaveBeenCalledTimes(2)
  }

  it('connect ni hub:connected reinician el backoff por sí solos', () => {
    vi.useFakeTimers()
    const { service, sockets } = setup()
    service.connect(CREDENTIAL)
    const socket = sockets[0]
    escalateBackoff(socket)

    // Conecta y el servidor lo registra, pero lo expulsa antes de 30 s
    // (otra pestaña con el mismo hubId): el tercer intento sigue en ~8 s.
    socket.fire('connect')
    socket.fire('hub:connected')
    vi.advanceTimersByTime(29_999)
    socket.fire('disconnect', 'io server disconnect')
    vi.advanceTimersByTime(6_399)
    expect(socket.connect).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(3_201)
    expect(socket.connect).toHaveBeenCalledTimes(3)
  })

  it('el backoff se reinicia tras 30 s de conexión estable desde hub:connected', () => {
    vi.useFakeTimers()
    const { service, sockets } = setup()
    service.connect(CREDENTIAL)
    const socket = sockets[0]
    escalateBackoff(socket)

    socket.fire('hub:connected')
    vi.advanceTimersByTime(KIOSK_SOCKET_STABLE_CONNECTION_MS)

    // Estable 30 s: el siguiente corte vuelve a ~2 s.
    socket.fire('disconnect', 'io server disconnect')
    vi.advanceTimersByTime(1_599)
    expect(socket.connect).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(801)
    expect(socket.connect).toHaveBeenCalledTimes(3)
  })

  it('dos pestañas con el mismo hubId: las expulsiones espacian cada vez más las reconexiones', () => {
    vi.useFakeTimers()
    const { service, sockets } = setup()
    service.connect(CREDENTIAL)
    const socket = sockets[0]
    const reconnectTimes: number[] = []
    socket.connect.mockImplementation(() => {
      reconnectTimes.push(Date.now())
      // Reconecta, el servidor la registra y la otra pestaña la expulsa al toque.
      socket.fire('hub:connected')
      socket.fire('disconnect', 'io server disconnect')
    })

    socket.fire('hub:connected')
    socket.fire('disconnect', 'io server disconnect')
    vi.advanceTimersByTime(120_000)

    const gaps = reconnectTimes.slice(1).map((time, index) => time - reconnectTimes[index])
    expect(gaps.length).toBeGreaterThanOrEqual(3)
    // Nunca vuelve a ~2 s: cada espera es mayor que la anterior (hasta el tope de 60 s).
    gaps.forEach((gap, index) => {
      if (index > 0) {
        expect(gap).toBeGreaterThan(gaps[index - 1] * 1.2)
      }
    })
  })

  it('el backoff no supera 60 s', () => {
    vi.useFakeTimers()
    const { service, sockets } = setup()
    service.connect(CREDENTIAL)
    const socket = sockets[0]

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      rejectHandshake(socket)
      vi.advanceTimersByTime(60_000)
      expect(socket.connect).toHaveBeenCalledTimes(attempt)
    }
  })

  it('io server disconnect (otra pestaña con el mismo hubId) reconecta con backoff, no al instante', () => {
    vi.useFakeTimers()
    const { service, sockets } = setup()
    service.connect(CREDENTIAL)
    const socket = sockets[0]

    socket.fire('disconnect', 'io server disconnect')
    vi.advanceTimersByTime(1_599)
    expect(socket.connect).not.toHaveBeenCalled()
    vi.advanceTimersByTime(801)
    expect(socket.connect).toHaveBeenCalledTimes(1)

    // Un segundo "last-wins" espera más: no hay bucle cerrado entre pestañas.
    socket.fire('disconnect', 'io server disconnect')
    vi.advanceTimersByTime(3_199)
    expect(socket.connect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_601)
    expect(socket.connect).toHaveBeenCalledTimes(2)
  })

  it('disconnect cierra el socket y cancela reintentos pendientes', () => {
    vi.useFakeTimers()
    const { service, sockets } = setup()
    service.connect(CREDENTIAL)
    const socket = sockets[0]
    socket.active = false
    socket.fire('connect_error', new Error('unauthorized'))

    service.disconnect()
    vi.advanceTimersByTime(60_000)

    expect(socket.disconnect).toHaveBeenCalledTimes(1)
    expect(socket.connect).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sin VITE_WS_URL no abre socket (el polling cubre la respuesta)', () => {
    vi.stubEnv('VITE_WS_URL', '')
    const { service, factory } = setup()

    service.connect(CREDENTIAL)

    expect(factory).not.toHaveBeenCalled()
  })
})
