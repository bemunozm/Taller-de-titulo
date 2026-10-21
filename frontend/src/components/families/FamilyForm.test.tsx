import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CondominiumOption, CreateFamilyPayload, Family, Unit } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { FamilyForm } from './FamilyForm'

const familyApi = vi.hoisted(() => ({
  createFamily: vi.fn<(payload: CreateFamilyPayload) => Promise<Family>>(),
  updateFamily: vi.fn(),
}))
vi.mock('@/api/FamilyAPI', () => familyApi)

const unitApi = vi.hoisted(() => ({ getAvailableUnits: vi.fn<() => Promise<Unit[]>>() }))
vi.mock('@/api/UnitAPI', () => unitApi)

const ORG_A: CondominiumOption = { id: '11111111-1111-4111-8111-111111111111', name: 'Condominio A', slug: 'a' }
const ORG_B: CondominiumOption = { id: '22222222-2222-4222-8222-222222222222', name: 'Condominio B', slug: 'b' }
const onboardingApi = vi.hoisted(() => ({ listCondominiums: vi.fn<() => Promise<CondominiumOption[]>>() }))
vi.mock('@/api/OnboardingAPI', () => onboardingApi)

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const permissionsState = vi.hoisted(() => ({ isSuperAdmin: false, canUpdateFamilies: true }))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) => permission !== 'families.update' || permissionsState.canUpdateFamilies,
    isSuperAdmin: permissionsState.isSuperAdmin,
    user: undefined,
    isLoading: false,
  }),
}))

function makeUnit(id: string, identifier: string, organizationId: string): Unit {
  return {
    id,
    identifier,
    number: identifier,
    organizationId,
    active: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  }
}

const UNIT_A = makeUnit('33333333-3333-4333-8333-333333333333', 'A-101', ORG_A.id)
const UNIT_B = makeUnit('44444444-4444-4444-8444-444444444444', 'B-202', ORG_B.id)

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.isSuperAdmin = false
  permissionsState.canUpdateFamilies = true
  onboardingApi.listCondominiums.mockResolvedValue([ORG_A, ORG_B])
  unitApi.getAvailableUnits.mockResolvedValue([UNIT_A, UNIT_B])
  familyApi.createFamily.mockResolvedValue({} as Family)
})

describe('FamilyForm: super-admin creando', () => {
  beforeEach(() => {
    permissionsState.isSuperAdmin = true
  })

  it('exige el condominio, ofrece solo sus unidades y envía organizationId', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FamilyForm />)

    await user.type(screen.getByPlaceholderText('Ej: Familia González'), 'Familia Pérez')
    await user.click(screen.getByRole('button', { name: 'Crear Familia' }))
    expect(await screen.findByText('Selecciona el condominio')).toBeInTheDocument()
    expect(familyApi.createFamily).not.toHaveBeenCalled()

    await screen.findByRole('option', { name: ORG_A.name })
    // Sin condominio, ninguna unidad de la plataforma.
    expect(screen.queryByRole('option', { name: /A-101/ })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Condominio *' }), ORG_A.id)
    expect(await screen.findByRole('option', { name: /A-101/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /B-202/ })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Unidad / Departamento' }), UNIT_A.id)
    await user.click(screen.getByRole('button', { name: 'Crear Familia' }))

    await waitFor(() => expect(familyApi.createFamily).toHaveBeenCalledTimes(1))
    expect(familyApi.createFamily.mock.calls[0]?.[0]).toMatchObject({
      name: 'Familia Pérez',
      unitId: UNIT_A.id,
      organizationId: ORG_A.id,
    })
  })
})

describe('FamilyForm: Administrador', () => {
  it('sin selector, todas sus unidades y sin organizationId ni unitId vacío', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FamilyForm />)

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /B-202/ })).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Ej: Familia González'), 'Familia Pérez')
    await user.click(screen.getByRole('button', { name: 'Crear Familia' }))

    await waitFor(() => expect(familyApi.createFamily).toHaveBeenCalledTimes(1))
    const payload = familyApi.createFamily.mock.calls[0]?.[0]
    expect(payload).toMatchObject({ name: 'Familia Pérez' })
    expect(payload).not.toHaveProperty('organizationId')
    expect(payload?.unitId).toBeUndefined()
  })
})

describe('FamilyForm: edición y Conserje digital', () => {
  const FAMILY: Family = {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: ORG_A.id,
    name: 'Familia Rojas',
    description: 'Depto con niños',
    unit: UNIT_A,
    active: true,
    digitalConciergeEnabled: false,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    members: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Rosa Rojas' }],
  }
  const SWITCH_LABEL = 'Conserje digital (IA en el citófono)'

  beforeEach(() => {
    familyApi.updateFamily.mockResolvedValue(FAMILY)
  })

  it('con families.update activa el conserje y el PATCH lleva solo campos permitidos', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FamilyForm family={FAMILY} />)

    await user.click(screen.getByRole('switch', { name: SWITCH_LABEL }))
    await user.click(screen.getByRole('button', { name: 'Actualizar Familia' }))

    await waitFor(() => expect(familyApi.updateFamily).toHaveBeenCalledTimes(1))
    const variables = familyApi.updateFamily.mock.calls[0]?.[0] as { id: string; formData: Record<string, unknown> }
    expect(variables.id).toBe(FAMILY.id)
    expect(variables.formData).toMatchObject({ name: 'Familia Rojas', digitalConciergeEnabled: true })
    for (const key of Object.keys(variables.formData)) {
      expect(['name', 'description', 'unitId', 'active', 'digitalConciergeEnabled']).toContain(key)
    }
    expect(variables.formData).not.toHaveProperty('organizationId')
  })

  it('sin families.update no aparece el interruptor ni viaja el campo', async () => {
    permissionsState.canUpdateFamilies = false
    const user = userEvent.setup()
    renderWithProviders(<FamilyForm family={FAMILY} />)

    expect(screen.queryByRole('switch', { name: SWITCH_LABEL })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actualizar Familia' }))

    await waitFor(() => expect(familyApi.updateFamily).toHaveBeenCalledTimes(1))
    const variables = familyApi.updateFamily.mock.calls[0]?.[0] as { formData: Record<string, unknown> }
    expect(variables.formData).not.toHaveProperty('digitalConciergeEnabled')
  })

  it('al crear no se ofrece (CreateFamilyDto no lo acepta)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FamilyForm />)

    expect(screen.queryByRole('switch', { name: SWITCH_LABEL })).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Ej: Familia González'), 'Familia Nueva')
    await user.click(screen.getByRole('button', { name: 'Crear Familia' }))

    await waitFor(() => expect(familyApi.createFamily).toHaveBeenCalledTimes(1))
    expect(familyApi.createFamily.mock.calls[0]?.[0]).not.toHaveProperty('digitalConciergeEnabled')
  })
})
