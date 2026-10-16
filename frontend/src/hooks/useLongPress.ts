import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'

export interface LongPressHandlers {
  onPointerDown: () => void
  onPointerUp: () => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onKeyUp: () => void
  /** Sin menú contextual del navegador al mantener presionado en pantallas táctiles. */
  onContextMenu: (event: MouseEvent<HTMLElement>) => void
}

/**
 * Dispara `onLongPress` si se mantiene presionado (puntero, o Enter/Espacio)
 * durante `durationMs`. Soltar, salir o cancelar antes lo anula. El timer se
 * limpia al desmontar.
 */
export function useLongPress(onLongPress: () => void, durationMs: number): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onLongPressRef = useRef(onLongPress)

  useEffect(() => {
    onLongPressRef.current = onLongPress
  })

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    cancel()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onLongPressRef.current()
    }, durationMs)
  }, [cancel, durationMs])

  useEffect(() => cancel, [cancel])

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onKeyDown: (event) => {
      if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) {
        start()
      }
    },
    onKeyUp: cancel,
    onContextMenu: (event) => event.preventDefault(),
  }
}
