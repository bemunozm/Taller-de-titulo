import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Camera, CondominiumOption } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { toast } from 'react-toastify'
import CamerasPanel from './CamerasPanel'

const CAMERA: Camera = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Estacionamiento 03',
  location: 'Subterráneo',
  mountPath: 'estacionamiento-03',
  active: true,
  enableLpr: true,
  enableGuardian: false,
  registeredInMediamtx: true,
  roles: [],
}

const OLD_URL = 'rtsp://usuario:clave@10.0.0.5/estacionamiento-03'
const NEW_URL = 'rtsp://usuario:clave@10.0.0.5/estacionamiento-03-hd'
const MASK = '••••••••'

const cameraApi = vi.hoisted(() => ({
  listCameras: vi.fn(),
  createCamera: vi.fn(),
  updateCamera: vi.fn(),
  deleteCamera: vi.fn(),
  registerCamera: vi.fn(),
  getCameraSourceUrl: vi.fn(),
  getCameraHasSource: vi.fn(),
  getIAHealth: vi.fn(),
  getMediamtxHealth: vi.fn(),
  enableCameraLpr: vi.fn(),
  enableCameraGuardian: vi.fn(),
  updateCameraGuardianZones: vi.fn(),
}))
vi.mock('@/api/CameraAPI', () => cameraApi)
vi.mock('@/api/RoleAPI', () => ({ listRoles: async () => [] }))
const onboardingApi = vi.hoisted(() => ({ listCondominiums: vi.fn(async () => [] as CondominiumOption[]) }))
vi.mock('@/api/OnboardingAPI', () => onboardingApi)
vi.mock('./ZoneEditor', () => ({ ZoneEditor: () => null }))
vi.mock('./LprSettingsDialog', () => ({ LprSettingsDialog: () => null }))
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const permissionsState = vi.hoisted(() => ({ permissions: [] as string[], isSuperAdmin: false }))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) => permissionsState.permissions.includes(permission),
    isSuperAdmin: permissionsState.isSuperAdmin,
    user: undefined,
    isLoading: false,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.isSuperAdmin = false
  permissionsState.permissions = ['cameras.read', 'cameras.update']
  cameraApi.listCameras.mockResolvedValue([CAMERA])
  cameraApi.getCameraHasSource.mockResolvedValue({ hasSource: true })
  cameraApi.getCameraSourceUrl.mockResolvedValue({ sourceUrl: OLD_URL })
  cameraApi.getIAHealth.mockResolvedValue({ ok: true, status: 'ok' })
  cameraApi.getMediamtxHealth.mockResolvedValue({ ok: true, status: 'ok' })
  cameraApi.updateCamera.mockResolvedValue(CAMERA)
})

