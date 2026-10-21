import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'react-toastify'
import { ZoneEditor, type ZoneEditorProps } from './ZoneEditor'

// El reproductor WHEP no corre en jsdom: un <video> con tamaño intrínseco basta
// para que el editor calcule el rectángulo del video y monte el lienzo SVG.
vi.mock('../CameraPlayer', () => ({ default: () => <video data-testid="video" /> }))

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const CAMERA = { id: '11111111-1111-4111-8111-111111111111', name: 'Portón HD', mountPath: 'porton-hd' }

beforeAll(() => {
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 })

  // jsdom no implementa la geometría SVG. Identidad: 1 px de pantalla = 1 unidad
  // del viewBox (1000), así que clientX/1000 es la coordenada normalizada.
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
    onSave: vi.fn(async () => undefined),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<ZoneEditor {...props} />)
  return props
}

// El rectángulo del video se calcula en un intervalo de 1 s.
async function findCanvas(): Promise<SVGSVGElement> {
  await waitFor(() => expect(document.querySelector('svg.cursor-crosshair')).not.toBeNull(), { timeout: 3000 })
  return document.querySelector('svg.cursor-crosshair') as SVGSVGElement
}

function clickAt(canvas: SVGSVGElement, x: number, y: number) {
  fireEvent.click(canvas, { clientX: x, clientY: y })
}

describe('ZoneEditor', () => {
  it('muestra el título y la descripción recibidos', () => {
    renderEditor()

    expect(screen.getByText('Zona de prueba')).toBeInTheDocument()
    expect(screen.getByText('Descripción de prueba')).toBeInTheDocument()
  })

  it('dibuja un polígono, lo cierra con clic derecho y lo entrega a onSave', async () => {
    const props = renderEditor()
    const user = userEvent.setup()
    const canvas = await findCanvas()

    clickAt(canvas, 100, 100)
    clickAt(canvas, 500, 100)
    clickAt(canvas, 500, 500)
    fireEvent.contextMenu(canvas)

    expect(await screen.findByText('Zona 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect(props.onSave).toHaveBeenCalledWith([
      [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.1 },
        { x: 0.5, y: 0.5 },
      ],
    ])
    expect(toast.success).toHaveBeenCalledWith('Cambios sincronizados correctamente')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('recorta a [0, 1] los clics fuera del lienzo', async () => {
    const props = renderEditor()
    const user = userEvent.setup()
    const canvas = await findCanvas()

    clickAt(canvas, -200, 1500)
    clickAt(canvas, 1300, -50)
    clickAt(canvas, 500, 500)
    fireEvent.contextMenu(canvas)
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect(props.onSave).toHaveBeenCalledWith([
      [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 0.5, y: 0.5 },
      ],
    ])
  })

  it('recorta a [0, 1] al arrastrar un vértice fuera del video', async () => {
    const props = renderEditor({
      initialZones: [
        [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
        ],
      ],
    })
    const user = userEvent.setup()
    const canvas = await findCanvas()

    const vertex = canvas.querySelector('g.cursor-move') as SVGGElement
    fireEvent.mouseDown(vertex, { clientX: 200, clientY: 200 })
    fireEvent.mouseMove(window, { clientX: -400, clientY: 2000 })
    fireEvent.mouseUp(window)
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    const saved = (props.onSave as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { x: number; y: number }[][]
    expect(saved[0]?.[0]).toEqual({ x: 0, y: 1 })
  })

  it('no cierra un polígono con menos de 3 puntos', async () => {
    renderEditor()
    const canvas = await findCanvas()

    clickAt(canvas, 100, 100)
    clickAt(canvas, 500, 100)
    fireEvent.contextMenu(canvas)

    expect(toast.info).toHaveBeenCalledWith('Se requieren al menos 3 puntos.')
    expect(screen.queryByText('Zona 1')).not.toBeInTheDocument()
  })

  it('no permite guardar con un trazado a medio dibujar', async () => {
    renderEditor()
    const canvas = await findCanvas()

    clickAt(canvas, 100, 100)

    expect(screen.getByRole('button', { name: /Fijar Precisión/ })).toBeDisabled()
  })

  it('arranca con las zonas iniciales y permite eliminarlas', async () => {
    const props = renderEditor({
      initialZones: [
        [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
        ],
      ],
    })
    const user = userEvent.setup()

    expect(screen.getByText('Zona 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Eliminar zona 1' }))
    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith([]))
  })

  it('usa la etiqueta y el mensaje de éxito que le pasan', async () => {
    const props = renderEditor({ saveLabel: 'Aplicar zona', successMessage: 'Zona aplicada' })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Aplicar zona/ }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Zona aplicada')
  })

  it('si onSave rechaza, avisa con el mensaje y se queda abierto', async () => {
    const props = renderEditor({ onSave: vi.fn(async () => Promise.reject(new Error('Zona inválida'))) })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Fijar Precisión/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Zona inválida'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('el botón de cerrar llama a onClose', async () => {
    const props = renderEditor()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cerrar editor de zonas' }))

    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})
