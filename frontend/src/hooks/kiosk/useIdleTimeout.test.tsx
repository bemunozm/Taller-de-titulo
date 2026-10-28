import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, renderHook } from '@testing-library/react'
import { useIdleTimeout } from './useIdleTimeout'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('useIdleTimeout', () => {
  it('llama a onIdle una sola vez tras la inactividad', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleTimeout({ timeoutMs: 1_000, enabled: true, onIdle }))

    advance(999)
    expect(onIdle).not.toHaveBeenCalled()

    advance(1)
    expect(onIdle).toHaveBeenCalledTimes(1)

    advance(10_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it.each(['pointerdown', 'touchstart', 'click', 'keydown'])('un %s reinicia la cuenta', (eventName) => {
    const onIdle = vi.fn()
    renderHook(() => useIdleTimeout({ timeoutMs: 1_000, enabled: true, onIdle }))

    advance(900)
    fireEvent(document.body, new Event(eventName, { bubbles: true }))
    advance(900)
    expect(onIdle).not.toHaveBeenCalled()

    advance(100)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('después de disparar, una nueva actividad arma otro período', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleTimeout({ timeoutMs: 1_000, enabled: true, onIdle }))
    advance(1_000)

    fireEvent.pointerDown(document.body)
    advance(1_000)

    expect(onIdle).toHaveBeenCalledTimes(2)
  })

  it('deshabilitado no arma timer ni escucha; al habilitarse empieza de cero', () => {
    const onIdle = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => useIdleTimeout({ timeoutMs: 1_000, enabled, onIdle }),
      { initialProps: { enabled: false } },
    )

    advance(5_000)
    expect(onIdle).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    rerender({ enabled: true })
    advance(999)
    expect(onIdle).not.toHaveBeenCalled()
    advance(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('al deshabilitarse cancela la cuenta en curso', () => {
    const onIdle = vi.fn()
    const { rerender } = renderHook(
      ({ enabled }) => useIdleTimeout({ timeoutMs: 1_000, enabled, onIdle }),
      { initialProps: { enabled: true } },
    )
    advance(500)

    rerender({ enabled: false })
    advance(5_000)

    expect(onIdle).not.toHaveBeenCalled()
  })

  it('reset() reinicia la cuenta (actividad que no es un gesto)', () => {
    const onIdle = vi.fn()
    const { result } = renderHook(() => useIdleTimeout({ timeoutMs: 1_000, enabled: true, onIdle }))

    advance(900)
    act(() => {
      result.current.reset()
    })
    advance(900)
    expect(onIdle).not.toHaveBeenCalled()

    advance(100)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('resetOnUserActivity=false: los toques NO reinician, solo reset()', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleTimeout({ timeoutMs: 1_000, enabled: true, onIdle, resetOnUserActivity: false }))

    advance(900)
    fireEvent.pointerDown(document.body)
    advance(100)

    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('usa siempre el onIdle más reciente', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ onIdle }) => useIdleTimeout({ timeoutMs: 1_000, enabled: true, onIdle }), {
      initialProps: { onIdle: first },
    })

    rerender({ onIdle: second })
    advance(1_000)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('al desmontar quita las escuchas y el timer', () => {
    const onIdle = vi.fn()
    const { unmount } = renderHook(() => useIdleTimeout({ timeoutMs: 1_000, enabled: true, onIdle }))

    unmount()
    fireEvent.pointerDown(document.body)
    advance(5_000)

    expect(onIdle).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
