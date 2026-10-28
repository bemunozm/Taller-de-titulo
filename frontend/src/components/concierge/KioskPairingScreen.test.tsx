import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { KIOSK_REQUEST_TIMEOUT_MS } from '@/api/ConciergeAPI'
import { KIOSK_CREDENTIAL_STORAGE_KEY, kioskCredentialStore } from '@/services/kioskCredentialStore'
import { KioskPairingScreen } from './KioskPairingScreen'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const HUB_ID = 'hub-kiosk-1'
const HUB_SECRET = 'kiosk-secret-123'

function httpError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data: {} }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

async function submitCredential(hubId = HUB_ID, hubSecret = HUB_SECRET) {
  const user = userEvent.setup()
  render(<KioskPairingScreen />)

  await user.type(screen.getByLabelText('ID del dispositivo'), hubId)
  await user.type(screen.getByLabelText('Secreto del dispositivo'), hubSecret)
  await user.click(screen.getByRole('button', { name: /Emparejar kiosko/ }))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  kioskCredentialStore.clear()
})

describe('KioskPairingScreen', () => {
  it('el secreto se ingresa en un campo de tipo password', () => {
    render(<KioskPairingScreen />)

    expect(screen.getByLabelText('Secreto del dispositivo')).toHaveAttribute('type', 'password')
  })

  it('guarda la credencial solo con 200 + type web-kiosk', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { hubId: HUB_ID, type: 'web-kiosk', organizationId: 'org-1' } })

    await submitCredential()

    expect(apiMock.get).toHaveBeenCalledWith('/concierge/device', {
      headers: { 'X-Hub-Id': HUB_ID, 'X-Hub-Secret': HUB_SECRET },
      withCredentials: false,
      timeout: KIOSK_REQUEST_TIMEOUT_MS,
    })
    expect(kioskCredentialStore.get()).toEqual({ hubId: HUB_ID, hubSecret: HUB_SECRET })
    expect(window.localStorage.getItem(KIOSK_CREDENTIAL_STORAGE_KEY)).not.toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rechaza un physical-hub: muestra el error y no guarda', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { hubId: HUB_ID, type: 'physical-hub', organizationId: 'org-1' } })

    await submitCredential()

    expect(await screen.findByRole('alert')).toHaveTextContent(/hub físico/)
    expect(kioskCredentialStore.get()).toBeNull()
    expect(window.localStorage.getItem(KIOSK_CREDENTIAL_STORAGE_KEY)).toBeNull()
    expect(screen.getByRole('button', { name: /Emparejar kiosko/ })).toBeEnabled()
  })

  it('un 401 muestra error de credencial y no guarda', async () => {
    apiMock.get.mockRejectedValueOnce(httpError(401))

    await submitCredential()

    expect(await screen.findByRole('alert')).toHaveTextContent('Credencial inválida')
    expect(kioskCredentialStore.get()).toBeNull()
    expect(window.localStorage.getItem(KIOSK_CREDENTIAL_STORAGE_KEY)).toBeNull()
  })

  it('no guarda si el servidor identifica otro hub', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { hubId: 'otro-hub', type: 'web-kiosk', organizationId: 'org-1' } })

    await submitCredential()

    expect(await screen.findByRole('alert')).toHaveTextContent(/otro dispositivo/)
    expect(kioskCredentialStore.get()).toBeNull()
  })

  it('sin datos no llama al backend', async () => {
    const user = userEvent.setup()
    render(<KioskPairingScreen />)

    await user.click(screen.getByRole('button', { name: /Emparejar kiosko/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa el ID del dispositivo y su secreto.')
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  it('explica que la credencial anterior fue rechazada (401) al volver a esta pantalla', () => {
    kioskCredentialStore.save({ hubId: HUB_ID, hubSecret: HUB_SECRET })
    kioskCredentialStore.clear('unauthorized')

    render(<KioskPairingScreen />)

    expect(screen.getByText(/El servidor rechazó la credencial guardada/)).toBeInTheDocument()
  })
})
