import { useEffect } from 'react'

/** Viewport del kiosko: sin zoom del visitante (pellizco o doble toque). */
const KIOSK_VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
const KIOSK_THEME_COLOR = '#000000'

/**
 * Pone el documento en "modo kiosko" mientras la vista está montada y lo
 * devuelve a como estaba al salir (la administración comparte el mismo
 * `index.html`):
 * - `kiosk-dark` + `color-scheme: dark`: tema oscuro forzado (AMOLED y calor),
 *   aunque el sistema esté en claro. Va en `<html>` para cubrir también los
 *   diálogos, que se montan fuera del árbol de la vista.
 * - `kiosk-mode`: sin selección, sin rebote de scroll y sin zoom (ver `index.css`).
 * - viewport sin zoom y `theme-color` negro.
 * - sin menú contextual (mantener presionado).
 */
export function useKioskDocumentMode(): void {
  useEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains('kiosk-dark')
    const hadMode = root.classList.contains('kiosk-mode')
    const previousColorScheme = root.style.colorScheme

    root.classList.add('kiosk-dark', 'kiosk-mode')
    root.style.colorScheme = 'dark'

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    const previousViewport = viewport?.getAttribute('content') ?? null
    viewport?.setAttribute('content', KIOSK_VIEWPORT)

    const themeColors = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    const previousThemeColors = themeColors.map((meta) => meta.getAttribute('content'))
    for (const meta of themeColors) {
      meta.setAttribute('content', KIOSK_THEME_COLOR)
    }

    const blockContextMenu = (event: Event) => {
      event.preventDefault()
    }
    document.addEventListener('contextmenu', blockContextMenu)

    return () => {
      document.removeEventListener('contextmenu', blockContextMenu)

      if (!hadDark) {
        root.classList.remove('kiosk-dark')
      }
      if (!hadMode) {
        root.classList.remove('kiosk-mode')
      }
      root.style.colorScheme = previousColorScheme

      if (viewport && previousViewport !== null) {
        viewport.setAttribute('content', previousViewport)
      }
      themeColors.forEach((meta, position) => {
        const previous = previousThemeColors[position]
        if (previous !== null && previous !== undefined) {
          meta.setAttribute('content', previous)
        }
      })
    }
  }, [])
}
