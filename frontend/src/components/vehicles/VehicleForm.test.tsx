import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CondominiumOption, CreateVehiclePayload, UpdateVehiclePayload, UserSummary, Vehicle } from '@/types/index'
import { ApiError } from '@/helpers/httpErrors'
import { PLATE_LOCKED_HINT, VEHICLE_ESCALATION_FORBIDDEN_MESSAGE } from '@/helpers/vehicleAccess'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VehicleForm } from './VehicleForm'

const vehicleApi = vi.hoisted(() => ({
  createVehicle: vi.fn<(payload: CreateVehiclePayload) => Promise<Vehicle>>(),
  updateVehicle: vi.fn<(variables: { id: string; formData: UpdateVehiclePayload }) => Promise<Vehicle>>(),
}))
vi.mock('@/api/VehicleAPI', () => vehicleApi)

const userApi = vi.hoisted(() => ({ getUserOptions: vi.fn<() => Promise<UserSummary[]>>() }))
vi.mock('@/api/UserAPI', () => userApi)

// El selector de condominio (solo super-admin) pide la lista a la API.
const onboardingApi = vi.hoisted(() => ({ listCondominiums: vi.fn(async () => [] as CondominiumOption[]) }))
vi.mock('@/api/OnboardingAPI', () => onboardingApi)

const permissionsState = vi.hoisted(() => ({ isSuperAdmin: false, permissions: ['users.read'] as string[] }))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) => permissionsState.permissions.includes(permission),
    isSuperAdmin: permissionsState.isSuperAdmin,
    user: undefined,
    isLoading: false,
  }),
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

const OWNER: UserSummary = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Rosa Residente',
  family: { id: '55555555-5555-4555-8555-555555555555', name: 'Familia Rojas' },
}

const EXISTING: Vehicle = {
  id: '66666666-6666-4666-8666-666666666666',
  plate: 'WXYZ34',
  vehicleType: 'camioneta',
  accessLevel: 'residente',
  active: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  permissionsState.isSuperAdmin = false
  permissionsState.permissions = ['users.read']
  userApi.getUserOptions.mockResolvedValue([OWNER])
  vehicleApi.createVehicle.mockResolvedValue(EXISTING)
  vehicleApi.updateVehicle.mockResolvedValue(EXISTING)
})

function optionValues(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole('option')
    .map((option) => (option as HTMLOptionElement).value)
}

describe('VehicleForm: opciones del contrato P5.C', () => {
  it('carrocería y nivel de acceso con los literales del backend', () => {
    renderWithProviders(<VehicleForm />)

    const typeSelect = screen.getByRole('combobox', { name: 'Tipo de vehículo' })
    expect(optionValues(typeSelect)).toEqual(['', 'auto', 'camioneta', 'moto', 'camion', 'otro'])
    expect(within(typeSelect).getByRole('option', { name: 'Camión' })).toBeInTheDocument()

    const accessSelect = screen.getByRole('combobox', { name: 'Nivel de acceso' })
    expect(optionValues(accessSelect)).toEqual(['', 'residente', 'visitante', 'servicio'])
  })

  it('la ayuda explica qué hace el portón con el nivel elegido', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm />)

    expect(screen.getByText(/el conserje decide cada ingreso/)).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Nivel de acceso' }), 'visitante')
    expect(screen.getByText('El portón abre solo si la patente tiene una visita vigente.')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Nivel de acceso' }), 'residente')
    expect(screen.getByText('El portón abre automáticamente al reconocer la patente.')).toBeInTheDocument()
  })
})

