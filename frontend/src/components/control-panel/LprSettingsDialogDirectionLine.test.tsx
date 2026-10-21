import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { CameraLprSettingsResponse, DirectionLine, LprSettings } from '@/types/index'
import { LprSettingsDialog } from './LprSettingsDialog'

const CAMERA = { id: '11111111-1111-4111-8111-111111111111', name: 'Portón HD', mountPath: 'porton-hd' }

const ZONE = [
  [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
  ],
]
const LINE: DirectionLine = { from: { x: 0.2, y: 0.7 }, to: { x: 0.85, y: 0.75 }, exitSide: 'left' }
const NEW_LINE: DirectionLine = { from: { x: 0.1, y: 0.4 }, to: { x: 0.9, y: 0.4 }, exitSide: 'right' }

const cameraApi = vi.hoisted(() => ({
  getCameraLprSettings: vi.fn(),
  updateCameraLprSettings: vi.fn(),
  resetCameraLprSettings: vi.fn(),
}))
vi.mock('@/api/CameraAPI', () => cameraApi)

// Lo que el diálogo le pasa al editor, y qué "dibuja" el editor falso al aplicar.
const editor = vi.hoisted(() => ({
  last: null as null | {
    enableDirectionLine?: boolean
    initialTool?: string
    initialDirectionLine?: unknown
  },
  // Argumentos con los que el editor falso llama a onSave.
  applyArgs: [] as unknown[],
}))
vi.mock('./ZoneEditor', () => ({
  ZoneEditor: (props: {
    enableDirectionLine?: boolean
    initialTool?: string
    initialDirectionLine?: unknown
    onSave: (...args: unknown[]) => Promise<void>
    onClose: () => void
  }) => {
    editor.last = props
    return (
      <div role="dialog" aria-label="Editor de zonas">
        <button
          type="button"
          onClick={() => {
            void props.onSave(...editor.applyArgs).then(props.onClose)
          }}
        >
          Aplicar (mock)
        </button>
      </div>
    )
  },
}))

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

function response(lprSettings: LprSettings | null): CameraLprSettingsResponse {
  return { id: CAMERA.id, name: CAMERA.name, enableLpr: true, lprSettings }
}

async function renderDialog(settings: LprSettings | null, canEdit = true) {
  cameraApi.getCameraLprSettings.mockResolvedValue(response(settings))
  const view = renderWithProviders(<LprSettingsDialog camera={CAMERA} canEdit={canEdit} onClose={vi.fn()} />)
  await screen.findByLabelText('Modo')
  return { ...view, user: userEvent.setup() }
}

function lastSavedPayload(): LprSettings {
  return cameraApi.updateCameraLprSettings.mock.calls.at(-1)?.[1] as LprSettings
}

beforeEach(() => {
  vi.clearAllMocks()
  editor.last = null
  editor.applyArgs = []
  cameraApi.updateCameraLprSettings.mockResolvedValue(response(null))
})

describe('LprSettingsDialog: línea de dirección', () => {
  it('sin línea explica que se usa la dirección fija y, si no hay, el tamaño de la patente', async () => {
    await renderDialog(null)

    expect(screen.getByText(/Sin línea: se usa la dirección fija de la cámara y, si no tiene, se infiere por el tamaño de la patente/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dibujar línea de dirección' })).toBeInTheDocument()
  })

  it('con línea guardada resume el lado de salida', async () => {
    await renderDialog({ directionLine: { ...LINE, exitSide: 'right' } })

    expect(screen.getByText(/Línea de dirección definida — salida hacia la derecha/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar línea de dirección' })).toBeInTheDocument()
  })

  it('el botón de línea abre el editor con la herramienta de línea; el de zona, con la de zona', async () => {
    editor.applyArgs = [ZONE]
    const { user } = await renderDialog({ directionLine: LINE })

    await user.click(screen.getByRole('button', { name: 'Editar línea de dirección' }))
    expect(editor.last).toMatchObject({ enableDirectionLine: true, initialTool: 'line', initialDirectionLine: LINE })
    await user.click(screen.getByRole('button', { name: 'Aplicar (mock)' }))

    await user.click(screen.getByRole('button', { name: 'Editar zona de detección' }))
    expect(editor.last).toMatchObject({ enableDirectionLine: true, initialTool: 'zone' })
  })

  it('aplica zona y línea en el formulario y el PATCH las envía juntas al guardar', async () => {
    editor.applyArgs = [ZONE, NEW_LINE]
    const { user } = await renderDialog(null)

    await user.click(screen.getByRole('button', { name: 'Dibujar línea de dirección' }))
    await user.click(screen.getByRole('button', { name: 'Aplicar (mock)' }))

    expect(await screen.findByText(/salida hacia la derecha/)).toBeInTheDocument()
    expect(cameraApi.updateCameraLprSettings).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'access', zone: ZONE, directionLine: NEW_LINE })
  })

  it('borrar la línea en el editor (null) la quita del PATCH', async () => {
    editor.applyArgs = [ZONE, null]
    const { user } = await renderDialog({ directionLine: LINE })

    await user.click(screen.getByRole('button', { name: 'Editar línea de dirección' }))
    await user.click(screen.getByRole('button', { name: 'Aplicar (mock)' }))
    await screen.findByText(/Sin línea/)
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'access', zone: ZONE })
  })

  it('un editor que no entrega línea (undefined) conserva la del formulario', async () => {
    editor.applyArgs = [ZONE]
    const { user } = await renderDialog({ directionLine: LINE })

    await user.click(screen.getByRole('button', { name: 'Dibujar zona de detección' }))
    await user.click(screen.getByRole('button', { name: 'Aplicar (mock)' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'access', zone: ZONE, directionLine: LINE })
  })

  it('reenvía sin cambios la línea ya guardada (el PATCH reemplaza todo)', async () => {
    const { user } = await renderDialog({ action: 'register', directionLine: LINE })

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(cameraApi.updateCameraLprSettings).toHaveBeenCalledTimes(1))
    expect(lastSavedPayload()).toEqual({ action: 'register', directionLine: LINE })
  })

  it('en solo lectura muestra el resumen pero no ofrece dibujar la línea', async () => {
    await renderDialog({ directionLine: LINE }, false)

    expect(screen.getByText(/Línea de dirección definida/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /línea de dirección/i })).not.toBeInTheDocument()
  })
})
