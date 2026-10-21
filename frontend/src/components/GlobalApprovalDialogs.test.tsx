import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/renderWithProviders'
import { GlobalApprovalDialogs } from './GlobalApprovalDialogs'

vi.mock('@/components/VisitorApprovalDialog', () => ({
  VisitorApprovalDialog: () => <div data-testid="visitor-approval-dialog" />,
}))
vi.mock('@/components/UnknownVehicleApprovalDialog', () => ({
  UnknownVehicleApprovalDialog: () => <div data-testid="unknown-vehicle-dialog" />,
}))

describe('GlobalApprovalDialogs', () => {
  it.each(['/digital-concierge', '/digital-concierge/'])('no monta diálogos de aprobación en el kiosko (%s)', (route) => {
    renderWithProviders(<GlobalApprovalDialogs />, { route })

    expect(screen.queryByTestId('visitor-approval-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unknown-vehicle-dialog')).not.toBeInTheDocument()
  })

  it('los monta en el resto de la app', () => {
    renderWithProviders(<GlobalApprovalDialogs />, { route: '/visits' })

    expect(screen.getByTestId('visitor-approval-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('unknown-vehicle-dialog')).toBeInTheDocument()
  })
})
