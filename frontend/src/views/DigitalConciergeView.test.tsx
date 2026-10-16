import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { kioskCredentialStore } from '@/services/kioskCredentialStore'
import { RATE_LIMIT_MESSAGE } from '@/helpers/httpErrors'
import { KIOSK_PRIVACY_NOTICE, KIOSK_PRIVACY_NOTICE_PARTS } from '@/helpers/privacyPolicy'
import {
  RESIDENT_APPROVAL_PROCESSING_LIMIT_MS,
  RESIDENT_RESPONSE_MAX_WAIT_MS,
  RESIDENT_RESPONSE_POLL_INTERVAL_MS,
} from '@/helpers/residentResponseWatcher'
import { DigitalConciergeView } from './DigitalConciergeView'

interface FakeTool {
  name: string
  execute: (input: unknown) => Promise<string>
}

interface FakeRealtimeSession {
  on: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  sendMessage: ReturnType<typeof vi.fn>
}

// SDK de voz falso: registra las tools "delgadas" y las sesiones creadas.
const realtime = vi.hoisted(() => ({
  tools: [] as FakeTool[],
  sessions: [] as FakeRealtimeSession[],
  /** Si está definido, `session.connect()` falla con este error. */
  connectError: null as Error | null,
}))
vi.mock('@openai/agents/realtime', () => ({
  RealtimeAgent: class {},
  RealtimeSession: class {
    on = vi.fn()
    connect = vi.fn(async () => {
      if (realtime.connectError) {
        throw realtime.connectError
      }
    })
    close = vi.fn()
    sendMessage = vi.fn()
    constructor() {
      realtime.sessions.push(this)
    }
  },
  tool: (config: FakeTool) => {
    realtime.tools.push(config)
    return config
  },
}))

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const socketMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getSocketId: vi.fn(() => 'hub-socket-1'),
  on: vi.fn(() => () => undefined),
}))
vi.mock('@/services/KioskSocketService', () => ({ kioskSocket: socketMock }))

const CREDENTIAL = { hubId: 'hub-kiosk-1', hubSecret: 'kiosk-secret' }
/** En pantalla el hubId va enmascarado: solo sus últimos 4 caracteres. */
const DEVICE_LABEL = 'Dispositivo ••••sk-1'
const SESSION_ID = 'session-42'
const POLL_MS = RESIDENT_RESPONSE_POLL_INTERVAL_MS
const PENDING = { active: true, residentResponse: 'pending', entryRegistered: null, visitId: 'v-1' }

interface RequestConfig {
  url?: string
  data?: unknown
}

function toolDefinition(name: string) {
  return { type: 'function', name, description: name, parameters: { type: 'object', properties: {} } }
}

/** Backend falso del kiosko; `status` decide qué devuelve cada consulta a /status. */
interface BackendOptions {
  notificado?: boolean
  reenviado?: boolean
  status?: () => unknown
  /** Reemplaza la respuesta de agent-config (p. ej. un 429 o una promesa pendiente). */
  agentConfig?: () => Promise<unknown>
  /** `data` de una tool por nombre (tiene prioridad sobre las respuestas por defecto). */
  toolData?: Record<string, unknown>
}

function mockBackend({
  notificado = true,
  reenviado = true,
  status = (): unknown => PENDING,
  agentConfig,
  toolData = {},
}: BackendOptions = {}) {
  apiMock.request.mockImplementation(async ({ url = '', data }: RequestConfig) => {
    if (url === '/concierge/session/start') {
      return { data: { sessionId: SESSION_ID, ephemeralToken: 'ephemeral', expiresAt: '' } }
    }
    if (url.startsWith('/concierge/agent-config/') && agentConfig) {
      return agentConfig()
    }
    if (url.startsWith('/concierge/agent-config/')) {
      return {
        data: {
          instructions: 'prompt',
          tools: [
            toolDefinition('buscar_residente'),
            toolDefinition('notificar_residente'),
            toolDefinition('reenviar_notificacion'),
            toolDefinition('finalizar_llamada'),
          ],
        },
      }
    }
    if (url.endsWith('/execute-tool')) {
      const toolName = (data as { toolName: string }).toolName
      if (toolName in toolData) {
        return { data: { success: true, data: toolData[toolName] } }
      }
      if (toolName === 'notificar_residente') {
        return { data: { success: true, data: { notificado, mensaje: 'ok' } } }
      }
      if (toolName === 'reenviar_notificacion') {
        return { data: { success: true, data: { reenviado, mensaje: 'ok' } } }
      }
      return { data: { success: true, data: {} } }
    }
    if (url.endsWith('/status')) {
      return { data: status() }
    }
    if (url.endsWith('/end')) {
      return { data: { sessionId: SESSION_ID, status: 'completed', duration: 1, visitCreated: true } }
    }
    throw new Error(`URL inesperada: ${url}`)
  })
}

