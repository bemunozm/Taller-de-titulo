import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccessAttempt } from '@/api/DetectionsAPI'
import { renderWithProviders } from '@/test/renderWithProviders'
import TraceabilityTable from './TraceabilityTable'

const detectionsApi = vi.hoisted(() => ({
  listAccessAttempts: vi.fn<() => Promise<AccessAttempt[]>>(),
}))
vi.mock('@/api/DetectionsAPI', () => detectionsApi)

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeAttempt(id: string, decision: string, plate: string): AccessAttempt {
  return {
    id,
    decision,
    method: 'lpr',
    reason: null,
    createdAt: '2026-10-08T12:00:00.000Z',
    residente: null,
    detection: {
      id: `det-${id}`,
      cameraId: 'cam-entrada',
      plate,
      createdAt: '2026-10-08T12:00:00.000Z',
    },
  }
}

const ATTEMPTS: AccessAttempt[] = [
  makeAttempt('11111111-aaaa', 'Permitido', 'AAAA11'),
  makeAttempt('22222222-bbbb', 'Duplicado', 'BBBB22'),
  makeAttempt('33333333-cccc', 'Denegado', 'CCCC33'),
]

// Consultas por texto: `*ByRole('row', { name })` recalcula el nombre accesible de toda la
// tabla en cada intento y, con la CPU saturada, superaba el timeout de 1 s de `findBy`.
function rowOf(plate: string): HTMLElement {
  const row = screen.getByText(plate).closest('tr')
  if (!row) throw new Error(`No hay fila para ${plate}`)
  return row
}

async function renderTable() {
  detectionsApi.listAccessAttempts.mockResolvedValue(ATTEMPTS)
  const user = userEvent.setup()
  renderWithProviders(<TraceabilityTable />)
  // Control positivo: los datos ya cargaron.
  await screen.findByText('BBBB22', undefined, { timeout: 5_000 })
  return { user, decisionFilter: screen.getByRole('combobox', { name: 'Filtrar por decisión' }) }
}

describe('TraceabilityTable: decisión Duplicado', () => {
  it('la fila Duplicado muestra su badge propio en tono neutro', async () => {
    await renderTable()

    const duplicateBadge = within(rowOf('BBBB22')).getByText('Duplicado')
    expect(duplicateBadge).toHaveClass('text-zinc-700')

    const allowedBadge = within(rowOf('AAAA11')).getByText('Permitido')
    expect(allowedBadge).toHaveClass('text-green-700')
  })

  it('el filtro de decisión ofrece "Duplicado" y deja solo esas filas', async () => {
    const { user, decisionFilter } = await renderTable()

    expect(within(decisionFilter).getByRole('option', { name: 'Duplicado' })).toBeInTheDocument()

    await user.selectOptions(decisionFilter, 'Duplicado')

    expect(rowOf('BBBB22')).toBeInTheDocument()
    expect(screen.queryByText('AAAA11')).not.toBeInTheDocument()
    expect(screen.queryByText('CCCC33')).not.toBeInTheDocument()
  })

  it('el filtro "Permitido" usa el valor real del backend (no "Aprovado")', async () => {
    const { user, decisionFilter } = await renderTable()

    expect(within(decisionFilter).queryByRole('option', { name: /Aprobado/ })).not.toBeInTheDocument()

    await user.selectOptions(decisionFilter, 'Permitido')

    expect(rowOf('AAAA11')).toBeInTheDocument()
    expect(screen.queryByText('BBBB22')).not.toBeInTheDocument()
  })
})
