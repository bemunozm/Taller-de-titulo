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
  updateCameraGuardianZones: vi.fn(),
}))
vi.mock('@/api/CameraAPI', () => cameraApi)

vi.mock('@/api/RoleAPI', () => ({ listRoles: async () => [] }))

// El selector de condominio (solo super-admin) pide la lista a la API.
const onboardingApi = vi.hoisted(() => ({ listCondominiums: vi.fn(async () => [] as CondominiumOption[]) }))
vi.mock('@/api/OnboardingAPI', () => onboardingApi)

// El lienzo de zonas monta un reproductor de video: se sustituye por un botón
// que "dibuja" ZONES y llama a onSave, como haría el editor real.
const ZONES = [
  [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
  ],
]
const GUARDIAN_ZONES = [{ points: ZONES[0], type: 'loitering' as const, loiterSeconds: 30 }]
const zoneEditorProps = vi.hoisted(() => ({
  last: null as null | { initialZones: unknown[]; initialZoneSettings?: unknown[]; tone?: string },
}))
vi.mock('./ZoneEditor', () => ({
  ZoneEditor: (props: {
    initialZones: unknown[]
    initialZoneSettings?: unknown[]
    tone?: string
    onSaveZones: (zones: unknown[]) => Promise<void>
    onClose: () => void
  }) => {
    zoneEditorProps.last = props
    return (
      <button
        type="button"
        onClick={() => {
          void props.onSaveZones(GUARDIAN_ZONES).then(props.onClose)
        }}
      >
        Guardar zonas (mock)
      </button>
    )
  },
}))

// El diálogo LPR tiene su propia suite: aquí solo se comprueba cómo se abre.
vi.mock('./LprSettingsDialog', () => ({
  LprSettingsDialog: (props: { canEdit: boolean; camera: { name: string } }) => (
    <div role="dialog" aria-label="Visión LPR (mock)">
      {props.camera.name} · {props.canEdit ? 'edita' : 'solo lectura'}
    </div>
  ),
}))

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

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<CamerasPanel />)
  await user.click(await screen.findByRole('button', { name: 'Más opciones' }))
}

describe('CamerasPanel: zonas del Guardián', () => {
  beforeEach(() => {
    permissionsState.permissions = ['cameras.read', 'cameras.update']
    cameraApi.updateCameraGuardianZones.mockResolvedValue(undefined)
  })

  it('guarda con PATCH /cameras/:id/zones vía CameraAPI y refresca la lista', async () => {
    cameraApi.listCameras.mockResolvedValue([{ ...CAMERA, guardianZones: ZONES }])
    const user = userEvent.setup()
    await openMenu(user)

    await user.click(await screen.findByRole('menuitem', { name: 'Configurar Zonas Alarmas' }))
    await user.click(await screen.findByRole('button', { name: 'Guardar zonas (mock)' }))

    await waitFor(() => expect(cameraApi.updateCameraGuardianZones).toHaveBeenCalledWith(CAMERA.id, GUARDIAN_ZONES))
    expect(zoneEditorProps.last).toMatchObject({ tone: 'guardian', initialZones: ZONES })
    // Tras guardar se vuelve a pedir la lista de cámaras.
    await waitFor(() => expect(cameraApi.listCameras.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Guardar zonas (mock)' })).not.toBeInTheDocument())
  })

  it('abre el editor con zonas LEGACY ([[{x,y}]]) como intrusión', async () => {
    cameraApi.listCameras.mockResolvedValue([{ ...CAMERA, guardianZones: ZONES }])
    const user = userEvent.setup()
    await openMenu(user)

    await user.click(await screen.findByRole('menuitem', { name: 'Configurar Zonas Alarmas' }))
    await screen.findByRole('button', { name: 'Guardar zonas (mock)' })

    expect(zoneEditorProps.last?.initialZones).toEqual(ZONES)
    expect(zoneEditorProps.last?.initialZoneSettings).toEqual([{ points: ZONES[0], type: 'intrusion' }])
  })

  it('abre el editor con zonas en el formato nuevo conservando tipo y segundos', async () => {
    cameraApi.listCameras.mockResolvedValue([
      {
        ...CAMERA,
        guardianZones: [
          { points: ZONES[0], type: 'intrusion' },
          { points: ZONES[0], type: 'loitering', loiterSeconds: 45 },
        ],
      },
    ])
    const user = userEvent.setup()
    await openMenu(user)

    await user.click(await screen.findByRole('menuitem', { name: 'Configurar Zonas Alarmas' }))
    await screen.findByRole('button', { name: 'Guardar zonas (mock)' })

    expect(zoneEditorProps.last?.initialZones).toEqual([ZONES[0], ZONES[0]])
    expect(zoneEditorProps.last?.initialZoneSettings).toEqual([
      { points: ZONES[0], type: 'intrusion' },
      { points: ZONES[0], type: 'loitering', loiterSeconds: 45 },
    ])
  })

  it('una cámara sin zonas abre el editor vacío', async () => {
    const user = userEvent.setup()
    await openMenu(user)

    await user.click(await screen.findByRole('menuitem', { name: 'Configurar Zonas Alarmas' }))
    await screen.findByRole('button', { name: 'Guardar zonas (mock)' })

    expect(zoneEditorProps.last?.initialZones).toEqual([])
  })
})

describe('CamerasPanel: visión LPR', () => {
  it('con cameras.enable-ia ofrece "Configurar LPR" y abre el diálogo editable', async () => {
    permissionsState.permissions = ['cameras.read', 'cameras.enable-ia']
    const user = userEvent.setup()
    await openMenu(user)

    await user.click(await screen.findByRole('menuitem', { name: 'Configurar LPR' }))

    expect(await screen.findByRole('dialog', { name: 'Visión LPR (mock)' })).toHaveTextContent('Portón principal · edita')
  })

  it('sin cameras.enable-ia solo ofrece verla (solo lectura)', async () => {
    permissionsState.permissions = ['cameras.read']
    const user = userEvent.setup()
    await openMenu(user)

    expect(screen.queryByRole('menuitem', { name: 'Configurar LPR' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'Ver configuración LPR' }))

    expect(await screen.findByRole('dialog', { name: 'Visión LPR (mock)' })).toHaveTextContent('solo lectura')
  })

  it('el super-admin edita aunque no tenga el permiso listado', async () => {
    permissionsState.permissions = ['cameras.read']
    permissionsState.isSuperAdmin = true
    const user = userEvent.setup()
    await openMenu(user)

    await user.click(await screen.findByRole('menuitem', { name: 'Configurar LPR' }))

    expect(await screen.findByRole('dialog', { name: 'Visión LPR (mock)' })).toHaveTextContent('edita')
  })

  it('una cámara sin LPR habilitado no muestra la configuración LPR', async () => {
    permissionsState.permissions = ['cameras.read', 'cameras.enable-ia']
    cameraApi.listCameras.mockResolvedValue([{ ...CAMERA, enableLpr: false }])
    const user = userEvent.setup()
    await openMenu(user)

    await screen.findByRole('menuitem', { name: 'Habilitar LPR' })
    expect(screen.queryByRole('menuitem', { name: 'Configurar LPR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Ver configuración LPR' })).not.toBeInTheDocument()
  })
})
