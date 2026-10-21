import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test/renderWithProviders'
import { QRScanner } from './QRScanner'

const SCANNED_QR = 'qr-credencial-secreta-123'
const SCANNING = 2 // Html5QrcodeScannerState.SCANNING

// Sin cámara en jsdom: el mock captura el callback de lectura para dispararlo.
const scanner = vi.hoisted(() => {
  let onDecoded: ((decodedText: string) => void) | undefined
  return {
    getCameras: vi.fn(async () => [{ id: 'cam-trasera', label: 'Back camera' }]),
    start: vi.fn(
      async (_cameraId: string, _config: unknown, onSuccess: (decodedText: string) => void) => {
        onDecoded = onSuccess
      },
    ),
    stop: vi.fn(async (): Promise<void> => undefined),
    clear: vi.fn(),
    getState: vi.fn(() => 2),
    decode(text: string) {
      onDecoded?.(text)
    },
  }
})

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    static getCameras = scanner.getCameras
    start = scanner.start
    stop = scanner.stop
    clear = scanner.clear
    getState = scanner.getState
  },
}))

const CONSOLE_METHODS = ['log', 'info', 'debug', 'warn', 'error', 'trace'] as const
let consoleSpies: MockInstance[] = []

beforeEach(() => {
  vi.clearAllMocks()
  scanner.getState.mockReturnValue(SCANNING)
  consoleSpies = CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  )
})

afterEach(() => {
  // Ninguna vía del escáner (lectura, errores, limpieza) escribe en consola.
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled()
  }
})

const READY_HINT = /Coloca el código QR dentro del área marcada/

describe('QRScanner', () => {
  it('entrega el QR a onScan una sola vez y no lo escribe en consola', async () => {
    const onScan = vi.fn()
    renderWithProviders(<QRScanner onScan={onScan} isScanning />)

    // La cámara arrancó con la cámara trasera.
    await screen.findByText(READY_HINT)
    expect(scanner.start).toHaveBeenCalledWith(
      'cam-trasera',
      expect.anything(),
      expect.any(Function),
      expect.any(Function),
    )

    scanner.decode(SCANNED_QR)
    scanner.decode(SCANNED_QR)

    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith(SCANNED_QR)

    // Tras la lectura el escáner se detiene solo.
    await waitFor(() => expect(screen.queryByText(READY_HINT)).not.toBeInTheDocument())
    expect(scanner.stop).toHaveBeenCalled()
  })

  it('usa el onScan más reciente sin reiniciar la cámara', async () => {
    const firstOnScan = vi.fn()
    const latestOnScan = vi.fn()
    const { rerender } = renderWithProviders(<QRScanner onScan={firstOnScan} isScanning />)
    await screen.findByText(READY_HINT)

    rerender(<QRScanner onScan={latestOnScan} isScanning />)
    scanner.decode(SCANNED_QR)

    expect(scanner.start).toHaveBeenCalledTimes(1)
    expect(firstOnScan).not.toHaveBeenCalled()
    expect(latestOnScan).toHaveBeenCalledWith(SCANNED_QR)
    await waitFor(() => expect(screen.queryByText(READY_HINT)).not.toBeInTheDocument())
  })

  it('si la cámara no arranca, lo informa por onError y en pantalla, sin consola', async () => {
    scanner.start.mockRejectedValueOnce(new Error('NotAllowedError: Permission denied'))
    const onError = vi.fn()
    renderWithProviders(<QRScanner onScan={vi.fn()} onError={onError} isScanning />)

    expect(await screen.findByText('Error al iniciar la cámara')).toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith('Error al iniciar la cámara')
  })

  it('si no hay acceso a las cámaras, lo informa por onError, sin consola', async () => {
    scanner.getCameras.mockRejectedValueOnce(new Error('NotAllowedError'))
    const onError = vi.fn()
    renderWithProviders(<QRScanner onScan={vi.fn()} onError={onError} isScanning />)

    expect(await screen.findByText('Error al acceder a las cámaras')).toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith('Error al acceder a las cámaras')
  })
})
