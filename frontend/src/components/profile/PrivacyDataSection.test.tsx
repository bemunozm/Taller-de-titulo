import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { renderWithProviders } from '@/test/renderWithProviders'
import { DATA_EXPORT_RATE_LIMIT_MESSAGE, defaultDataExportFilename } from '@/api/PrivacyAPI'
import { DATA_EXPORT_CONTENTS } from '@/helpers/privacyPolicy'
import { PrivacyDataSection } from './PrivacyDataSection'

const apiMock = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const EXPORT = {
  generatedAt: '2026-10-09T12:00:00.000Z',
  user: { id: 'u-1', name: 'Ana Residente', email: 'ana@example.com' },
  family: { id: 'f-1', name: 'Familia Residente' },
  vehicles: [{ plate: 'ABCD12' }],
  visitsHosted: [],
  notifications: [],
}

function httpError(status: number, data: unknown = {}): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

interface ClickedLink {
  href: string
  download: string
}

const createdBlobs: Blob[] = []
const clickedLinks: ClickedLink[] = []

/** Lee un Blob sin depender de `Blob.text()` (no en todas las versiones de jsdom). */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  createdBlobs.length = 0
  clickedLinks.length = 0
  // jsdom no implementa URL.createObjectURL ni la navegación de un <a download>.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((blob: Blob) => {
      createdBlobs.push(blob)
      return 'blob:vigilia/export-1'
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clickedLinks.push({ href: this.href, download: this.download })
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('PrivacyDataSection: "Descargar mis datos"', () => {
  it('llama al endpoint y descarga el JSON con el nombre del Content-Disposition', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: EXPORT,
      status: 200,
      headers: { 'content-disposition': 'attachment; filename="vigilia-mis-datos-2026-10-09.json"' },
    })
    const user = userEvent.setup()
    renderWithProviders(<PrivacyDataSection />)

    await user.click(screen.getByRole('button', { name: 'Descargar mis datos' }))

    expect(await screen.findByRole('status')).toHaveTextContent('vigilia-mis-datos-2026-10-09.json')
    expect(apiMock.get).toHaveBeenCalledTimes(1)
    expect(apiMock.get).toHaveBeenCalledWith('/auth/me/data-export')
    expect(clickedLinks).toEqual([{ href: 'blob:vigilia/export-1', download: 'vigilia-mis-datos-2026-10-09.json' }])
    // El archivo es el JSON que entregó el backend, sin recortar campos.
    expect(createdBlobs).toHaveLength(1)
    expect(createdBlobs[0].type).toBe('application/json')
    expect(JSON.parse(await readBlob(createdBlobs[0]))).toEqual(EXPORT)
    // El <a> temporal no queda en el documento.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('sin Content-Disposition legible usa el nombre por defecto con la fecha de hoy', async () => {
    apiMock.get.mockResolvedValueOnce({ data: EXPORT, status: 200, headers: {} })
    const user = userEvent.setup()
    renderWithProviders(<PrivacyDataSection />)

    await user.click(screen.getByRole('button', { name: 'Descargar mis datos' }))

    await waitFor(() => expect(clickedLinks).toHaveLength(1))
    expect(clickedLinks[0].download).toBe(defaultDataExportFilename(new Date()))
    expect(clickedLinks[0].download).toMatch(/^vigilia-mis-datos-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('429: explica el límite de descargas y no descarga nada', async () => {
    apiMock.get.mockRejectedValueOnce(httpError(429, { message: 'ThrottlerException: Too Many Requests' }))
    const user = userEvent.setup()
    renderWithProviders(<PrivacyDataSection />)

    await user.click(screen.getByRole('button', { name: 'Descargar mis datos' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(DATA_EXPORT_RATE_LIMIT_MESSAGE)
    expect(screen.queryByText(/ThrottlerException|status code 429/)).not.toBeInTheDocument()
    expect(clickedLinks).toHaveLength(0)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Descargar mis datos' })).toBeEnabled()
  })

  it('otro error: muestra el mensaje del backend o uno claro por defecto', async () => {
    apiMock.get.mockRejectedValueOnce(httpError(500, {}))
    const user = userEvent.setup()
    renderWithProviders(<PrivacyDataSection />)

    await user.click(screen.getByRole('button', { name: 'Descargar mis datos' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron descargar tus datos')
    expect(clickedLinks).toHaveLength(0)
  })

  it('una respuesta que no es un objeto JSON no se descarga', async () => {
    apiMock.get.mockResolvedValueOnce({ data: '<html>proxy</html>', status: 200, headers: {} })
    const user = userEvent.setup()
    renderWithProviders(<PrivacyDataSection />)

    await user.click(screen.getByRole('button', { name: 'Descargar mis datos' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('respuesta inesperada')
    expect(clickedLinks).toHaveLength(0)
  })

  it('enlaza la política y muestra el correo de contacto configurado', () => {
    vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'privacidad@sanlorenzo.cl')
    renderWithProviders(<PrivacyDataSection />)

    // Qué incluye la descarga y que el resto se pide por correo.
    for (const item of DATA_EXPORT_CONTENTS) {
      expect(screen.getByText(item)).toBeInTheDocument()
    }
    expect(screen.getByText(/No incluye registros de acceso/)).toHaveTextContent('se piden por correo')

    expect(screen.getByRole('link', { name: 'Leer la política de privacidad' })).toHaveAttribute(
      'href',
      '/privacy-policy#derechos',
    )
    expect(screen.getByRole('link', { name: 'privacidad@sanlorenzo.cl' })).toHaveAttribute(
      'href',
      'mailto:privacidad@sanlorenzo.cl',
    )
  })
})