function requestsTo(suffix: string): RequestConfig[] {
  return apiMock.request.mock.calls
    .map(([config]) => config as RequestConfig)
    .filter((config) => (config.url ?? '').endsWith(suffix))
}

/** Avanza el reloj falso y vacía las promesas pendientes dentro de `act`. */
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve()
    }
  })
}

/** Marca la casa 1 y pulsa "Llamar": queda en el aviso de privacidad (sin render). */
function pressCall(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Número 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Llamar' }))
}

/** Marca la casa 1, pulsa "Llamar" y acepta el aviso de privacidad (sin render). */
async function dialHouse(): Promise<void> {
  pressCall()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  await flush()
  await flush()
}

function getUserMediaMock(): ReturnType<typeof vi.fn> {
  return navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
}

/** Marca la casa 1, inicia la llamada y espera a que la sesión de voz conecte. */
async function startCall(): Promise<FakeRealtimeSession> {
  render(<DigitalConciergeView />)
  await dialHouse()
  const session = realtime.sessions[0]
  expect(session.connect).toHaveBeenCalled()
  return session
}

function httpError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data: {} }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

async function runTool(name: string): Promise<void> {
  const tool = realtime.tools.find((candidate) => candidate.name === name)
  expect(tool).toBeDefined()
  await act(async () => {
    await tool?.execute({})
  })
}

function lastAgentInstruction(session: FakeRealtimeSession): string {
  const calls = session.sendMessage.mock.calls
  const message = calls[calls.length - 1]?.[0] as { content: Array<{ text: string }> } | undefined
  return message?.content[0]?.text ?? ''
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  realtime.tools.length = 0
  realtime.sessions.length = 0
  realtime.connectError = null
  window.localStorage.clear()
  kioskCredentialStore.clear()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DigitalConciergeView: emparejamiento', () => {
  it('sin credencial muestra el emparejamiento y no abre socket', () => {
    render(<DigitalConciergeView />)

    expect(screen.getByRole('heading', { name: 'Emparejar este kiosko' })).toBeInTheDocument()
    expect(socketMock.connect).not.toHaveBeenCalled()
  })

  it('emparejado: muestra el teclado, conecta el socket y no ofrece "desemparejar" a la vista', () => {
    kioskCredentialStore.save(CREDENTIAL)

    render(<DigitalConciergeView />)

    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
    expect(socketMock.connect).toHaveBeenCalledWith(CREDENTIAL)
    expect(screen.queryByRole('button', { name: /desemparejar/i })).not.toBeInTheDocument()
  })

  it('un 401 (credencial borrada) vuelve al emparejamiento y desconecta el socket', () => {
    kioskCredentialStore.save(CREDENTIAL)
    render(<DigitalConciergeView />)

    act(() => {
      kioskCredentialStore.clear('unauthorized')
    })

    expect(screen.getByRole('heading', { name: 'Emparejar este kiosko' })).toBeInTheDocument()
    expect(screen.getByText(/El servidor rechazó la credencial guardada/)).toBeInTheDocument()
    expect(socketMock.disconnect).toHaveBeenCalled()
  })
})

