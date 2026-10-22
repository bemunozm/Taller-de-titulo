import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'react-toastify'
import { ApiError } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { CameraLprSettingsResponse, LprSettings } from '@/types/index'
import { LprSettingsDialog } from './LprSettingsDialog'

const CAMERA = { id: '11111111-1111-4111-8111-111111111111', name: 'Portón HD', mountPath: 'porton-hd' }

const ZONE = [
  [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
  ],
]

const cameraApi = vi.hoisted(() => ({
  getCameraLprSettings: vi.fn(),
  updateCameraLprSettings: vi.fn(),
  resetCameraLprSettings: vi.fn(),
}))
vi.mock('@/api/CameraAPI', () => cameraApi)

// El lienzo monta un reproductor de video: se sustituye por un botón que "dibuja" ZONE.
vi.mock('./ZoneEditor', () => ({
  ZoneEditor: (props: {
    initialZones: unknown[]
    onSave: (zones: unknown[]) => Promise<void>
    onClose: () => void
  }) => (
    <div role="dialog" aria-label="Editor de zonas">
      <span>zonas iniciales: {props.initialZones.length}</span>
      <button
        type="button"
        onClick={() => {
          void props.onSave(ZONE).then(props.onClose)
        }}
      >
        Dibujar zona (mock)
      </button>
    </div>
  ),
}))

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

function response(lprSettings: LprSettings | null): CameraLprSettingsResponse {
  return { id: CAMERA.id, name: CAMERA.name, enableLpr: true, lprSettings }
}

const FULL_SETTINGS: LprSettings = {
  action: 'register',
  direction: 'both',
  zone: ZONE,
  detectorImgsz: 1920,
  sampleFps: 8,
  crop: { minWidth: 60, maxWidth: 250, minRatio: 0.8, maxRatio: 6 },
  confirmReads: 3,
}

async function renderDialog(settings: LprSettings | null, canEdit = true) {
  cameraApi.getCameraLprSettings.mockResolvedValue(response(settings))
  const onClose = vi.fn()
  const view = renderWithProviders(<LprSettingsDialog camera={CAMERA} canEdit={canEdit} onClose={onClose} />)
  await screen.findByLabelText('Modo')
  return { ...view, onClose, user: userEvent.setup() }
}

function lastSavedPayload(): LprSettings {
  const call = cameraApi.updateCameraLprSettings.mock.calls.at(-1)
  expect(call?.[0]).toBe(CAMERA.id)
  return call?.[1] as LprSettings
}

beforeEach(() => {
  vi.clearAllMocks()
  cameraApi.updateCameraLprSettings.mockResolvedValue(response(null))
  cameraApi.resetCameraLprSettings.mockResolvedValue(response(null))
})

describe('LprSettingsDialog: carga', () => {
  it('pide la configuración de la cámara y la muestra en el formulario', async () => {
    await renderDialog(FULL_SETTINGS)

    expect(cameraApi.getCameraLprSettings).toHaveBeenCalledWith(CAMERA.id)
    expect(screen.getByLabelText('Modo')).toHaveValue('register')
    expect(screen.getByLabelText('Dirección')).toHaveValue('both')
    expect(screen.getByLabelText('Resolución del detector')).toHaveValue('1920')
    expect(screen.getByLabelText('FPS de muestreo')).toHaveValue(8)
    expect(screen.getByLabelText('Ancho mínimo (px)')).toHaveValue(60)
    expect(screen.getByLabelText('Ancho máximo (px)')).toHaveValue(250)
    expect(screen.getByLabelText('Relación mínima (ancho/alto)')).toHaveValue(0.8)
    expect(screen.getByLabelText('Relación máxima (ancho/alto)')).toHaveValue(6)
    expect(screen.getByLabelText('Lecturas para confirmar')).toHaveValue(3)
    expect(screen.getByText(/1 zona definida/)).toBeInTheDocument()
  })

  it('sin configuración (null) muestra control de acceso y los campos vacíos con su default', async () => {
    await renderDialog(null)

    expect(screen.getByLabelText('Modo')).toHaveValue('access')
    expect(screen.getByLabelText('Dirección')).toHaveValue('')
    expect(screen.getByLabelText('FPS de muestreo')).toHaveValue(null)
    expect(screen.getByLabelText('FPS de muestreo')).toHaveAttribute('placeholder', '1')
    expect(screen.getByLabelText('Lecturas para confirmar')).toHaveAttribute('placeholder', '3')
    expect(screen.getByText(/Sin zona/)).toBeInTheDocument()
  })

  it('explica que "Solo registrar" nunca abre el portón', async () => {
    const { user } = await renderDialog(null)

    await user.selectOptions(screen.getByLabelText('Modo'), 'register')

    expect(screen.getByText(/nunca abre el portón ni escala al conserje/)).toBeInTheDocument()
  })

  it('si la carga falla muestra el error y permite reintentar', async () => {
    cameraApi.getCameraLprSettings.mockRejectedValueOnce(new ApiError('Cámara inexistente', 404))
    const user = userEvent.setup()
    renderWithProviders(<LprSettingsDialog camera={CAMERA} canEdit onClose={vi.fn()} />)

    expect(await screen.findByText('Cámara inexistente')).toBeInTheDocument()
    cameraApi.getCameraLprSettings.mockResolvedValue(response(null))
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByLabelText('Modo')).toBeInTheDocument()
  })
})

