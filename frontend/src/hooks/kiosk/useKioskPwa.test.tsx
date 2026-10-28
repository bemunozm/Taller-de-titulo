import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { KIOSK_MANIFEST_URL, KIOSK_SERVICE_WORKER_URL, useKioskPwa } from './useKioskPwa'

let register: ReturnType<typeof vi.fn>

beforeEach(() => {
  register = vi.fn(async () => ({}))
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
  document.head.querySelectorAll('link[rel="manifest"]').forEach((link) => link.remove())
})

describe('useKioskPwa', () => {
  it('inyecta el manifest del kiosko y lo retira al desmontar (la administración no queda instalable)', () => {
    const { unmount } = renderHook(() => useKioskPwa({ registerServiceWorker: false }))

    const link = document.head.querySelector('link[rel="manifest"]')
    expect(link).toHaveAttribute('href', KIOSK_MANIFEST_URL)

    unmount()
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull()
  })

  it('registra el service worker con alcance /digital-concierge', () => {
    renderHook(() => useKioskPwa({ registerServiceWorker: true }))

    expect(register).toHaveBeenCalledWith(KIOSK_SERVICE_WORKER_URL, { scope: '/digital-concierge' })
  })

  it('en desarrollo (sin registerServiceWorker) no registra nada', () => {
    renderHook(() => useKioskPwa({ registerServiceWorker: false }))

    expect(register).not.toHaveBeenCalled()
  })

  it('un registro rechazado (HTTP sin TLS) no rompe el kiosko', async () => {
    register.mockRejectedValueOnce(new Error('SecurityError'))

    expect(() => renderHook(() => useKioskPwa({ registerServiceWorker: true }))).not.toThrow()
    await Promise.resolve()
  })

  it('sin soporte de service workers no hace nada ni lanza', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker')

    expect(() => renderHook(() => useKioskPwa({ registerServiceWorker: true }))).not.toThrow()
  })
})