describe('DigitalConciergeView: desemparejar (gesto de operador + secret)', () => {
  function pressDeviceId(ms: number): void {
    const deviceId = screen.getByText(DEVICE_LABEL)
    fireEvent.pointerDown(deviceId)
    act(() => {
      vi.advanceTimersByTime(ms)
    })
    fireEvent.pointerUp(deviceId)
  }

  it('el identificador evita que el navegador cancele el gesto (touch-action/user-select: none)', () => {
    kioskCredentialStore.save(CREDENTIAL)
    render(<DigitalConciergeView />)

    expect(screen.getByText(DEVICE_LABEL)).toHaveClass('touch-none', 'select-none')
  })

  it('la pantalla muestra el hubId enmascarado, nunca completo', () => {
    kioskCredentialStore.save(CREDENTIAL)
    render(<DigitalConciergeView />)

    expect(screen.getByText(DEVICE_LABEL)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(CREDENTIAL.hubId)
  })

  it('el panel abierto se cierra al empezar una llamada y no reaparece al volver al teclado', async () => {
    kioskCredentialStore.save(CREDENTIAL)
    mockBackend({ agentConfig: () => Promise.reject(httpError(429)) })
    render(<DigitalConciergeView />)

    pressDeviceId(3_000)
    expect(screen.getByRole('heading', { name: 'Desemparejar este kiosko' })).toBeInTheDocument()

    await dialHouse()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar Casa' }))

    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Desemparejar este kiosko' })).not.toBeInTheDocument()
  })

  it('una pulsación corta no abre nada', () => {
    kioskCredentialStore.save(CREDENTIAL)
    render(<DigitalConciergeView />)

    pressDeviceId(2_999)

    expect(screen.queryByRole('heading', { name: 'Desemparejar este kiosko' })).not.toBeInTheDocument()
  })

  it('pulsación larga (3 s) + secret incorrecto: no desempareja', () => {
    kioskCredentialStore.save(CREDENTIAL)
    render(<DigitalConciergeView />)

    pressDeviceId(3_000)
    expect(screen.getByRole('heading', { name: 'Desemparejar este kiosko' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Secreto actual del dispositivo'), { target: { value: 'otro-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Desemparejar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('El secreto no coincide')
    expect(kioskCredentialStore.get()).toEqual(CREDENTIAL)
    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
  })

  it('pulsación larga (3 s) + secret correcto: borra la credencial, vuelve al emparejamiento y desconecta', () => {
    kioskCredentialStore.save(CREDENTIAL)
    render(<DigitalConciergeView />)

    pressDeviceId(3_000)
    fireEvent.change(screen.getByLabelText('Secreto actual del dispositivo'), {
      target: { value: CREDENTIAL.hubSecret },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Desemparejar' }))

    expect(kioskCredentialStore.get()).toBeNull()
    expect(screen.getByRole('heading', { name: 'Emparejar este kiosko' })).toBeInTheDocument()
    expect(socketMock.disconnect).toHaveBeenCalled()
  })
})

describe('DigitalConciergeView: aviso de privacidad antes del micrófono (Ley 21.719)', () => {
  beforeEach(() => {
    kioskCredentialStore.save(CREDENTIAL)
  })

  it('al marcar la casa muestra el aviso (§5.2) y NO pide el micrófono ni crea sesión', async () => {
    mockBackend()
    render(<DigitalConciergeView />)

    pressCall()
    await flush()

    const notice = screen.getByRole('region', { name: 'Antes de hablar con Sofía' })
    for (const part of KIOSK_PRIVACY_NOTICE_PARTS) {
      expect(notice).toHaveTextContent(part)
    }
    expect(notice).toHaveTextContent('OpenAI, EE.UU.')
    expect(notice).toHaveTextContent('90 días')
    expect(notice).toHaveAccessibleDescription(KIOSK_PRIVACY_NOTICE)
    // QR con la URL absoluta de la política + URL corta legible.
    expect(within(notice).getByRole('img', { name: 'Código QR del aviso de privacidad' })).toBeInTheDocument()
    expect(notice).toHaveTextContent(`${window.location.host}/privacy-policy`)
    expect(screen.getByRole('heading', { name: 'Antes de hablar con Sofía' })).toHaveFocus()

    expect(getUserMediaMock()).not.toHaveBeenCalled()
    expect(requestsTo('/concierge/session/start')).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'Marcar Casa/Departamento' })).not.toBeInTheDocument()
  })

  it('Cancelar vuelve al teclado sin pedir el micrófono ni crear sesión', async () => {
    mockBackend()
    render(<DigitalConciergeView />)

    pressCall()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await flush()

    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Antes de hablar con Sofía' })).not.toBeInTheDocument()
    expect(getUserMediaMock()).not.toHaveBeenCalled()
    expect(apiMock.request).not.toHaveBeenCalled()
    expect(realtime.sessions).toHaveLength(0)
  })

  it('Escape equivale a Cancelar', async () => {
    mockBackend()
    render(<DigitalConciergeView />)

    pressCall()
    fireEvent.keyDown(document, { key: 'Escape' })
    await flush()

    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
    expect(getUserMediaMock()).not.toHaveBeenCalled()
    expect(apiMock.request).not.toHaveBeenCalled()
  })

  it('Continuar pide el micrófono y recién ahí crea la sesión', async () => {
    mockBackend()
    render(<DigitalConciergeView />)

    pressCall()
    expect(getUserMediaMock()).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await flush()
    await flush()

    expect(getUserMediaMock()).toHaveBeenCalledTimes(1)
    expect(getUserMediaMock()).toHaveBeenCalledWith({ audio: true })
    expect(requestsTo('/concierge/session/start')).toHaveLength(1)
    expect(realtime.sessions[0].connect).toHaveBeenCalled()
  })

  it('micrófono denegado tras Continuar: vuelve al teclado con el error y sin sesión', async () => {
    mockBackend()
    getUserMediaMock().mockRejectedValueOnce(new Error('NotAllowedError'))
    render(<DigitalConciergeView />)

    await dialHouse()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo acceder al micrófono')
    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
    expect(apiMock.request).not.toHaveBeenCalled()
  })

  it('Cancelar mientras el navegador pide el permiso: no abre la sesión', async () => {
    mockBackend()
    let grantMicrophone: (stream: unknown) => void = () => undefined
    getUserMediaMock().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grantMicrophone = resolve
        }),
    )
    render(<DigitalConciergeView />)

    pressCall()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await flush()
    expect(screen.getByRole('button', { name: 'Conectando…' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    grantMicrophone({ getTracks: () => [] })
    await flush()
    await flush()

    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
    expect(apiMock.request).not.toHaveBeenCalled()
    expect(realtime.sessions).toHaveLength(0)
  })

  it('"Ver aviso de privacidad" abre la política dentro del kiosko, sin enlaces que saquen de la pantalla', async () => {
    mockBackend()
    render(<DigitalConciergeView />)

    pressCall()
    fireEvent.click(screen.getByRole('button', { name: 'Ver aviso de privacidad' }))
    await flush()

    const dialog = screen.getByRole('dialog', { name: 'Aviso de privacidad' })
    expect(within(dialog).getByRole('heading', { name: 'Proveedores que tratan datos por encargo' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('OpenAI')
    expect(within(dialog).queryAllByRole('link')).toHaveLength(0)

    // Con la política abierta, Escape cierra el diálogo y no cancela la llamada.
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    await flush(500)
    expect(screen.queryByRole('dialog', { name: 'Aviso de privacidad' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Antes de hablar con Sofía' })).toBeInTheDocument()
    expect(getUserMediaMock()).not.toHaveBeenCalled()
  })

  it('el teclado también enlaza el aviso de privacidad (y "Cerrar" vuelve al teclado)', async () => {
    render(<DigitalConciergeView />)

    fireEvent.click(screen.getByRole('button', { name: 'Aviso de privacidad' }))
    await flush()
    const dialog = screen.getByRole('dialog', { name: 'Aviso de privacidad' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    await flush(500)
    expect(screen.queryByRole('dialog', { name: 'Aviso de privacidad' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
  })
})

describe('DigitalConciergeView: sesión del backend huérfana y 429', () => {
  beforeEach(() => {
    kioskCredentialStore.save(CREDENTIAL)
  })

  it('429 en agent-config tras crear la sesión: mensaje amable y la sesión se cierra (cancelled)', async () => {
    mockBackend({ agentConfig: () => Promise.reject(httpError(429)) })
    render(<DigitalConciergeView />)

    await dialHouse()

    expect(screen.getByRole('alert')).toHaveTextContent(RATE_LIMIT_MESSAGE)
    expect(screen.queryByText(/status code 429/)).not.toBeInTheDocument()
    expect(realtime.sessions).toHaveLength(0)
    expect(requestsTo('/end')).toEqual([
      expect.objectContaining({ url: `/concierge/session/${SESSION_ID}/end`, data: { finalStatus: 'cancelled' } }),
    ])

    // "Cambiar Casa" no vuelve a cerrarla.
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar Casa' }))
    await flush()
    expect(requestsTo('/end')).toHaveLength(1)
  })

  it('falla la conexión de voz: cierra la sesión de voz y la del backend', async () => {
    realtime.connectError = new Error('No se pudo establecer la conexión de voz')
    mockBackend()
    render(<DigitalConciergeView />)

    await dialHouse()

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo establecer la conexión de voz')
    expect(realtime.sessions[0].close).toHaveBeenCalled()
    expect(requestsTo('/end')).toEqual([expect.objectContaining({ data: { finalStatus: 'cancelled' } })])
  })

  it('"Cambiar Casa" mientras conecta: cierra la sesión del backend y abandona el intento', async () => {
    let resolveAgentConfig: (value: unknown) => void = () => undefined
    mockBackend({
      agentConfig: () =>
        new Promise((resolve) => {
          resolveAgentConfig = resolve
        }),
    })
    render(<DigitalConciergeView />)
    await dialHouse()

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar Casa' }))
    await flush()
    expect(requestsTo('/end')).toEqual([expect.objectContaining({ data: { finalStatus: 'cancelled' } })])

    // La respuesta tardía de agent-config ya no abre la llamada.
    resolveAgentConfig({ data: { instructions: 'prompt', tools: [] } })
    await flush()
    await flush()

    expect(realtime.sessions).toHaveLength(0)
    expect(requestsTo('/end')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Marcar Casa/Departamento' })).toBeInTheDocument()
  })

  it('"Cambiar Casa" tras una llamada ya terminada no llama a /end de nuevo', async () => {
    mockBackend()
    await startCall()

    fireEvent.click(screen.getByRole('button', { name: /Finalizar Sesión/ }))
    await flush()
    expect(requestsTo('/end')).toEqual([expect.objectContaining({ data: { finalStatus: 'completed' } })])

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar Casa' }))
    await flush()
    expect(requestsTo('/end')).toHaveLength(1)
  })
})

describe('DigitalConciergeView: espera de la respuesta del residente', () => {
  beforeEach(() => {
    kioskCredentialStore.save(CREDENTIAL)
  })

  it('notificar_residente exitoso → polling → respuesta: instruye al agente y corta la llamada', async () => {
    const statuses: unknown[] = [PENDING, { active: false, residentResponse: 'approved', entryRegistered: true }]
    mockBackend({ status: () => statuses.shift() ?? PENDING })
    const session = await startCall()

    await runTool('notificar_residente')
    await flush(POLL_MS)
    expect(session.sendMessage).not.toHaveBeenCalled()

    await flush(POLL_MS)
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(lastAgentInstruction(session)).toMatch(/bienvenida/)
    expect(screen.getByText('El residente aprobó la visita. El acceso quedó habilitado.')).toBeInTheDocument()
    expect(requestsTo('/status')).toHaveLength(2)

    // Corte de seguridad: cierra la voz y la sesión del backend.
    await flush(25_000)
    expect(session.close).toHaveBeenCalled()
    expect(requestsTo('/end')).toEqual([expect.objectContaining({ data: { finalStatus: 'completed' } })])
  })

  it('"Residente notificado" muestra la casa y la cantidad, nunca nombres', async () => {
    mockBackend({
      toolData: {
        // Lo que recibe un web-kiosk: ids y conteo (sin `nombre`).
        buscar_residente: { encontrado: true, casa: 'A-1', residentes: [{ id: 'r-1' }, { id: 'r-2' }], cantidad_residentes: 2 },
        notificar_residente: { notificado: true, mensaje: 'ok', cantidad_notificados: 2 },
      },
    })
    await startCall()

    await runTool('buscar_residente')
    // Encontrar la casa no es notificar.
    expect(screen.queryByText('Residente notificado')).not.toBeInTheDocument()

    await runTool('notificar_residente')
    expect(screen.getByText('Residente notificado')).toBeInTheDocument()
    expect(screen.getByText('2 residentes de la casa A-1')).toBeInTheDocument()
  })

  it('con un solo residente notificado: "Residente de la casa X"', async () => {
    mockBackend({ toolData: { notificar_residente: { notificado: true, mensaje: 'ok', cantidad_notificados: 1 } } })
    await startCall()

    await runTool('notificar_residente')

    expect(screen.getByText('Residente de la casa 1')).toBeInTheDocument()
  })

  it('notificar_residente con notificado:false no inicia la espera', async () => {
    mockBackend({ notificado: false })
    const session = await startCall()

    await runTool('notificar_residente')
    await flush(RESIDENT_RESPONSE_MAX_WAIT_MS)

    expect(requestsTo('/status')).toHaveLength(0)
    expect(session.sendMessage).not.toHaveBeenCalled()
  })

  it('sin respuesta en 3 minutos: el agente avisa, la sesión del backend se cierra ya (timeout) y se cuelga', async () => {
    mockBackend()
    const session = await startCall()

    await runTool('notificar_residente')
    await flush(RESIDENT_RESPONSE_MAX_WAIT_MS)

    expect(lastAgentInstruction(session)).toMatch(/no respondió/)
    expect(lastAgentInstruction(session)).not.toMatch(/bienvenida|puede ingresar/)
    expect(requestsTo('/end')).toEqual([expect.objectContaining({ data: { finalStatus: 'timeout' } })])
    expect(session.close).not.toHaveBeenCalled()

    await flush(15_000)
    expect(session.close).toHaveBeenCalled()
    // No se vuelve a cerrar en el backend al colgar.
    expect(requestsTo('/end')).toHaveLength(1)
  })

  it('reenvío exitoso a los 2:30: la espera vence 3 min después del reenvío, no a los 3:00', async () => {
    mockBackend({ reenviado: true })
    const session = await startCall()
    const resendAt = 150_000

    await runTool('notificar_residente')
    await flush(resendAt)
    await runTool('reenviar_notificacion')

    await flush(RESIDENT_RESPONSE_MAX_WAIT_MS - resendAt)
    expect(session.sendMessage).not.toHaveBeenCalled()
    expect(requestsTo('/end')).toHaveLength(0)

    await flush(resendAt - 1)
    expect(session.sendMessage).not.toHaveBeenCalled()

    await flush(1)
    expect(lastAgentInstruction(session)).toMatch(/no respondió/)
    expect(requestsTo('/end')).toEqual([expect.objectContaining({ data: { finalStatus: 'timeout' } })])
  })

  it('reenvío fallido a los 2:30: la espera vence igual a los 3:00', async () => {
    mockBackend({ reenviado: false })
    const session = await startCall()
    const resendAt = 150_000

    await runTool('notificar_residente')
    await flush(resendAt)
    await runTool('reenviar_notificacion')

    await flush(RESIDENT_RESPONSE_MAX_WAIT_MS - resendAt - 1)
    expect(session.sendMessage).not.toHaveBeenCalled()

    await flush(1)
    expect(lastAgentInstruction(session)).toMatch(/no respondió/)
  })

  it('approved + entryRegistered null por más de 30 s: acceso no abierto (fail-closed)', async () => {
    mockBackend({ status: () => ({ active: false, residentResponse: 'approved', entryRegistered: null }) })
    const session = await startCall()

    await runTool('notificar_residente')
    await flush(POLL_MS)
    expect(session.sendMessage).not.toHaveBeenCalled()

    await flush(RESIDENT_APPROVAL_PROCESSING_LIMIT_MS)
    expect(session.sendMessage).toHaveBeenCalledTimes(1)
    expect(lastAgentInstruction(session)).toMatch(/acceso NO se abrió automáticamente/)
    expect(lastAgentInstruction(session)).not.toMatch(/bienvenida|puede ingresar/)
  })

  it('sesión cerrada sin respuesta (onClosed): el agente avisa y se cuelga sin volver a cerrar en el backend', async () => {
    mockBackend({ status: () => ({ active: false, residentResponse: 'pending', entryRegistered: null }) })
    const session = await startCall()

    await runTool('notificar_residente')
    await flush(POLL_MS)

    expect(lastAgentInstruction(session)).toMatch(/no pudo completarse o expiró/)
    expect(screen.getByText(/La solicitud no pudo completarse o expiró/)).toBeInTheDocument()

    await flush(15_000)
    expect(session.close).toHaveBeenCalled()
    expect(requestsTo('/end')).toHaveLength(0)
  })
})