async function openEditForm(user: ReturnType<typeof userEvent.setup>) {
  const view = renderWithProviders(<CamerasPanel />)
  await user.click(await screen.findByRole('button', { name: 'Más opciones' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Editar' }))
  await screen.findByRole('dialog')
  await waitFor(() => expect(urlInput()).toHaveValue(MASK))
  return view
}

function urlInput(): HTMLInputElement {
  return screen.getByPlaceholderText('URL RTSP') as HTMLInputElement
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  await waitFor(() => expect(cameraApi.updateCamera).toHaveBeenCalledTimes(1))
  const [id, payload] = cameraApi.updateCamera.mock.calls[0] as [string, Record<string, unknown>]
  expect(id).toBe(CAMERA.id)
  return payload
}

describe('CamerasPanel: editar la URL de la cámara', () => {
  it('revelar, modificar y guardar envía la URL nueva (no la vieja)', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    await user.click(screen.getByRole('button', { name: 'Mostrar URL' }))
    await waitFor(() => expect(urlInput()).toHaveValue(OLD_URL))
    // Tras revelar el campo es editable (antes quedaba congelado).
    await user.clear(urlInput())
    await user.paste(NEW_URL)
    expect(urlInput()).toHaveValue(NEW_URL)

    const payload = await save(user)
    expect(payload.sourceUrl).toBe(NEW_URL)
  })

  it('revelar y editar solo un tramo de la URL envía el resultado', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    await user.click(screen.getByRole('button', { name: 'Mostrar URL' }))
    await waitFor(() => expect(urlInput()).toHaveValue(OLD_URL))
    await user.type(urlInput(), '-hd')

    const payload = await save(user)
    expect(payload.sourceUrl).toBe(`${OLD_URL}-hd`)
  })

  it('escribir sin revelar reemplaza la máscara por lo escrito y lo envía', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    await user.type(urlInput(), 'rtsp://nueva')

    expect(urlInput()).toHaveValue('rtsp://nueva')
    expect(urlInput().value).not.toContain('•')
    const payload = await save(user)
    expect(payload.sourceUrl).toBe('rtsp://nueva')
    expect(cameraApi.getCameraSourceUrl).not.toHaveBeenCalled()
  })

  it('pegar sobre la máscara también la reemplaza', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    await user.click(urlInput())
    await user.paste(NEW_URL)

    expect(urlInput()).toHaveValue(NEW_URL)
    const payload = await save(user)
    expect(payload.sourceUrl).toBe(NEW_URL)
  })

  it('no tocar la URL guarda sin la clave sourceUrl (no se reenvía la vieja ni la máscara)', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    const payload = await save(user)

    expect(payload).not.toHaveProperty('sourceUrl')
  })

  it('revelar sin modificar tampoco reenvía la URL', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    await user.click(screen.getByRole('button', { name: 'Mostrar URL' }))
    await waitFor(() => expect(urlInput()).toHaveValue(OLD_URL))

    const payload = await save(user)
    expect(payload).not.toHaveProperty('sourceUrl')
  })

  it('vaciar el campo enmascarado lo deja vacío y no envía URL', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    await user.click(urlInput())
    await user.keyboard('{Backspace}')

    expect(urlInput()).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent(/se conservará la URL actual/)
    const payload = await save(user)
    expect(payload).not.toHaveProperty('sourceUrl')
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/se conserva la actual/))
  })

  it('con la máscara intacta explica cómo conservar o reemplazar y no avisa al guardar', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    expect(screen.getByRole('status')).toHaveTextContent(/conservar la URL actual/)
    await save(user)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('ocultar sin haber editado vuelve la máscara y no pierde nada', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    await user.click(screen.getByRole('button', { name: 'Mostrar URL' }))
    await waitFor(() => expect(urlInput()).toHaveValue(OLD_URL))
    await user.click(screen.getByRole('button', { name: 'Ocultar URL' }))

    expect(urlInput()).toHaveValue(MASK)
    // Volver a mostrarla no la pide de nuevo.
    await user.click(screen.getByRole('button', { name: 'Mostrar URL' }))
    expect(urlInput()).toHaveValue(OLD_URL)
    expect(cameraApi.getCameraSourceUrl).toHaveBeenCalledTimes(1)
  })

  it('ocultar después de editar conserva lo editado y vuelve a mostrar sin pisarlo', async () => {
    const user = userEvent.setup()
    await openEditForm(user)

    await user.click(screen.getByRole('button', { name: 'Mostrar URL' }))
    await waitFor(() => expect(urlInput()).toHaveValue(OLD_URL))
    await user.clear(urlInput())
    await user.paste(NEW_URL)
    await user.click(screen.getByRole('button', { name: 'Ocultar URL' }))
    expect(urlInput()).toHaveValue(NEW_URL)
    await user.click(screen.getByRole('button', { name: 'Mostrar URL' }))

    expect(urlInput()).toHaveValue(NEW_URL)
    const payload = await save(user)
    expect(payload.sourceUrl).toBe(NEW_URL)
  })

  it('sin cameras.update no hay botón de revelar, pero sí se puede reemplazar escribiendo', async () => {
    permissionsState.permissions = ['cameras.read']
    const user = userEvent.setup()
    await openEditForm(user)

    expect(screen.queryByRole('button', { name: 'Mostrar URL' })).not.toBeInTheDocument()
    await user.type(urlInput(), 'rtsp://nueva')

    expect(urlInput()).toHaveValue('rtsp://nueva')
    const payload = await save(user)
    expect(payload.sourceUrl).toBe('rtsp://nueva')
    expect(cameraApi.getCameraSourceUrl).not.toHaveBeenCalled()
  })

  it('una cámara nueva abierta después de editar otra no hereda la máscara', async () => {
    const user = userEvent.setup()
    const view = await openEditForm(user)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    view.rerender(<CamerasPanel triggerNew />)
    await screen.findByRole('dialog')

    expect(screen.getByRole('heading', { name: 'Nueva Cámara' })).toBeInTheDocument()
    expect(urlInput()).toHaveValue('')
  })
})
