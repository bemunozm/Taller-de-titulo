import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'react-toastify'
import { ZoneEditor, type ZoneEditorProps } from './ZoneEditor'

// Mismo andamiaje que ZoneEditor.test.tsx: sin reproductor real y con geometría SVG
// identidad (1 px de pantalla = 1 unidad del viewBox de 1000, así clientX/1000 es la coordenada).
vi.mock('../CameraPlayer', () => ({ default: () => <video data-testid="video" /> }))

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const CAMERA = { id: '11111111-1111-4111-8111-111111111111', name: 'Portón HD', mountPath: 'porton-hd' }
const TOOL_LINE = 'Línea de dirección'

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

function renderEditor(overrides: Partial<ZoneEditorProps> = {}) {
  const props: ZoneEditorProps = {
    camera: CAMERA,
    initialZones: [],
    title: 'Zona de prueba',
    description: 'Descripción de prueba',
    tone: 'lpr',
    enableDirectionLine: true,
    onSave: vi.fn(async () => undefined),
    onClose: vi.fn(),
    ...overrides,
  }
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

function lineGroup(): Element | null {
  return document.querySelector('[data-testid="direction-line"]')
}

function arrowYs(): { base: number; tip: number } {
  const arrow = document.querySelector('[data-testid="direction-arrow"]') as SVGLineElement
  return { base: Number(arrow.getAttribute('y1')), tip: Number(arrow.getAttribute('y2')) }
}

async function drawHorizontalLine(canvas: SVGSVGElement, user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: TOOL_LINE }))
  clickAt(canvas, 200, 500)
  clickAt(canvas, 800, 500)
}

