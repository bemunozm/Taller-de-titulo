import { describe, expect, it } from 'vitest'
import { filterByOrganization, scopeCreatePayload, withoutOrganizationId } from './condominium'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'

describe('scopeCreatePayload', () => {
  it('super-admin creando: envía el condominio elegido', () => {
    expect(scopeCreatePayload({ name: 'Portón', organizationId: ORG_A }, true)).toEqual({
      name: 'Portón',
      organizationId: ORG_A,
    })
  })

  it('cualquier otro actor: nunca lo envía, aunque el formulario lo tenga', () => {
    const payload = scopeCreatePayload({ name: 'Portón', organizationId: ORG_A }, false)

    expect(payload).toEqual({ name: 'Portón' })
    expect(payload).not.toHaveProperty('organizationId')
  })

  it('sin elegir (""): no viaja', () => {
    expect(scopeCreatePayload({ name: 'Portón', organizationId: '' }, true)).not.toHaveProperty('organizationId')
  })
})

describe('withoutOrganizationId', () => {
  it('lo quita sin tocar el resto ni el original', () => {
    const values = { number: '101', organizationId: ORG_A }

    expect(withoutOrganizationId(values)).toEqual({ number: '101' })
    expect(values.organizationId).toBe(ORG_A)
  })
})

describe('filterByOrganization', () => {
  const items = [
    { id: 'f-a', organizationId: ORG_A },
    { id: 'f-b', organizationId: ORG_B },
    { id: 'f-legacy', organizationId: null },
  ]

  it('deja solo los del condominio elegido', () => {
    expect(filterByOrganization(items, ORG_A).map((item) => item.id)).toEqual(['f-a'])
  })

  it('sin condominio elegido no ofrece nada (ni los legados sin condominio)', () => {
    expect(filterByOrganization(items, '')).toEqual([])
    expect(filterByOrganization(items, undefined)).toEqual([])
  })
})
