import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/renderWithProviders'
import { AccessDecisionBadge } from './AccessDecisionBadge'

describe('AccessDecisionBadge', () => {
  it('Duplicado: etiqueta propia, tono neutro y explicación de que no abre', () => {
    renderWithProviders(<AccessDecisionBadge decision="Duplicado" />)

    const badge = screen.getByText('Duplicado')
    expect(badge).toHaveClass('text-zinc-700')
    expect(badge).not.toHaveClass('text-green-700')
    expect(badge).toHaveAttribute('title', expect.stringMatching(/no abre el portón/))
    expect(badge.querySelector('svg')).not.toBeNull()
  })

  it('Permitido se muestra en verde (el valor real, no "Aprovado")', () => {
    renderWithProviders(<AccessDecisionBadge decision="Permitido" />)

    expect(screen.getByText('Permitido')).toHaveClass('text-green-700')
  })

  it('Denegado se muestra en rojo', () => {
    renderWithProviders(<AccessDecisionBadge decision="Denegado" />)

    expect(screen.getByText('Denegado')).toHaveClass('text-red-700')
  })

  it('Registrado: informativo (azul cielo), no verde, con ícono y aclara que no abre el portón', () => {
    renderWithProviders(<AccessDecisionBadge decision="Registrado" />)

    const badge = screen.getByText('Registrado')
    expect(badge).toHaveClass('text-sky-700')
    expect(badge).not.toHaveClass('text-green-700')
    expect(badge).toHaveAttribute('title', expect.stringMatching(/no abre el portón/))
    expect(badge.querySelector('svg')).not.toBeNull()
  })

  it('una decisión desconocida muestra su valor en gris y sin ícono', () => {
    renderWithProviders(<AccessDecisionBadge decision="Revisión manual" />)

    const badge = screen.getByText('Revisión manual')
    expect(badge).toHaveClass('text-zinc-700')
    expect(badge.querySelector('svg')).toBeNull()
  })
})
