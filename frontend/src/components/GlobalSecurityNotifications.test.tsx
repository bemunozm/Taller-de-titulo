import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import type { AnomalyHighlight } from '@/helpers/securityAlerts'
import { useLocation } from 'react-router-dom'
import { renderWithProviders } from '@/test/renderWithProviders'
import { GlobalSecurityNotifications } from './GlobalSecurityNotifications'

// API real de anomalías sobre un axios simulado.
const apiMock = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const permissionsState = vi.hoisted(() => ({
  permissions: [] as string[],
  isSuperAdmin: false,
}))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    userPermissions: permissionsState.permissions,
    isSuperAdmin: permissionsState.isSuperAdmin,
  }),
}))

// Socket de la sesión: se capturan los handlers para emitir avisos a mano.
const socketState = vi.hoisted(() => ({
  handlers: new Set<(highlight: AnomalyHighlight) => void>(),
  updateHandlers: new Set<(update: { anomalyId: string }) => void>(),
}))
const webSocketServiceMock = vi.hoisted(() => ({
  onAnomalyHighlight: vi.fn((handler: (highlight: AnomalyHighlight) => void) => {
    socketState.handlers.add(handler)
    return () => {
      socketState.handlers.delete(handler)
    }
  }),
  onAnomalyUpdated: vi.fn((handler: (update: { anomalyId: string }) => void) => {
    socketState.updateHandlers.add(handler)
    return () => {
      socketState.updateHandlers.delete(handler)
    }
  }),
}))
vi.mock('@/services/WebSocketService', () => ({ webSocketService: webSocketServiceMock }))

const SNAPSHOT_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD'

function highlight(overrides: Partial<AnomalyHighlight> = {}): AnomalyHighlight {
  return {
    anomalyId: 'anom-1',
    cameraId: 'cam-1',
    cameraName: 'Acceso norte',
    type: 'intrusion',
    severity: 'HIGH',
    reasoning: 'Persona trepando el cerco perimetral',
    timestamp: new Date('2026-10-09T03:15:00.000Z'),
    ...overrides,
  }
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function emitHighlight(value: AnomalyHighlight): void {
  act(() => {
    socketState.handlers.forEach((handler) => handler(value))
  })
}

function httpError(status: number, data: unknown): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

beforeEach(() => {
  vi.clearAllMocks()
  socketState.handlers.clear()
  socketState.updateHandlers.clear()
  permissionsState.permissions = ['detections.read', 'condominium.view-all']
  permissionsState.isSuperAdmin = false
  apiMock.get.mockResolvedValue({ data: { id: 'anom-1', snapshotJpegB64: SNAPSHOT_B64 } })
})

describe('GlobalSecurityNotifications: security:anomaly_updated', () => {
  it('invalida el listado y el detalle de esa anomalía', () => {
    const { queryClient } = renderWithProviders(<GlobalSecurityNotifications />)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    act(() => {
      socketState.updateHandlers.forEach((handler) => handler({ anomalyId: 'anom-7' }))
    })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['anomalies'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['anomalies', 'detail', 'anom-7'] })
  })

  it('un aviso nuevo refresca el listado abierto', () => {
    const { queryClient } = renderWithProviders(<GlobalSecurityNotifications />)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    emitHighlight(highlight({ severity: 'LOW' }))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['anomalies', 'list'] })
  })

  it('deja de escuchar al desmontarse', () => {
    const { unmount } = renderWithProviders(<GlobalSecurityNotifications />)
    expect(socketState.updateHandlers.size).toBe(1)

    unmount()

    expect(socketState.updateHandlers.size).toBe(0)
  })

  it('sin los permisos de seguridad no escucha', () => {
    permissionsState.permissions = []
    renderWithProviders(<GlobalSecurityNotifications />)

    expect(webSocketServiceMock.onAnomalyUpdated).not.toHaveBeenCalled()
  })
})

