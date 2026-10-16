import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Visit } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { MyVisitsCard } from './MyVisitsCard'

function makeVisit(overrides: Partial<Visit>): Visit {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    type: 'pedestrian',
    status: 'pending',
    visitorName: 'Visitante',
    usedCount: 0,
    maxUses: null,
    qrCode: null,
    validFrom: new Date('2026-10-09T12:00:00Z'),
    validUntil: new Date('2026-10-09T20:00:00Z'),
    createdAt: new Date('2026-10-08T11:00:00Z'),
    updatedAt: new Date('2026-10-08T11:00:00Z'),
    ...overrides,
  }
}

describe('MyVisitsCard', () => {
  it('lista las solicitudes en espera como tales, no como visitas programadas', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <MyVisitsCard
        activeVisits={[]}
        upcomingVisits={[
          makeVisit({ id: '22222222-2222-4222-8222-222222222222', visitorName: 'Bruno Aprobado' }),
        ]}
        awaitingApprovalVisits={[
          makeVisit({
            id: '11111111-1111-4111-8111-111111111111',
            status: 'awaiting_approval',
            visitorName: 'Ana Solicitud',
          }),
        ]}
        recentCompletedVisits={[]}
        loading={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Próximas (2)' }))

    const awaitingItem = screen.getByRole('link', { name: /Ana Solicitud/ })
    expect(awaitingItem).toHaveTextContent('Esperando aprobación')
    expect(awaitingItem).not.toHaveTextContent('Programada')
    expect(awaitingItem).toHaveTextContent(/Solicitada:/)

    const scheduledItem = screen.getByRole('link', { name: /Bruno Aprobado/ })
    expect(scheduledItem).toHaveTextContent('Programada')
    expect(scheduledItem).not.toHaveTextContent('Esperando aprobación')
  })

  it('muestra la patente solicitada de una visita vehicular que aún no tiene vehículo', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <MyVisitsCard
        activeVisits={[]}
        upcomingVisits={[]}
        awaitingApprovalVisits={[
          makeVisit({
            id: '33333333-3333-4333-8333-333333333333',
            type: 'vehicular',
            status: 'awaiting_approval',
            visitorName: 'Elena Solicitud',
            vehicle: null,
            requestedPlate: 'WXYZ34',
          }),
        ]}
        recentCompletedVisits={[]}
        loading={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Próximas (1)' }))

    expect(screen.getByRole('link', { name: /Elena Solicitud/ })).toHaveTextContent('WXYZ34')
  })
})

describe('MyVisitsCard: QR solo con qrCode (P5.C)', () => {
  function renderActive(qrCode: string | null) {
    renderWithProviders(
      <MyVisitsCard
        activeVisits={[
          makeVisit({ id: '44444444-4444-4444-8444-444444444444', status: 'active', visitorName: 'Clara QR', qrCode }),
        ]}
        upcomingVisits={[]}
        awaitingApprovalVisits={[]}
        recentCompletedVisits={[]}
        loading={false}
      />,
    )
    return screen.getByRole('link', { name: /Clara QR/ })
  }

  it('con qrCode (familia del anfitrión) indica el QR generado', () => {
    expect(renderActive('a1b2c3d4')).toHaveTextContent('Código QR generado')
  })

  it('con qrCode null (no es de la familia) no lo menciona', () => {
    expect(renderActive(null)).not.toHaveTextContent('Código QR generado')
  })
})
