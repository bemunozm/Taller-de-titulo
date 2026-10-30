import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ZoneEditor, type ZoneEditorBaseProps, type ZoneEditorProps, type ZoneEditorSavePlain, type ZoneEditorSaveTyped } from './ZoneEditor'

vi.mock('../CameraPlayer', () => ({ default: () => <video data-testid="video" /> }))
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const CAMERA = { id: '11111111-1111-4111-8111-111111111111', name: 'Acceso', mountPath: 'acceso' }

const SQUARE = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
]

beforeAll(() => {
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 })
  Object.defineProperty(SVGSVGElement.prototype, 'createSVGPoint', {
    configurable: true,
    value: () => {
      const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) }
      return point
    },
  })
  Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    value: () => ({ inverse: () => ({}) }),
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

/** Los tests combinan base + una vía de guardado a mano: las sobrescrituras son sueltas y el resultado se afirma como `ZoneEditorProps`. */
type EditorOverrides = Partial<ZoneEditorBaseProps> & {
  onSave?: ZoneEditorSavePlain['onSave']
  onSaveZones?: ZoneEditorSaveTyped['onSaveZones']
}

function renderGuardianEditor(overrides: EditorOverrides = {}) {
  const props = {
    camera: CAMERA,
    initialZones: [],
    title: 'Zonas',
    description: 'Descripción',
    tone: 'guardian',
    onSaveZones: vi.fn(async () => undefined),
    onClose: vi.fn(),
    ...overrides,
  } as ZoneEditorProps
  render(<ZoneEditor {...props} />)
  return props
}

async function findCanvas(): Promise<SVGSVGElement> {
  await waitFor(() => expect(document.querySelector('svg.cursor-crosshair')).not.toBeNull(), { timeout: 3000 })
  return document.querySelector('svg.cursor-crosshair') as SVGSVGElement
}

function clickAt(canvas: SVGSVGElement, x: number, y: number) {
  fireEvent.click(canvas, { clientX: x, clientY: y })
}

const typeGroup = (zone: number) => screen.getByRole('group', { name: `Tipo de la zona ${zone}` })

