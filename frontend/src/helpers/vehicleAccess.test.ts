import { describe, expect, it } from 'vitest'
import {
  ACCESS_LEVEL_OPTIONS,
  NO_ACCESS_LEVEL_BEHAVIOR,
  VEHICLE_TYPE_OPTIONS,
  getAccessLevelGateBehavior,
  getAccessLevelLabel,
  getVehicleTypeLabel,
  isAccessLevelUpgrade,
  isVehicleEscalation,
  toAccessLevelFieldValue,
  toVehiclePayload,
  toVehicleTypeFieldValue,
} from './vehicleAccess'

describe('opciones de vehículo (contrato P5.C)', () => {
  it('carrocería: exactamente los literales del backend, con etiqueta en español', () => {
    expect(VEHICLE_TYPE_OPTIONS).toEqual([
      { value: 'auto', label: 'Auto' },
      { value: 'camioneta', label: 'Camioneta' },
      { value: 'moto', label: 'Moto' },
      { value: 'camion', label: 'Camión' },
      { value: 'otro', label: 'Otro' },
    ])
  })

  it('nivel de acceso: residente, visitante y servicio', () => {
    expect(ACCESS_LEVEL_OPTIONS.map((option) => option.value)).toEqual(['residente', 'visitante', 'servicio'])
  })

  it('explica qué hace el portón con cada nivel', () => {
    expect(getAccessLevelGateBehavior('residente')).toMatch(/abre automáticamente/)
    expect(getAccessLevelGateBehavior('visitante')).toMatch(/visita vigente/)
    expect(getAccessLevelGateBehavior('servicio')).toMatch(/conserje/)
    expect(getAccessLevelGateBehavior('')).toBe(NO_ACCESS_LEVEL_BEHAVIOR)
  })

  it('etiquetas: un literal antiguo o desconocido se muestra tal cual', () => {
    expect(getVehicleTypeLabel('camion')).toBe('Camión')
    expect(getVehicleTypeLabel('permanente')).toBe('permanente')
    expect(getVehicleTypeLabel(null)).toBeNull()
    expect(getAccessLevelLabel('servicio')).toBe('Servicio')
    expect(getAccessLevelLabel(undefined)).toBeNull()
  })

  it('al editar, un literal desconocido no se preselecciona', () => {
    expect(toVehicleTypeFieldValue('moto')).toBe('moto')
    expect(toVehicleTypeFieldValue('residente')).toBe('')
    expect(toAccessLevelFieldValue('visitante')).toBe('visitante')
    expect(toAccessLevelFieldValue('temporal')).toBe('')
  })
})

describe('toVehiclePayload', () => {
  it('crear: los selects sin elegir no viajan (el backend rechaza "")', () => {
    const payload = toVehiclePayload({ plate: 'ABCD12', vehicleType: '', accessLevel: '', ownerId: undefined }, 'create')

    expect(payload).toEqual({ plate: 'ABCD12' })
    expect(payload).not.toHaveProperty('vehicleType')
    expect(payload).not.toHaveProperty('accessLevel')
    expect(payload).not.toHaveProperty('ownerId')
  })

  it('crear: los valores elegidos viajan tal cual', () => {
    expect(
      toVehiclePayload({ plate: 'ABCD12', vehicleType: 'moto', accessLevel: 'residente', ownerId: 'u-1' }, 'create'),
    ).toEqual({ plate: 'ABCD12', vehicleType: 'moto', accessLevel: 'residente', ownerId: 'u-1' })
  })

  it('editar: sin elegir se envía null para limpiar el campo', () => {
    expect(toVehiclePayload({ plate: 'ABCD12', vehicleType: '', accessLevel: '' }, 'update')).toEqual({
      plate: 'ABCD12',
      vehicleType: null,
      accessLevel: null,
    })
  })
})

describe('toVehiclePayload: organizationId', () => {
  const ORG = '11111111-1111-4111-8111-111111111111'

  it('nunca lo incluye por sí mismo (lo agrega el formulario solo al super-admin creando)', () => {
    expect(toVehiclePayload({ plate: 'ABCD12', organizationId: ORG }, 'create')).not.toHaveProperty('organizationId')
    expect(toVehiclePayload({ plate: 'ABCD12', organizationId: ORG }, 'update')).not.toHaveProperty('organizationId')
  })
})

describe('toVehiclePayload: quitar el propietario', () => {
  it('editar con allowOwnerRemoval: sin propietario envía null', () => {
    expect(toVehiclePayload({ plate: 'ABCD12' }, 'update', { allowOwnerRemoval: true })).toHaveProperty('ownerId', null)
  })

  it('editar sin el permiso: se omite (no cambia)', () => {
    expect(toVehiclePayload({ plate: 'ABCD12' }, 'update')).not.toHaveProperty('ownerId')
  })

  it('con propietario elegido siempre lo envía', () => {
    expect(toVehiclePayload({ plate: 'ABCD12', ownerId: 'u-1' }, 'update', { allowOwnerRemoval: true })).toHaveProperty(
      'ownerId',
      'u-1',
    )
  })
})

describe('isVehicleEscalation (403 del residente al editar)', () => {
  it('subir el nivel de acceso o reactivar es una escalada', () => {
    expect(isAccessLevelUpgrade('visitante', 'residente')).toBe(true)
    expect(isAccessLevelUpgrade(null, 'visitante')).toBe(true)
    expect(isVehicleEscalation({ active: false, accessLevel: 'residente' }, { active: true, accessLevel: 'residente' })).toBe(true)
  })

  it('bajar el nivel, mantenerlo o desactivar no lo es', () => {
    expect(isAccessLevelUpgrade('residente', 'visitante')).toBe(false)
    expect(isAccessLevelUpgrade('servicio', null)).toBe(false)
    expect(isVehicleEscalation({ active: true, accessLevel: 'residente' }, { active: false, accessLevel: 'residente' })).toBe(false)
  })
})

describe('toVehiclePayload: omitPlate', () => {
  it('al editar sin condominium.view-all no envía la patente', () => {
    expect(toVehiclePayload({ plate: 'ABCD12', vehicleType: 'auto' }, 'update', { omitPlate: true })).not.toHaveProperty('plate')
  })

  it('por defecto sí la envía', () => {
    expect(toVehiclePayload({ plate: 'ABCD12' }, 'update')).toHaveProperty('plate', 'ABCD12')
  })
})