describe('VehicleForm: payload', () => {
  it('crear con ambos enums y propietario', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm />)

    await screen.findByRole('option', { name: 'Rosa Residente · Familia Rojas' })
    await user.type(screen.getByPlaceholderText('ABC123'), 'abcd12')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Propietario' }), OWNER.id)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo de vehículo' }), 'moto')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Nivel de acceso' }), 'visitante')
    await user.click(screen.getByRole('button', { name: 'Crear Vehículo' }))

    await waitFor(() => expect(vehicleApi.createVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.createVehicle.mock.calls[0]?.[0]).toMatchObject({
      plate: 'ABCD12',
      vehicleType: 'moto',
      accessLevel: 'visitante',
      ownerId: OWNER.id,
      active: true,
    })
  })

  it('crear sin elegir: no envía "" (el backend respondería 400) ni año NaN', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm />)

    await user.type(screen.getByPlaceholderText('ABC123'), 'ABCD12')
    await user.click(screen.getByRole('button', { name: 'Crear Vehículo' }))

    await waitFor(() => expect(vehicleApi.createVehicle).toHaveBeenCalledTimes(1))
    const payload = vehicleApi.createVehicle.mock.calls[0]?.[0]
    expect(payload).toMatchObject({ plate: 'ABCD12' })
    expect(payload).not.toHaveProperty('vehicleType')
    expect(payload).not.toHaveProperty('accessLevel')
    expect(payload).not.toHaveProperty('ownerId')
    expect(payload?.year).toBeUndefined()
  })

  it('editar precarga los valores y limpiar el nivel envía null', async () => {
    // Administrador/Conserje: ve todo el condominio y puede reenviar la patente.
    permissionsState.permissions = ['users.read', 'condominium.view-all']
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm vehicle={EXISTING} />)

    const accessSelect = screen.getByRole('combobox', { name: 'Nivel de acceso' })
    expect(accessSelect).toHaveValue('residente')
    expect(screen.getByRole('combobox', { name: 'Tipo de vehículo' })).toHaveValue('camioneta')

    await user.selectOptions(accessSelect, '')
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(vehicleApi.updateVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.updateVehicle.mock.calls[0]?.[0]).toMatchObject({
      id: EXISTING.id,
      formData: { plate: 'WXYZ34', vehicleType: 'camioneta', accessLevel: null },
    })
  })

  it('un 409 (patente duplicada) se muestra y el formulario sigue abierto', async () => {
    const onSuccess = vi.fn()
    vehicleApi.createVehicle.mockRejectedValueOnce(
      new ApiError('Ya existe un vehículo con esa patente en el condominio', 409),
    )
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm onSuccess={onSuccess} />)

    await user.type(screen.getByPlaceholderText('ABC123'), 'ABCD12')
    await user.click(screen.getByRole('button', { name: 'Crear Vehículo' }))

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Ya existe un vehículo con esa patente en el condominio'),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('VehicleForm: super-admin y condominio', () => {
  const ORG_A: CondominiumOption = { id: '77777777-7777-4777-8777-777777777777', name: 'Condominio A', slug: 'a' }
  const ORG_B: CondominiumOption = { id: '88888888-8888-4888-8888-888888888888', name: 'Condominio B', slug: 'b' }
  const OWNER_A: UserSummary = { id: '99999999-9999-4999-8999-999999999999', name: 'Ana A', family: { id: 'f-a', name: 'Familia A', organizationId: ORG_A.id } }
  const OWNER_B: UserSummary = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Beto B', family: { id: 'f-b', name: 'Familia B', organizationId: ORG_B.id } }

  beforeEach(() => {
    permissionsState.isSuperAdmin = true
    onboardingApi.listCondominiums.mockResolvedValue([ORG_A, ORG_B])
    userApi.getUserOptions.mockResolvedValue([OWNER_A, OWNER_B])
  })

  it('exige el condominio, ofrece solo dueños de ese condominio y lo envía', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm />)

    await user.type(screen.getByPlaceholderText('ABC123'), 'ABCD12')
    await user.click(screen.getByRole('button', { name: 'Crear Vehículo' }))
    expect(await screen.findByText('Selecciona el condominio')).toBeInTheDocument()
    expect(vehicleApi.createVehicle).not.toHaveBeenCalled()
    // Sin condominio elegido no se ofrece ningún dueño de la plataforma.
    expect(screen.queryByRole('option', { name: /Ana A/ })).not.toBeInTheDocument()

    await screen.findByRole('option', { name: ORG_A.name })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condominio *' }), ORG_A.id)
    expect(await screen.findByRole('option', { name: 'Ana A · Familia A' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Beto B/ })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Propietario' }), OWNER_A.id)
    await user.click(screen.getByRole('button', { name: 'Crear Vehículo' }))

    await waitFor(() => expect(vehicleApi.createVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.createVehicle.mock.calls[0]?.[0]).toMatchObject({
      plate: 'ABCD12',
      ownerId: OWNER_A.id,
      organizationId: ORG_A.id,
    })
  })

  it('al editar no muestra el selector ni envía organizationId (PUT con él → 400)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm vehicle={EXISTING} />)

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(vehicleApi.updateVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.updateVehicle.mock.calls[0]?.[0]?.formData).not.toHaveProperty('organizationId')
  })
})