describe('ZoneEditor (tono guardian): tipo de zona', () => {
  it('una zona nueva nace como intrusión y se guarda en el formato nuevo', async () => {
    const props = renderGuardianEditor()
    const user = userEvent.setup()
    const canvas = await findCanvas()

    clickAt(canvas, 100, 100)
    clickAt(canvas, 500, 100)
    clickAt(canvas, 500, 500)
    fireEvent.contextMenu(canvas)

    expect(await screen.findByText('Zona 1')).toBeInTheDocument()
    expect(within(typeGroup(1)).getByRole('button', { name: 'Intrusión' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(typeGroup(1)).getByRole('button', { name: 'Merodeo' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSaveZones).toHaveBeenCalledTimes(1))
    expect(props.onSaveZones).toHaveBeenCalledWith([
      {
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.1 },
          { x: 0.5, y: 0.5 },
        ],
        type: 'intrusion',
      },
    ])
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('al elegir Merodeo aparecen los segundos (20 por defecto) y se guardan', async () => {
    const props = renderGuardianEditor({ initialZones: [SQUARE] })
    const user = userEvent.setup()

    await user.click(within(typeGroup(1)).getByRole('button', { name: 'Merodeo' }))

    const seconds = screen.getByRole('spinbutton', { name: 'Segundos de merodeo de la zona 1' })
    expect(seconds).toHaveValue(20)
    expect(seconds).toHaveAttribute('min', '5')
    expect(seconds).toHaveAttribute('max', '600')

    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))
    await waitFor(() => expect(props.onSaveZones).toHaveBeenCalledTimes(1))
    expect(props.onSaveZones).toHaveBeenCalledWith([{ points: SQUARE, type: 'loitering', loiterSeconds: 20 }])
  })

  it('los segundos se confirman al salir del campo y se ajustan a 5..600', async () => {
    const props = renderGuardianEditor({
      initialZones: [SQUARE],
      initialZoneSettings: [{ type: 'loitering', loiterSeconds: 30 }],
    })
    const user = userEvent.setup()
    const seconds = screen.getByRole('spinbutton', { name: 'Segundos de merodeo de la zona 1' })
    expect(seconds).toHaveValue(30)

    await user.clear(seconds)
    await user.type(seconds, '1000')
    await user.tab()
    expect(seconds).toHaveValue(600)

    await user.clear(seconds)
    await user.type(seconds, '2')
    await user.tab()
    expect(seconds).toHaveValue(5)

    await user.clear(seconds)
    await user.type(seconds, '45')
    await user.keyboard('{Enter}')
    expect(seconds).toHaveValue(45)

    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))
    await waitFor(() => expect(props.onSaveZones).toHaveBeenCalledTimes(1))
    expect(props.onSaveZones).toHaveBeenCalledWith([{ points: SQUARE, type: 'loitering', loiterSeconds: 45 }])
  })

  it('un campo vacío conserva el valor anterior', async () => {
    renderGuardianEditor({
      initialZones: [SQUARE],
      initialZoneSettings: [{ type: 'loitering', loiterSeconds: 30 }],
    })
    const user = userEvent.setup()
    const seconds = screen.getByRole('spinbutton', { name: 'Segundos de merodeo de la zona 1' })

    await user.clear(seconds)
    await user.tab()

    expect(seconds).toHaveValue(30)
  })

  it('carga cada zona con su tipo (formato nuevo) y las legacy como intrusión', () => {
    renderGuardianEditor({
      initialZones: [SQUARE, SQUARE, SQUARE],
      initialZoneSettings: [{ type: 'intrusion' }, { type: 'loitering', loiterSeconds: 90 }],
    })

    expect(within(typeGroup(1)).getByRole('button', { name: 'Intrusión' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(typeGroup(2)).getByRole('button', { name: 'Merodeo' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('spinbutton', { name: 'Segundos de merodeo de la zona 2' })).toHaveValue(90)
    // La tercera no tiene ajustes (zona legacy): intrusión.
    expect(within(typeGroup(3)).getByRole('button', { name: 'Intrusión' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
  })

  it('las zonas de merodeo se dibujan en ámbar y las de intrusión en rojo', async () => {
    renderGuardianEditor({
      initialZones: [SQUARE, SQUARE],
      initialZoneSettings: [{ type: 'intrusion' }, { type: 'loitering', loiterSeconds: 20 }],
    })
    const canvas = await findCanvas()

    const polygons = Array.from(canvas.querySelectorAll('polygon'))
    expect(polygons).toHaveLength(2)
    expect(polygons[0].getAttribute('class')).toContain('red')
    expect(polygons[0].getAttribute('class')).not.toContain('amber')
    expect(polygons[1].getAttribute('class')).toContain('amber')
    expect(polygons[1].getAttribute('class')).not.toContain('red')
  })

  it('cambiar el tipo recolorea el polígono y Deshacer lo revierte', async () => {
    renderGuardianEditor({ initialZones: [SQUARE] })
    const user = userEvent.setup()
    const canvas = await findCanvas()
    expect(canvas.querySelector('polygon')?.getAttribute('class')).toContain('red')

    await user.click(within(typeGroup(1)).getByRole('button', { name: 'Merodeo' }))
    expect(canvas.querySelector('polygon')?.getAttribute('class')).toContain('amber')

    await user.click(screen.getByRole('button', { name: /Deshacer/ }))
    expect(canvas.querySelector('polygon')?.getAttribute('class')).toContain('red')
    expect(within(typeGroup(1)).getByRole('button', { name: 'Intrusión' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('volver a Intrusión no envía segundos', async () => {
    const props = renderGuardianEditor({
      initialZones: [SQUARE],
      initialZoneSettings: [{ type: 'loitering', loiterSeconds: 30 }],
    })
    const user = userEvent.setup()

    await user.click(within(typeGroup(1)).getByRole('button', { name: 'Intrusión' }))
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSaveZones).toHaveBeenCalledTimes(1))
    expect(props.onSaveZones).toHaveBeenCalledWith([{ points: SQUARE, type: 'intrusion' }])
  })

  it('eliminar una zona no desordena el tipo de las demás', async () => {
    const props = renderGuardianEditor({
      initialZones: [SQUARE, SQUARE],
      initialZoneSettings: [{ type: 'intrusion' }, { type: 'loitering', loiterSeconds: 60 }],
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Eliminar zona 1' }))
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSaveZones).toHaveBeenCalledTimes(1))
    expect(props.onSaveZones).toHaveBeenCalledWith([{ points: SQUARE, type: 'loitering', loiterSeconds: 60 }])
  })
})

describe('ZoneEditor (tono lpr): sin cambios', () => {
  it('no muestra selector de tipo y entrega los polígonos a onSave como siempre', async () => {
    const onSave = vi.fn(async () => undefined)
    renderGuardianEditor({ tone: 'lpr', initialZones: [SQUARE], onSaveZones: undefined, onSave })
    const user = userEvent.setup()

    expect(screen.queryByRole('group', { name: /Tipo de la zona/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith([SQUARE])
  })

  it('ignora initialZoneSettings: el polígono sigue en verde', async () => {
    renderGuardianEditor({
      tone: 'lpr',
      initialZones: [SQUARE],
      initialZoneSettings: [{ type: 'loitering', loiterSeconds: 30 }],
      onSaveZones: undefined,
      onSave: vi.fn(async () => undefined),
    })
    const canvas = await findCanvas()

    expect(canvas.querySelector('polygon')?.getAttribute('class')).toContain('emerald')
  })
})
