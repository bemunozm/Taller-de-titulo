import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom no implementa ResizeObserver; Headless UI lo usa al cerrar un Menu
// tras elegir un ítem. Un no-op basta: los tests no dependen del layout.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

// Sin `globals: true`, Testing Library no registra su cleanup automatico.
afterEach(() => {
  cleanup()
})