describe('VehicleForm: actor sin super-admin', () => {
  it('no muestra el selector ni envía organizationId', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm />)

    expect(screen.queryByRole('combobox', { name: /Condominio/ })).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('ABC123'), 'ABCD12')
    await user.click(screen.getByRole('button', { name: 'Crear Vehículo' }))

    await waitFor(() => expect(vehicleApi.createVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.createVehicle.mock.calls[0]?.[0]).not.toHaveProperty('organizationId')
    expect(onboardingApi.listCondominiums).not.toHaveBeenCalled()
  })
})

describe('VehicleForm: quitar el propietario al editar', () => {
  const OWNED: Vehicle = { ...EXISTING, owner: { id: OWNER.id, name: OWNER.name } }

  it('con condominium.view-all, "Sin propietario" envía ownerId: null', async () => {
    permissionsState.permissions = ['users.read', 'condominium.view-all']
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm vehicle={OWNED} />)

    const ownerSelect = screen.getByRole('combobox', { name: 'Propietario' })
    expect(ownerSelect).toHaveValue(OWNER.id)
    await user.selectOptions(ownerSelect, '')
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(vehicleApi.updateVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.updateVehicle.mock.calls[0]?.[0]?.formData).toHaveProperty('ownerId', null)
  })

  it('sin ese permiso (Residente) no lo envía: el propietario queda igual', async () => {
    permissionsState.permissions = []
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm vehicle={OWNED} />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Propietario' }), '')
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(vehicleApi.updateVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.updateVehicle.mock.calls[0]?.[0]?.formData).not.toHaveProperty('ownerId')
  })
})

describe('VehicleForm: 403 al reactivar o ampliar el acceso', () => {
  it('subir el nivel muestra el mensaje claro', async () => {
    vehicleApi.updateVehicle.mockRejectedValueOnce(new ApiError('Forbidden', 403))
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm vehicle={{ ...EXISTING, accessLevel: 'visitante' }} />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Nivel de acceso' }), 'residente')
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(VEHICLE_ESCALATION_FORBIDDEN_MESSAGE))
  })

  it('otro 403 (sin reactivar ni subir) muestra el mensaje del backend', async () => {
    vehicleApi.updateVehicle.mockRejectedValueOnce(new ApiError('El propietario no es de tu condominio', 403))
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm vehicle={EXISTING} />)

    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('El propietario no es de tu condominio'))
  })
})

describe('VehicleForm: patente al editar', () => {
  it('sin condominium.view-all (Residente): solo lectura, con ayuda, y el PUT no la lleva', async () => {
    permissionsState.permissions = []
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm vehicle={EXISTING} />)

    const plate = screen.getByPlaceholderText('ABC123')
    expect(plate).toHaveAttribute('readonly')
    expect(plate).toHaveAccessibleDescription(PLATE_LOCKED_HINT)

    await user.type(plate, 'X')
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(vehicleApi.updateVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.updateVehicle.mock.calls[0]?.[0]?.formData).not.toHaveProperty('plate')
  })

  it('con condominium.view-all: editable y se envía', async () => {
    permissionsState.permissions = ['users.read', 'condominium.view-all']
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm vehicle={EXISTING} />)

    const plate = screen.getByPlaceholderText('ABC123')
    expect(plate).not.toHaveAttribute('readonly')
    expect(screen.queryByText(PLATE_LOCKED_HINT)).not.toBeInTheDocument()
    await user.clear(plate)
    await user.type(plate, 'NUEV12')
    await user.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(vehicleApi.updateVehicle).toHaveBeenCalledTimes(1))
    expect(vehicleApi.updateVehicle.mock.calls[0]?.[0]?.formData).toHaveProperty('plate', 'NUEV12')
  })

  it('al crear la patente siempre es editable', () => {
    permissionsState.permissions = []
    renderWithProviders(<VehicleForm />)

    expect(screen.getByPlaceholderText('ABC123')).not.toHaveAttribute('readonly')
  })
})

describe('VehicleForm: accesibilidad de la ayuda del nivel de acceso', () => {
  it('el select describe qué hace el portón con el nivel elegido', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VehicleForm />)

    const accessSelect = screen.getByRole('combobox', { name: 'Nivel de acceso' })
    await user.selectOptions(accessSelect, 'residente')

    expect(accessSelect).toHaveAccessibleDescription('El portón abre automáticamente al reconocer la patente.')
  })
})
