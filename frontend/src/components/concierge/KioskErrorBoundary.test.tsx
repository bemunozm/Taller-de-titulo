import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { KIOSK_CRASH_RELOAD_MS } from './KioskCrashScreen'
import { KioskErrorBoundary } from './KioskErrorBoundary'

function Boom(): never {
  throw new Error('render roto')
}

beforeEach(() => {
  vi.useFakeTimers()
  // React registra el error capturado en consola: se silencia solo en este archivo.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('KioskErrorBoundary', () => {
  it('sin errores muestra a sus hijos', () => {
    const onReload = vi.fn()

    render(
      <KioskErrorBoundary onReload={onReload}>
        <p>kiosko</p>
      </KioskErrorBoundary>,
    )

    expect(screen.getByText('kiosko')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(KIOSK_CRASH_RELOAD_MS * 2)
    })
    expect(onReload).not.toHaveBeenCalled()
  })

  it('si un hijo lanza al renderizar muestra su pantalla propia (sin el error del navegador)', () => {
    render(
      <KioskErrorBoundary onReload={vi.fn()}>
        <Boom />
      </KioskErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Reiniciando')
    expect(screen.getByText(/use el citófono/)).toBeInTheDocument()
    expect(screen.queryByText('render roto')).not.toBeInTheDocument()
  })

  it('recarga la página a los 10 s, ni antes ni dos veces', () => {
    const onReload = vi.fn()
    render(
      <KioskErrorBoundary onReload={onReload}>
        <Boom />
      </KioskErrorBoundary>,
    )

    act(() => {
      vi.advanceTimersByTime(KIOSK_CRASH_RELOAD_MS - 1)
    })
    expect(onReload).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onReload).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(KIOSK_CRASH_RELOAD_MS * 3)
    })
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
