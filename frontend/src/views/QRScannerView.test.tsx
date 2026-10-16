import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Visit } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { QRScannerView } from './QRScannerView'

// Hoisted: lo usa la factory del mock de QRScanner, que corre antes que el módulo.
const { SCANNED_QR } = vi.hoisted(() => ({ SCANNED_QR: 'qr-credencial-secreta-123' }))

const visitApi = vi.hoisted(() => ({
  getVisitByQRCode: vi.fn<(qrCode: string) => Promise<Visit>>(),
  checkInVisit: vi.fn<(id: string) => Promise<Visit>>(),
  checkOutVisit: vi.fn<(id: string) => Promise<Visit>>(),
}))
vi.mock('@/api/VisitAPI', () => visitApi)

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

// Sin cámara en jsdom: el escáner se reemplaza por un botón que "lee" el QR.
vi.mock('@/components/visits/QRScanner', () => ({
  QRScanner: ({ onScan }: { onScan: (data: string) => void }) => (
    <button type="button" onClick={() => onScan(SCANNED_QR)}>
      Simular escaneo
    </button>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const HOUR_MS = 60 * 60 * 1000

// Ventana relativa al reloj real: la vista evalúa la validez con `new Date()`.
function makeVisit(overrides: Partial<Visit>): Visit {
  const now = Date.now()
  return {
    id: '00000000-0000-4000-8000-000000000000',
    type: 'pedestrian',
    status: 'pending',
    visitorName: 'Visitante',
    usedCount: 0,
    maxUses: null,
    qrCode: SCANNED_QR,
    validFrom: new Date(now - HOUR_MS),
    validUntil: new Date(now + HOUR_MS),
    createdAt: new Date(now - 2 * HOUR_MS),
    updatedAt: new Date(now - 2 * HOUR_MS),
    ...overrides,
  }
}

async function scan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Iniciar Escaneo/ }))
  await user.click(screen.getByRole('button', { name: 'Simular escaneo' }))
  await screen.findByRole('heading', { name: 'Visita Encontrada' })
}

describe('QRScannerView', () => {
  it('una solicitud awaiting_approval no ofrece entrada ni salida y explica por qué', async () => {
    visitApi.getVisitByQRCode.mockResolvedValue(
      makeVisit({
        status: 'awaiting_approval',
        type: 'vehicular',
        vehicle: null,
        requestedPlate: 'WXYZ34',
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<QRScannerView />)

    await scan(user)

    expect(screen.getByRole('alert')).toHaveTextContent('La visita aún no fue aprobada por el residente')
    expect(screen.queryByRole('button', { name: /Registrar Entrada/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Registrar Salida/ })).not.toBeInTheDocument()
    expect(screen.getByText('No hay acciones disponibles para esta visita')).toBeInTheDocument()
    // La patente solicitada se muestra aunque aún no exista el vehículo.
    expect(screen.getByText('WXYZ34')).toBeInTheDocument()
  })

  it('no imprime el QR escaneado (credencial) en la consola', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    visitApi.getVisitByQRCode.mockResolvedValue(makeVisit({}))
    const user = userEvent.setup()
    renderWithProviders(<QRScannerView />)

    await scan(user)

    expect(visitApi.getVisitByQRCode).toHaveBeenCalledWith(SCANNED_QR)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('active con maxUses=1 consumido: no avisa máximo de usos y permite la salida', async () => {
    visitApi.getVisitByQRCode.mockResolvedValue(makeVisit({ status: 'active', maxUses: 1, usedCount: 1 }))
    const user = userEvent.setup()
    renderWithProviders(<QRScannerView />)

    await scan(user)

    expect(screen.queryByText(/máximo de usos/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Registrar Salida/ })).toBeEnabled()
  })

  it('un 409 en el check-in muestra el mensaje del backend tal cual y refresca la visita', async () => {
    const backendMessage = 'No se puede registrar la entrada: la visita está activa'
    visitApi.getVisitByQRCode.mockResolvedValue(makeVisit({ visitorName: 'Gabriel Pendiente' }))
    visitApi.checkInVisit.mockRejectedValueOnce(new Error(backendMessage))
    const user = userEvent.setup()
    renderWithProviders(<QRScannerView />)

    await scan(user)
    await user.click(screen.getByRole('button', { name: /Registrar Entrada/ }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(backendMessage))
    expect(toastMock.success).not.toHaveBeenCalled()
    // La vista vuelve a pedir la visita para reflejar su estado real.
    await waitFor(() => expect(visitApi.getVisitByQRCode).toHaveBeenCalledTimes(2))
  })
})