describe('GlobalSecurityNotifications: montaje por permisos', () => {
  it.each<[string, string[]]>([
    ['sin permisos', []],
    ['solo detections.read (acotado a su familia)', ['detections.read']],
    ['solo condominium.view-all', ['condominium.view-all']],
  ])('%s: no se monta ni escucha el socket', (_case, permissions) => {
    permissionsState.permissions = permissions

    const { container } = renderWithProviders(<GlobalSecurityNotifications />)

    expect(container).toBeEmptyDOMElement()
    expect(webSocketServiceMock.onAnomalyHighlight).not.toHaveBeenCalled()
  })

  it('con detections.read + condominium.view-all escucha el aviso', () => {
    renderWithProviders(<GlobalSecurityNotifications />)

    expect(webSocketServiceMock.onAnomalyHighlight).toHaveBeenCalledTimes(1)
  })

  it.each<[string, string[]]>([
    ['sin permisos', []],
    ['aunque tenga detections.read + condominium.view-all', ['detections.read', 'condominium.view-all']],
  ])('el super-admin no se monta %s (el servidor no lo une a ninguna sala)', (_case, permissions) => {
    permissionsState.permissions = permissions
    permissionsState.isSuperAdmin = true

    const { container } = renderWithProviders(<GlobalSecurityNotifications />)

    expect(container).toBeEmptyDOMElement()
    expect(webSocketServiceMock.onAnomalyHighlight).not.toHaveBeenCalled()
  })

  it('deja de escuchar al desmontarse', () => {
    const { unmount } = renderWithProviders(<GlobalSecurityNotifications />)
    expect(socketState.handlers.size).toBe(1)

    unmount()

    expect(socketState.handlers.size).toBe(0)
  })
})

describe('GlobalSecurityNotifications: aviso y foto', () => {
  it('al llegar el aviso lo muestra y pide la foto por GET /anomalies/:id', async () => {
    renderWithProviders(<GlobalSecurityNotifications />)

    emitHighlight(highlight())

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Alerta crítica')).toBeInTheDocument()
    expect(screen.getByText('Intrusión en zona prohibida')).toBeInTheDocument()
    expect(screen.getByText('Acceso norte')).toBeInTheDocument()
    expect(screen.getByText('Persona trepando el cerco perimetral')).toBeInTheDocument()
    expect(apiMock.get).toHaveBeenCalledWith('/anomalies/anom-1')

    const photo = await screen.findByRole('img', { name: 'Captura de Acceso norte' })
    expect(photo).toHaveAttribute('src', `data:image/jpeg;base64,${SNAPSHOT_B64}`)
  })

  it('mientras llega la foto muestra un estado de carga', async () => {
    apiMock.get.mockReturnValue(new Promise(() => undefined))
    renderWithProviders(<GlobalSecurityNotifications />)

    emitHighlight(highlight())

    expect(await screen.findByRole('status')).toHaveTextContent('Cargando foto…')
  })

  it('si la foto falla, el aviso se muestra igual', async () => {
    apiMock.get.mockRejectedValue(httpError(403, { message: 'Forbidden' }))
    renderWithProviders(<GlobalSecurityNotifications />)

    emitHighlight(highlight())

    expect(await screen.findByText('No se pudo cargar la foto. Revísala en Trazabilidad.')).toBeInTheDocument()
    expect(screen.getByText('Alerta crítica')).toBeInTheDocument()
    expect(screen.getByText('Persona trepando el cerco perimetral')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('una anomalía sin foto muestra el aviso con "Sin foto disponible"', async () => {
    apiMock.get.mockResolvedValue({ data: { id: 'anom-1', snapshotJpegB64: null } })
    renderWithProviders(<GlobalSecurityNotifications />)

    emitHighlight(highlight({ severity: 'MEDIUM', type: 'loitering', cameraName: null }))

    expect(await screen.findByText('Sin foto disponible')).toBeInTheDocument()
    expect(screen.getByText('Actividad sospechosa')).toBeInTheDocument()
    expect(screen.getByText('Merodeo prolongado')).toBeInTheDocument()
    // Sin nombre de cámara se muestra su id.
    expect(screen.getByText('cam-1')).toBeInTheDocument()
  })

  it('el id de la anomalía va codificado en la URL', async () => {
    renderWithProviders(<GlobalSecurityNotifications />)

    emitHighlight(highlight({ anomalyId: '../users/1' }))

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/anomalies/..%2Fusers%2F1'))
  })

  it('un nivel bajo no abre el aviso ni pide la foto', () => {
    renderWithProviders(<GlobalSecurityNotifications />)

    emitHighlight(highlight({ severity: 'LOW' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('"Entendido" cierra el aviso', async () => {
    const user = userEvent.setup()
    renderWithProviders(<GlobalSecurityNotifications />)
    emitHighlight(highlight())

    await user.click(await screen.findByRole('button', { name: 'Entendido' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('"Ver detalle" cierra el aviso y lleva al detalle de la anomalía', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <GlobalSecurityNotifications />
        <LocationProbe />
      </>,
    )
    emitHighlight(highlight())

    await user.click(await screen.findByRole('button', { name: 'Ver detalle' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/traceability/anomalies/anom-1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
