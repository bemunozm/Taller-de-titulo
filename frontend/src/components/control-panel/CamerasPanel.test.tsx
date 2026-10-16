import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Camera, CondominiumOption } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import CamerasPanel from './CamerasPanel'

const CAMERA: Camera = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Portón principal',
  location: 'Acceso norte',
  mountPath: 'cam-porton',
  active: true,
  enableLpr: true,
  enableGuardian: false,
  registeredInMediamtx: true,
  roles: [],
}

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
}))
vi.mock('@/api/CameraAPI', () => cameraApi)

vi.mock('@/api/RoleAPI', () => ({ listRoles: async () => [] }))

// El selector de condominio (solo super-admin) pide la lista a la API.
const onboardingApi = vi.hoisted(() => ({ listCondominiums: vi.fn(async () => [] as CondominiumOption[]) }))
vi.mock('@/api/OnboardingAPI', () => onboardingApi)

// El editor de zonas monta un reproductor de video: fuera de estos tests.
vi.mock('./GuardianZoneEditor', () => ({ default: () => null }))

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

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
  cameraApi.listCameras.mockResolvedValue([CAMERA])
  cameraApi.getCameraHasSource.mockResolvedValue({ hasSource: true })
  cameraApi.getCameraSourceUrl.mockResolvedValue({ sourceUrl: 'rtsp://usuario:clave@10.0.0.5/stream' })
  cameraApi.getIAHealth.mockResolvedValue({ ok: true, status: 'ok' })
  cameraApi.getMediamtxHealth.mockResolvedValue({ ok: true, status: 'ok' })
})

async function openEditForm(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<CamerasPanel />)
  await user.click(await screen.findByRole('button', { name: 'Más opciones' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Editar' }))
  await screen.findByRole('dialog')
  // La URL existe pero está enmascarada.
  await waitFor(() => expect(screen.getByPlaceholderText('URL RTSP')).toHaveValue('••••••••'))
}

describe('CamerasPanel: revelar la URL de la cámara', () => {
  it('sin cameras.update no ofrece revelarla (GET /cameras/:id/source daría 403)', async () => {
    permissionsState.permissions = ['cameras.read']
    const user = userEvent.setup()

    await openEditForm(user)

    expect(screen.queryByRole('button', { name: 'Mostrar URL' })).not.toBeInTheDocument()
    expect(cameraApi.getCameraSourceUrl).not.toHaveBeenCalled()
  })

  it('con cameras.update la revela al pedirla (control positivo)', async () => {
    permissionsState.permissions = ['cameras.read', 'cameras.update']
    const user = userEvent.setup()

    await openEditForm(user)
    await user.click(screen.getByRole('button', { name: 'Mostrar URL' }))

    await waitFor(() =>
      expect(screen.getByPlaceholderText('URL RTSP')).toHaveValue('rtsp://usuario:clave@10.0.0.5/stream'),
    )
    expect(cameraApi.getCameraSourceUrl).toHaveBeenCalledWith(CAMERA.id)
  })
})

describe('CamerasPanel: condominio de una cámara nueva', () => {
  const ORG: CondominiumOption = { id: '22222222-2222-4222-8222-222222222222', name: 'Condominio San Lorenzo', slug: 'sl' }

  beforeEach(() => {
    permissionsState.permissions = ['cameras.read', 'cameras.create', 'cameras.update']
    onboardingApi.listCondominiums.mockResolvedValue([ORG])
    cameraApi.createCamera.mockResolvedValue(CAMERA)
    cameraApi.updateCamera.mockResolvedValue(CAMERA)
  })

  async function fillNewCamera(user: ReturnType<typeof userEvent.setup>) {
    renderWithProviders(<CamerasPanel triggerNew />)
    await screen.findByRole('dialog')
    await user.type(screen.getByPlaceholderText('Nombre de la cámara'), 'Acceso sur')
    await user.type(screen.getByPlaceholderText('URL RTSP'), 'rtsp://10.0.0.9/stream')
  }

  it('super-admin: lo exige y lo envía en POST /cameras', async () => {
    permissionsState.isSuperAdmin = true
    const user = userEvent.setup()
    await fillNewCamera(user)

    await user.click(screen.getByRole('button', { name: 'Crear cámara' }))
    expect(await screen.findByText('Selecciona el condominio')).toBeInTheDocument()
    expect(cameraApi.createCamera).not.toHaveBeenCalled()

    await screen.findByRole('option', { name: ORG.name })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condominio *' }), ORG.id)
    await user.click(screen.getByRole('button', { name: 'Crear cámara' }))

    await waitFor(() => expect(cameraApi.createCamera).toHaveBeenCalledTimes(1))
    expect(cameraApi.createCamera.mock.calls[0]?.[0]).toMatchObject({
      name: 'Acceso sur',
      sourceUrl: 'rtsp://10.0.0.9/stream',
      organizationId: ORG.id,
    })
  })

  it('otro actor: sin selector y sin organizationId', async () => {
    const user = userEvent.setup()
    await fillNewCamera(user)

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Crear cámara' }))

    await waitFor(() => expect(cameraApi.createCamera).toHaveBeenCalledTimes(1))
    expect(cameraApi.createCamera.mock.calls[0]?.[0]).not.toHaveProperty('organizationId')
  })

  it('super-admin editando: PATCH sin organizationId (daría 400)', async () => {
    permissionsState.isSuperAdmin = true
    const user = userEvent.setup()
    await openEditForm(user)

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(cameraApi.updateCamera).toHaveBeenCalledTimes(1))
    expect(cameraApi.updateCamera.mock.calls[0]?.[0]).toBe(CAMERA.id)
    expect(cameraApi.updateCamera.mock.calls[0]?.[1]).not.toHaveProperty('organizationId')
  })
})

describe('CamerasPanel: salud del motor IA (GET /workers/ia-health)', () => {
  it('tolera `details: null` (no super-admin con el manager caído)', async () => {
    cameraApi.getIAHealth.mockResolvedValue({ ok: false, status: 'manager no disponible', details: null })
    renderWithProviders(<CamerasPanel />)

    expect(await screen.findByText('manager no disponible')).toBeInTheDocument()
    expect(screen.getByText('Motor IA (Análisis Visual)')).toBeInTheDocument()
  })

  it('tolera `details.workers` acotado al condominio', async () => {
    cameraApi.getIAHealth.mockResolvedValue({ ok: true, status: 'ok', details: { workers: [] } })
    // MediaMTX caído: así el único "Activo" es el del motor IA.
    cameraApi.getMediamtxHealth.mockResolvedValue({ ok: false, status: 'mtx caído' })
    renderWithProviders(<CamerasPanel />)

    expect(await screen.findByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('mtx caído')).toBeInTheDocument()
  })
})