describe('LprSettingsDialog: guardado', () => {
  it('envía el objeto completo con los valores editados', async () => {
    const { user, onClose } = await renderDialog(null)

    await user.selectOptions(screen.getByLabelText('Modo'), 'register')
    await user.selectOptions(screen.getByLabelText('Dirección'), 'both')
    await user.selectOptions(screen.getByLabelText('Resolución del detector'), '1920')
    await user.type(screen.getByLabelText('FPS de muestreo'), '8')
    await user.type(screen.getByLabelText('Ancho mínimo (px)'), '60')
    await user.type(screen.getByLabelText('Ancho máximo (px)'), '250')
    await user.type(screen.getByLabelText('Relación mínima (ancho/alto)'), '0.8')
    await user.type(screen.getByLabelText('Relación máxima (ancho/alto)'), '6')
    await user.type(screen.getByLabelText('Lecturas para confirmar'), '3')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({
      action: 'register',
      direction: 'both',
      detectorImgsz: 1920,
      sampleFps: 8,
      crop: { minWidth: 60, maxWidth: 250, minRatio: 0.8, maxRatio: 6 },
      confirmReads: 3,
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalled()
  })

  it('conserva en el envío lo ya guardado (incluida la zona) porque el PATCH reemplaza todo', async () => {
    const { user } = await renderDialog(FULL_SETTINGS)

    const fps = screen.getByLabelText('FPS de muestreo')
    await user.clear(fps)
    await user.type(fps, '10')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ ...FULL_SETTINGS, sampleFps: 10 })
  })

  it('los campos vacíos no se envían: solo viaja el modo', async () => {
    const { user } = await renderDialog(null)

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'access' })
  })

  it('"Sin tope de ancho máximo" envía crop.maxWidth null', async () => {
    const { user } = await renderDialog({ crop: { minWidth: 40, maxWidth: 300 } })

    await user.click(screen.getByRole('switch', { name: 'Sin tope de ancho máximo' }))
    expect(screen.getByLabelText('Ancho máximo (px)')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'access', crop: { minWidth: 40, maxWidth: null } })
  })

  it('carga maxWidth null como "sin tope"', async () => {
    await renderDialog({ crop: { maxWidth: null } })

    expect(screen.getByRole('switch', { name: 'Sin tope de ancho máximo' })).toBeChecked()
    expect(screen.getByLabelText('Ancho máximo (px)')).toBeDisabled()
  })

  it('un error del backend se muestra en un toast y el diálogo sigue abierto', async () => {
    cameraApi.updateCameraLprSettings.mockRejectedValueOnce(new ApiError('Configuración inválida', 400))
    const { user, onClose } = await renderDialog(null)

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Configuración inválida'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('LprSettingsDialog: validación', () => {
  it('FPS fuera de rango (1 a 15)', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('FPS de muestreo'), '20')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('FPS de muestreo: debe estar entre 1 y 15')).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('ancho máximo menor que el mínimo', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('Ancho mínimo (px)'), '300')
    await user.type(screen.getByLabelText('Ancho máximo (px)'), '100')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El ancho máximo no puede ser menor que el mínimo')).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('relación máxima menor que la mínima', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('Relación mínima (ancho/alto)'), '6')
    await user.type(screen.getByLabelText('Relación máxima (ancho/alto)'), '2')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('La relación máxima no puede ser menor que la mínima')).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('ancho mínimo y lecturas deben ser enteros dentro de rango', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('Ancho mínimo (px)'), '2500')
    await user.type(screen.getByLabelText('Lecturas para confirmar'), '2.5')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Ancho mínimo: debe estar entre 0 y 2000')).toBeInTheDocument()
    expect(screen.getByText('Lecturas para confirmar: debe ser un número entero')).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('en control de acceso exige al menos 3 lecturas (bloquea el envío)', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('Lecturas para confirmar'), '2')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Con control de acceso se requieren al menos 3 lecturas')).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('un par de recorte incompleto se rechaza con un mensaje claro', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('Ancho mínimo (px)'), '60')
    await user.type(screen.getByLabelText('Relación máxima (ancho/alto)'), '6')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Indica también el ancho máximo (o marca "Sin tope")')).toBeInTheDocument()
    expect(screen.getByText('Indica también la relación mínima')).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('"Sin tope" completa el par de ancho', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('Ancho mínimo (px)'), '60')
    await user.click(screen.getByRole('switch', { name: 'Sin tope de ancho máximo' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'access', crop: { minWidth: 60, maxWidth: null } })
  })

  it('un envío inválido muestra un aviso visible y un toast', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('FPS de muestreo'), '99')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/La configuración no se guardó: corrige/)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalled()
  })

  it('una zona inválida (fuera de 0..1) muestra el error en la sección de zona', async () => {
    const { user } = await renderDialog({ action: 'register', zone: [[{ x: -0.2, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }]] })

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/La zona no es válida/)).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('en solo registrar advierte (sin bloquear) si las lecturas para confirmar son menos de 3', async () => {
    const { user } = await renderDialog({ action: 'register' })

    await user.type(screen.getByLabelText('Lecturas para confirmar'), '2')

    expect(screen.getByText(/Con menos de 3 lecturas/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toMatchObject({ confirmReads: 2 })
  })
})

