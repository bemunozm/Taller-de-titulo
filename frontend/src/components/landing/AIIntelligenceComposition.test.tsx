import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import AIIntelligenceComposition from './AIIntelligenceComposition'

/** Duración de cada paso de la animación (setInterval del componente). */
const STEP_MS = 3_500

afterEach(() => {
  vi.useRealTimers()
})

describe('AIIntelligenceComposition: sin afirmaciones sin respaldo', () => {
  it('en el paso "Acción" avisa a la conserjería, no a una central de seguridad inexistente', () => {
    vi.useFakeTimers()
    render(<AIIntelligenceComposition />)

    // Paso 4 (Acción: bloqueo y aviso): el texto solo existe en ese paso, por eso
    // el test de la landing completa no lo vería.
    act(() => {
      vi.advanceTimersByTime(STEP_MS * 4)
    })

    expect(screen.getByText('Conserjería Notificada')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/central de seguridad/i)
  })
})