describe('ZoneEditor: línea de dirección', () => {
  it('el uso Guardián (sin la prop) no ve la herramienta ni la línea', () => {
    renderEditor({ enableDirectionLine: false, tone: 'guardian' })

    expect(screen.queryByRole('button', { name: TOOL_LINE })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invertir sentido' })).not.toBeInTheDocument()
  })

  it('sin la herramienta, onSave recibe solo las zonas (un argumento)', async () => {
    const props = renderEditor({ enableDirectionLine: false })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect((props.onSave as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(1)
  })

  it('explica qué es la línea de dirección y que sin ella se usa la dirección fija o el tamaño de la patente', () => {
    renderEditor()

    expect(screen.getByText(/La flecha indica hacia dónde se mueve el auto/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      /Sin línea: se usa la dirección fija de la cámara y, si no tiene, se infiere por el tamaño de la patente/,
    )
  })

  it('dos clics definen la línea (recortada a [0, 1]) y se entrega a onSave con salida a la izquierda', async () => {
    const props = renderEditor()
    const user = userEvent.setup()
    const canvas = await findCanvas()

    await user.click(screen.getByRole('button', { name: TOOL_LINE }))
    clickAt(canvas, -300, 500)
    expect(lineGroup()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(/segundo punto/)
    expect(screen.getByRole('button', { name: /Fijar Precisión/ })).toBeDisabled()

    clickAt(canvas, 800, 500)
    expect(lineGroup()).not.toBeNull()
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect(props.onSave).toHaveBeenCalledWith([], {
      from: { x: 0, y: 0.5 },
      to: { x: 0.8, y: 0.5 },
      exitSide: 'left',
    })
  })

  it('dibuja una flecha perpendicular con la etiqueta "Salida" hacia el lado de salida', async () => {
    renderEditor()
    const user = userEvent.setup()
    const canvas = await findCanvas()

    await drawHorizontalLine(canvas, user)

    // De izquierda a derecha, "izquierda" es hacia arriba (y decrece).
    expect(lineGroup()).toHaveAttribute('data-exit-side', 'left')
    const { base, tip } = arrowYs()
    expect(tip).toBeLessThan(base)
    expect(screen.getByTestId('direction-arrow-label')).toHaveTextContent('Saliendo →')
    expect(screen.getByRole('status')).toHaveTextContent('sentido de la flecha: Saliendo')
  })

  it('explica que la flecha es el sentido del evento de la cámara y que lo contrario se registra igual', async () => {
    renderEditor()
    const user = userEvent.setup()
    await findCanvas()
    await user.click(screen.getByRole('button', { name: TOOL_LINE }))

    expect(screen.getByText(/La flecha indica hacia dónde se mueve el auto cuando ocurre el evento de esta cámara/)).toBeInTheDocument()
    expect(screen.getByText(/se registran igual, con su sentido real/)).toBeInTheDocument()
  })

  describe('rol de la cámara y significado de la flecha', () => {
    const arrowSide = () => lineGroup()?.getAttribute('data-arrow-side')
    const exitSide = () => lineGroup()?.getAttribute('data-exit-side')

    it.each([
      ['entry', 'Entrando →', 'right'],
      ['exit', 'Saliendo →', 'left'],
    ] as const)('rol %s: etiqueta "%s" y exitSide %s con la flecha hacia arriba', async (cameraRole, label, expectedExit) => {
      const props = renderEditor({ cameraRole })
      const user = userEvent.setup()
      const canvas = await findCanvas()
      await drawHorizontalLine(canvas, user)

      expect(arrowSide()).toBe('left')
      expect(exitSide()).toBe(expectedExit)
      expect(screen.getByTestId('direction-arrow-label')).toHaveTextContent(label)
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))
      await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
      expect(props.onSave).toHaveBeenCalledWith([], expect.objectContaining({ exitSide: expectedExit }))
    })

    it.each([
      ['entry', 'right', 'left'],
      ['exit', 'right', 'right'],
      ['both', 'right', 'right'],
      ['entry', 'left', 'right'],
    ] as const)('carga una línea guardada con rol %s y exitSide %s: la flecha apunta hacia %s', async (cameraRole, savedExit, expectedArrow) => {
      renderEditor({
        cameraRole,
        initialDirectionLine: { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, exitSide: savedExit },
      })

      await findCanvas()
      expect(arrowSide()).toBe(expectedArrow)
      expect(exitSide()).toBe(savedExit)
    })

    it('rol "Ambas": el selector parte en Salida y elegir Entrada no mueve la flecha, solo recalcula exitSide', async () => {
      const props = renderEditor({ cameraRole: 'both' })
      const user = userEvent.setup()
      const canvas = await findCanvas()
      await drawHorizontalLine(canvas, user)

      expect(screen.getByRole('radio', { name: 'Salida' })).toBeChecked()
      expect(screen.getByTestId('direction-arrow-label')).toHaveTextContent('Saliendo →')
      const before = arrowYs()

      await user.click(screen.getByRole('radio', { name: 'Entrada' }))

      expect(arrowYs()).toEqual(before)
      expect(arrowSide()).toBe('left')
      expect(exitSide()).toBe('right')
      expect(screen.getByTestId('direction-arrow-label')).toHaveTextContent('Entrando →')
      expect(screen.getByRole('status')).toHaveTextContent('sentido de la flecha: Entrando')

      await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))
      await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
      expect(props.onSave).toHaveBeenCalledWith([], expect.objectContaining({ exitSide: 'right' }))
    })

    it('"Invertir sentido" mueve la flecha y recalcula exitSide según el significado', async () => {
      renderEditor({ cameraRole: 'entry' })
      const user = userEvent.setup()
      const canvas = await findCanvas()
      await drawHorizontalLine(canvas, user)
      expect([arrowSide(), exitSide()]).toEqual(['left', 'right'])

      await user.click(screen.getByRole('button', { name: 'Invertir sentido' }))

      expect([arrowSide(), exitSide()]).toEqual(['right', 'left'])
      const { base, tip } = arrowYs()
      expect(tip).toBeGreaterThan(base)
      expect(screen.getByTestId('direction-arrow-label')).toHaveTextContent('Entrando →')
    })
  })

  it('"Invertir sentido" cambia el lado de salida y gira la flecha', async () => {
    const props = renderEditor()
    const user = userEvent.setup()
    const canvas = await findCanvas()
    await drawHorizontalLine(canvas, user)

    await user.click(screen.getByRole('button', { name: 'Invertir sentido' }))

    expect(lineGroup()).toHaveAttribute('data-exit-side', 'right')
    const { base, tip } = arrowYs()
    expect(tip).toBeGreaterThan(base)
    expect(screen.getByRole('status')).toHaveTextContent('sentido de la flecha: Saliendo')

    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect(props.onSave).toHaveBeenCalledWith([], expect.objectContaining({ exitSide: 'right' }))
  })

  it('rechaza una línea demasiado corta y conserva el primer punto', async () => {
    renderEditor()
    const user = userEvent.setup()
    const canvas = await findCanvas()

    await user.click(screen.getByRole('button', { name: TOOL_LINE }))
    clickAt(canvas, 500, 500)
    clickAt(canvas, 510, 505)

    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/demasiado corta/))
    expect(lineGroup()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(/segundo punto/)
  })

  it('"Borrar línea" la quita y onSave recibe null', async () => {
    const props = renderEditor({
      initialDirectionLine: { from: { x: 0.2, y: 0.7 }, to: { x: 0.85, y: 0.75 }, exitSide: 'right' },
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Borrar línea' }))
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith([], null))
  })

  it('arranca con la línea guardada y la conserva al aplicar', async () => {
    const line = { from: { x: 0.2, y: 0.7 }, to: { x: 0.85, y: 0.75 }, exitSide: 'right' as const }
    const props = renderEditor({ initialDirectionLine: line })
    const user = userEvent.setup()
    await findCanvas()

    expect(lineGroup()).toHaveAttribute('data-exit-side', 'right')
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith([], line))
  })

  it('arrastrar un extremo lo recorta a [0, 1] y mueve la línea', async () => {
    const props = renderEditor({
      initialDirectionLine: { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, exitSide: 'left' },
    })
    const user = userEvent.setup()
    const canvas = await findCanvas()

    const handle = canvas.querySelector('[data-testid="direction-line"] g.cursor-move') as SVGGElement
    fireEvent.mouseDown(handle, { clientX: 200, clientY: 500 })
    fireEvent.mouseMove(window, { clientX: -100, clientY: 300 })
    fireEvent.mouseUp(window)
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect(props.onSave).toHaveBeenCalledWith([], {
      from: { x: 0, y: 0.3 },
      to: { x: 0.8, y: 0.5 },
      exitSide: 'left',
    })
  })

  it('no guarda una línea que quedó demasiado corta tras arrastrar', async () => {
    const props = renderEditor({
      initialDirectionLine: { from: { x: 0.5, y: 0.5 }, to: { x: 0.6, y: 0.5 }, exitSide: 'left' },
    })
    const user = userEvent.setup()
    const canvas = await findCanvas()

    const handle = canvas.querySelectorAll('[data-testid="direction-line"] g.cursor-move')[1] as SVGGElement
    fireEvent.mouseDown(handle, { clientX: 600, clientY: 500 })
    fireEvent.mouseMove(window, { clientX: 510, clientY: 500 })
    fireEvent.mouseUp(window)
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/demasiado corta/))
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('clic derecho cancela un primer punto ya marcado', async () => {
    renderEditor()
    const user = userEvent.setup()
    const canvas = await findCanvas()

    await user.click(screen.getByRole('button', { name: TOOL_LINE }))
    clickAt(canvas, 200, 200)
    expect(screen.getByRole('button', { name: /Fijar Precisión/ })).toBeDisabled()
    fireEvent.contextMenu(canvas)

    expect(screen.getByRole('button', { name: /Fijar Precisión/ })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(/Sin línea/)
  })

  it('con la herramienta de zona, los clics siguen dibujando polígonos sin tocar la línea', async () => {
    renderEditor()
    const canvas = await findCanvas()

    clickAt(canvas, 100, 100)
    clickAt(canvas, 500, 100)
    clickAt(canvas, 500, 500)
    fireEvent.contextMenu(canvas)

    expect(await screen.findByText('Zona 1')).toBeInTheDocument()
    expect(lineGroup()).toBeNull()
  })

  it('abre directamente con la herramienta de línea cuando se pide', async () => {
    renderEditor({ initialTool: 'line' })
    const canvas = await findCanvas()

    clickAt(canvas, 200, 500)
    clickAt(canvas, 800, 500)

    expect(lineGroup()).not.toBeNull()
    expect(screen.queryByText('Zona 1')).not.toBeInTheDocument()
  })
})
