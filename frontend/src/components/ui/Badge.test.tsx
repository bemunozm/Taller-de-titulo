import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'
import { renderWithProviders } from '@/test/renderWithProviders'

describe('Badge', () => {
  it('renderiza su contenido con el color por defecto', () => {
    const { getByText } = renderWithProviders(<Badge>Activa</Badge>)

    const badge = getByText('Activa')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('text-zinc-700')
  })

  it('aplica el color solicitado y conserva className externo', () => {
    const { getByText } = renderWithProviders(
      <Badge color="green" className="custom">
        Aprobada
      </Badge>,
    )

    const badge = getByText('Aprobada')
    expect(badge).toHaveClass('text-green-700', 'custom')
  })
})