describe('LprSettingsDialog: enderezar patente', () => {
  it('el número escrito viaja como número en el payload', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('Enderezar patente (°)'), '-12.5')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'access', plateRotationDeg: -12.5 })
  })

  it('vacío se omite del payload', async () => {
    const { user } = await renderDialog(null)

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).not.toHaveProperty('plateRotationDeg')
  })

  it('fuera de -45 a 45 bloquea el envío con un mensaje', async () => {
    const { user } = await renderDialog(null)

    await user.type(screen.getByLabelText('Enderezar patente (°)'), '46')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Enderezar patente: debe estar entre -45 y 45')).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('carga el valor guardado y los recomendados no lo tocan', async () => {
    const { user } = await renderDialog({ action: 'access', plateRotationDeg: 20 })

    const field = screen.getByLabelText('Enderezar patente (°)')
    expect(field).toHaveValue(20)
    await user.click(screen.getByRole('button', { name: /valores recomendados para patentes/i }))
    expect(field).toHaveValue(20)
  })

  it('sin cameras.enable-ia el campo es de solo lectura', async () => {
    await renderDialog({ action: 'access', plateRotationDeg: 20 }, false)
    expect(screen.getByLabelText('Enderezar patente (°)')).toBeDisabled()
  })
})

describe('LprSettingsDialog: zona de detección', () => {
  it('dibujar la zona la aplica al formulario y viaja con el resto al guardar', async () => {
    const { user } = await renderDialog({ action: 'register', sampleFps: 8 })

    await user.click(screen.getByRole('button', { name: 'Dibujar zona de detección' }))
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Dibujar zona (mock)' }))

    expect(await screen.findByText(/1 zona definida/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar zona de detección' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'register', sampleFps: 8, zone: ZONE })
  })

  it('el lienzo arranca con la zona ya guardada', async () => {
    const { user } = await renderDialog({ zone: ZONE })

    await user.click(screen.getByRole('button', { name: 'Editar zona de detección' }))

    expect(await screen.findByText('zonas iniciales: 1')).toBeInTheDocument()
  })
})

describe('LprSettingsDialog: restablecer', () => {
  it('pide confirmación y luego restablece (PATCH {})', async () => {
    const { user, onClose } = await renderDialog(FULL_SETTINGS)

    await user.click(screen.getByRole('button', { name: 'Restablecer valores por defecto' }))
    expect(cameraApi.resetCameraLprSettings).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Sí, restablecer' }))

    await waitFor(() => expect(cameraApi.resetCameraLprSettings).toHaveBeenCalledWith(CAMERA.id))
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('cancelar la confirmación no restablece nada', async () => {
    const { user } = await renderDialog(FULL_SETTINGS)

    await user.click(screen.getByRole('button', { name: 'Restablecer valores por defecto' }))
    await user.click(screen.getByRole('button', { name: 'No, volver' }))

    expect(cameraApi.resetCameraLprSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
  })
})

describe('LprSettingsDialog: permisos', () => {
  it('sin cameras.enable-ia es solo lectura: campos deshabilitados y sin acciones de escritura', async () => {
    await renderDialog(FULL_SETTINGS, false)

    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument()
    expect(screen.getByLabelText('Modo')).toBeDisabled()
    expect(screen.getByLabelText('Modo')).toHaveValue('register')
    expect(screen.getByLabelText('FPS de muestreo')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restablecer valores por defecto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /zona de detección/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
  })

  it('con el permiso ofrece guardar, restablecer y dibujar la zona', async () => {
    await renderDialog(null, true)

    expect(screen.queryByText(/Solo lectura/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Modo')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restablecer valores por defecto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dibujar zona de detección' })).toBeInTheDocument()
  })
})

const DEFAULTS_WARNING =
  'Con los valores por defecto esta cámara probablemente no lea patentes de autos en movimiento; usa los valores recomendados.'

describe('LprSettingsDialog: valores recomendados para patentes', () => {
  it('con la cámara sin configurar avisa que usa los defaults del worker', async () => {
    await renderDialog(null)

    expect(screen.getByText(DEFAULTS_WARNING)).toBeInTheDocument()
  })

  it('con resolución, FPS y recorte definidos no muestra el aviso', async () => {
    await renderDialog(FULL_SETTINGS)

    expect(screen.queryByText(DEFAULTS_WARNING)).not.toBeInTheDocument()
  })

  it('el botón completa el formulario sin guardar, conserva modo/dirección/zona y quita el aviso', async () => {
    const { user } = await renderDialog({ action: 'register', direction: 'exit', zone: ZONE })

    await user.click(screen.getByRole('button', { name: 'Usar valores recomendados para patentes' }))

    await waitFor(() => expect(screen.queryByText(DEFAULTS_WARNING)).not.toBeInTheDocument())
    expect(screen.getByLabelText('Resolución del detector')).toHaveValue('1920')
    expect(screen.getByLabelText('FPS de muestreo')).toHaveValue(8)
    expect(screen.getByLabelText('Ancho mínimo (px)')).toHaveValue(60)
    expect(screen.getByLabelText('Ancho máximo (px)')).toHaveValue(250)
    expect(screen.getByLabelText('Relación mínima (ancho/alto)')).toHaveValue(0.8)
    expect(screen.getByLabelText('Relación máxima (ancho/alto)')).toHaveValue(6)
    expect(screen.getByLabelText('Lecturas para confirmar')).toHaveValue(3)
    expect(screen.getByLabelText('Modo')).toHaveValue('register')
    expect(screen.getByLabelText('Dirección')).toHaveValue('exit')
    expect(screen.getByText(/1 zona definida/)).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()
  })

  it('al guardar después, el PATCH lleva los valores recomendados y conserva el resto', async () => {
    const { user } = await renderDialog({ action: 'register', direction: 'exit', zone: ZONE })

    await user.click(screen.getByRole('button', { name: 'Usar valores recomendados para patentes' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({
      action: 'register',
      direction: 'exit',
      zone: ZONE,
      detectorImgsz: 1920,
      sampleFps: 8,
      confirmReads: 3,
      crop: { minWidth: 60, maxWidth: 250, minRatio: 0.8, maxRatio: 6 },
    })
  })

  it('explica que son los valores validados con la cámara del portón y requieren GPU', async () => {
    await renderDialog(null)

    expect(screen.getByText(/validados con la cámara del portón y requieren GPU/)).toBeInTheDocument()
  })

  it('sin permiso de edición no ofrece el botón', async () => {
    await renderDialog(null, false)

    expect(screen.queryByRole('button', { name: 'Usar valores recomendados para patentes' })).not.toBeInTheDocument()
  })
})

describe('LprSettingsDialog: la línea manda sobre la dirección fija', () => {
  it('la ayuda de Dirección explica que la línea manda y la dirección es respaldo', async () => {
    await renderDialog(null)

    expect(
      screen.getByText(/Sentido por defecto de esta cámara\. Si dibujas una línea de dirección, la línea manda/),
    ).toBeInTheDocument()
  })

  it('con línea, la sección explica que el cruce manda y la dirección fija es respaldo', async () => {
    await renderDialog({ directionLine: { from: { x: 0.2, y: 0.7 }, to: { x: 0.85, y: 0.75 }, exitSide: 'left' } })

    expect(screen.getByText(/el cruce manda: define si entra o sale/)).toBeInTheDocument()
    expect(screen.getByText(/solo se usa cuando la línea no logra determinar el sentido/)).toBeInTheDocument()
  })
})
