import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CondominiumOption, CreateBulkUnitsPayload, CreateUnitPayload, Unit } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { UnitForm } from './UnitForm'
import BulkUnitsForm from './BulkUnitsForm'

const unitApi = vi.hoisted(() => ({
  createUnit: vi.fn<(payload: CreateUnitPayload) => Promise<Unit>>(),
  updateUnit: vi.fn(),
}))
vi.mock('@/api/UnitAPI', () => unitApi)

const CONDOMINIUM: CondominiumOption = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Condominio San Lorenzo',
  slug: 'san-lorenzo',
}
const onboardingApi = vi.hoisted(() => ({ listCondominiums: vi.fn<() => Promise<CondominiumOption[]>>() }))
vi.mock('@/api/OnboardingAPI', () => onboardingApi)

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const permissionsState = vi.hoisted(() => ({ isSuperAdmin: false }))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    isSuperAdmin: permissionsState.isSuperAdmin,
    user: undefined,
    isLoading: false,
  }),
}))

const UNIT: Unit = {
  id: '22222222-2222-4222-8222-222222222222',
  organizationId: CONDOMINIUM.id,
  identifier: 'A-101',
  block: 'A',
  number: '101',
  active: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.isSuperAdmin = false
  onboardingApi.listCondominiums.mockResolvedValue([CONDOMINIUM])
  unitApi.createUnit.mockResolvedValue(UNIT)
  unitApi.updateUnit.mockResolvedValue(UNIT)
})

describe('UnitForm: condominio al crear', () => {
  it('super-admin: es obligatorio y viaja como organizationId', async () => {
    permissionsState.isSuperAdmin = true
    const user = userEvent.setup()
    renderWithProviders(<UnitForm />)

    await user.type(screen.getByPlaceholderText('Ej: 303, 5, 101'), '101')
    await user.click(screen.getByRole('button', { name: 'Crear Unidad' }))
    expect(await screen.findByText('Selecciona el condominio')).toBeInTheDocument()
    expect(unitApi.createUnit).not.toHaveBeenCalled()

    await screen.findByRole('option', { name: CONDOMINIUM.name })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condominio *' }), CONDOMINIUM.id)
    await user.click(screen.getByRole('button', { name: 'Crear Unidad' }))

    await waitFor(() => expect(unitApi.createUnit).toHaveBeenCalledTimes(1))
    expect(unitApi.createUnit.mock.calls[0]?.[0]).toMatchObject({ number: '101', organizationId: CONDOMINIUM.id })
  })

  it('Administrador: sin selector y sin organizationId', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UnitForm />)

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Ej: 303, 5, 101'), '101')
    await user.click(screen.getByRole('button', { name: 'Crear Unidad' }))

    await waitFor(() => expect(unitApi.createUnit).toHaveBeenCalledTimes(1))
    expect(unitApi.createUnit.mock.calls[0]?.[0]).not.toHaveProperty('organizationId')
  })

  it('super-admin editando: sin selector y PATCH sin organizationId (daría 400)', async () => {
    permissionsState.isSuperAdmin = true
    const user = userEvent.setup()
    renderWithProviders(<UnitForm unit={UNIT} />)

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actualizar Unidad' }))

    await waitFor(() => expect(unitApi.updateUnit).toHaveBeenCalledTimes(1))
    const variables = unitApi.updateUnit.mock.calls[0]?.[0] as { formData: Record<string, unknown> }
    expect(variables.formData).not.toHaveProperty('organizationId')
  })
})

describe('BulkUnitsForm: condominio al crear en lote', () => {
  async function fillRange(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText('1'), '1')
    await user.type(screen.getByPlaceholderText('100'), '3')
  }

  it('super-admin: lo exige y lo entrega en el payload', async () => {
    permissionsState.isSuperAdmin = true
    const onSubmit = vi.fn<(payload: CreateBulkUnitsPayload) => void>()
    const user = userEvent.setup()
    renderWithProviders(<BulkUnitsForm onSubmit={onSubmit} onCancel={vi.fn()} />)

    await fillRange(user)
    await user.click(screen.getByRole('button', { name: 'Crear 3 Unidades' }))
    expect(await screen.findByText('Selecciona el condominio')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()

    await screen.findByRole('option', { name: CONDOMINIUM.name })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condominio *' }), CONDOMINIUM.id)
    await user.click(screen.getByRole('button', { name: 'Crear 3 Unidades' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ numberFrom: 1, numberTo: 3, organizationId: CONDOMINIUM.id })
  })

  it('Administrador: el payload nunca lleva organizationId', async () => {
    const onSubmit = vi.fn<(payload: CreateBulkUnitsPayload) => void>()
    const user = userEvent.setup()
    renderWithProviders(<BulkUnitsForm onSubmit={onSubmit} onCancel={vi.fn()} />)

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    await fillRange(user)
    await user.click(screen.getByRole('button', { name: 'Crear 3 Unidades' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('organizationId')
  })
})
