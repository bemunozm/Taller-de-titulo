import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateFamilyFormData } from '@/types/index'
import { toUpdateFamilyBody, updateFamily } from './FamilyAPI'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

beforeEach(() => {
  vi.clearAllMocks()
})

const ID = '11111111-1111-4111-8111-111111111111'

describe('PATCH /families/:id (UpdateFamilyDto)', () => {
  it('solo envía los campos permitidos aunque el llamador pase de más', async () => {
    apiMock.patch.mockResolvedValueOnce({ data: {} })
    // Simula un objeto con extras en tiempo de ejecución (p.ej. la familia entera).
    const withExtras = {
      name: 'Familia Rojas',
      active: true,
      digitalConciergeEnabled: true,
      organizationId: '22222222-2222-4222-8222-222222222222',
      members: [],
      unit: null,
    } as UpdateFamilyFormData

    await updateFamily({ id: ID, formData: withExtras })

    expect(apiMock.patch).toHaveBeenCalledWith(`/families/${ID}`, {
      name: 'Familia Rojas',
      active: true,
      digitalConciergeEnabled: true,
    })
  })

  it('omite los campos ausentes y conserva false', () => {
    expect(toUpdateFamilyBody({ active: false, digitalConciergeEnabled: false, unitId: undefined })).toEqual({
      active: false,
      digitalConciergeEnabled: false,
    })
  })
})
