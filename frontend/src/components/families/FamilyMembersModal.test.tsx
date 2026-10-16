import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { Family } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { FamilyMembersModal } from './FamilyMembersModal'
import { MyFamilyCard } from '@/components/resident-dashboard/MyFamilyCard'

const familyApi = vi.hoisted(() => ({
  getFamilyById: vi.fn<(id: string) => Promise<Family>>(),
  getAvailableUsers: vi.fn(async () => []),
  addMemberToFamily: vi.fn(),
  removeMemberFromFamily: vi.fn(),
}))
vi.mock('@/api/FamilyAPI', () => familyApi)

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const FAMILY: Family = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Familia Rojas',
  active: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  // Proyección para quien no tiene users.update: solo { id, name } (P5).
  members: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Rosa Rojas' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  familyApi.getFamilyById.mockResolvedValue(FAMILY)
})

describe('Miembros embebidos como { id, name }', () => {
  it('FamilyMembersModal: muestra el nombre, "—" en el contacto y no inventa "Pendiente"', async () => {
    renderWithProviders(<FamilyMembersModal isOpen onClose={vi.fn()} family={FAMILY} />)

    const name = await screen.findByText('Rosa Rojas')
    const row = name.closest('div.flex.items-center.justify-between')
    expect(row).not.toBeNull()
    const memberRow = within(row as HTMLElement)
    expect(memberRow.getByText('—')).toBeInTheDocument()
    expect(memberRow.queryByText(/undefined/)).not.toBeInTheDocument()
    expect(memberRow.queryByText('Pendiente')).not.toBeInTheDocument()
    expect(memberRow.queryByText('Confirmado')).not.toBeInTheDocument()
  })

  it('MyFamilyCard (Residente): lista al miembro sin línea de email vacía', () => {
    renderWithProviders(<MyFamilyCard family={FAMILY} members={FAMILY.members} />)

    const name = screen.getByText('Rosa Rojas')
    expect(name.parentElement?.querySelectorAll('p')).toHaveLength(1)
  })
})
