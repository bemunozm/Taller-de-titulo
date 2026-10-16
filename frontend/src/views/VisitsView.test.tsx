import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Visit } from '@/types/index'
import { VISIT_QR_WITHHELD_MESSAGE } from '@/helpers/visitStatus'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VisitsView } from './VisitsView'

vi.mock('@/api/VisitAPI', () => ({ getVisits: async () => [] }))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

// El formulario real no aporta: el stub "crea" la visita que dicta cada test.
const createdState = vi.hoisted(() => ({ visit: undefined as Visit | undefined }))
interface VisitFormStubProps {
  onSuccess: (createdVisit?: Visit) => void
}
vi.mock('@/components/visits/VisitForm', () => ({
  VisitForm: ({ onSuccess }: VisitFormStubProps) => (
    <button type="button" onClick={() => onSuccess(createdState.visit)}>
      Simular creación
    </button>
  ),
}))
vi.mock('@/components/visits/VisitTable', () => ({ VisitTable: () => null }))

interface QrModalStubProps {
  isOpen: boolean
  visit: Visit | null
}
vi.mock('@/components/visits/QRCodeModal', () => ({
  QRCodeModal: ({ isOpen, visit }: QrModalStubProps) =>
    isOpen ? <div role="dialog" aria-label="Código QR">{visit?.qrCode}</div> : null,
}))

function makeVisit(overrides: Partial<Visit>): Visit {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'pedestrian',
    status: 'pending',
    visitorName: 'Pedro Visitante',
    usedCount: 0,
    maxUses: null,
    qrCode: null,
    validFrom: new Date('2026-10-09T12:00:00Z'),
    validUntil: new Date('2026-10-09T20:00:00Z'),
    createdAt: new Date('2026-10-09T11:00:00Z'),
    updatedAt: new Date('2026-10-09T11:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  createdState.visit = undefined
})

async function createVisit(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<VisitsView />)
  await user.click(await screen.findByRole('button', { name: /Nueva Visita/ }))
  await user.click(await screen.findByRole('button', { name: 'Simular creación' }))
}

describe('VisitsView: QR tras crear una visita', () => {
  it('el anfitrión (o su familia) recibe el QR: se abre el modal', async () => {
    createdState.visit = makeVisit({ qrCode: 'qr-credencial-123' })
    const user = userEvent.setup()

    await createVisit(user)

    expect(await screen.findByRole('dialog', { name: 'Código QR' })).toHaveTextContent('qr-credencial-123')
    expect(toastMock.info).not.toHaveBeenCalled()
  })

  it('creada para otro (qrCode: null): avisa y no abre el modal', async () => {
    createdState.visit = makeVisit({ qrCode: null })
    const user = userEvent.setup()

    await createVisit(user)

    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith(VISIT_QR_WITHHELD_MESSAGE))
    expect(screen.queryByRole('dialog', { name: 'Código QR' })).not.toBeInTheDocument()
  })

  it('cancelar el formulario no avisa nada', async () => {
    const user = userEvent.setup()

    await createVisit(user)

    expect(toastMock.info).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Código QR' })).not.toBeInTheDocument()
  })
})
