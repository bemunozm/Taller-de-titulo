import { describe, expect, it } from 'vitest'
import { describeNotifiedResidents, isKioskRoute, maskHubId } from './kiosk'

describe('maskHubId', () => {
  it.each([
    ['hub-kiosk-1', '••••sk-1'],
    ['3f2b9c1e-7a44-4d1b-9f0e-0c8a5b6d2e71', '••••2e71'],
    ['  hub-lobby-02  ', '••••y-02'],
  ])('%s → %s (solo los últimos 4)', (hubId, masked) => {
    expect(maskHubId(hubId)).toBe(masked)
  })

  it.each(['', 'abc', 'hub-123'])('un id corto (%j) no muestra ningún carácter', (hubId) => {
    expect(maskHubId(hubId)).toBe('••••')
  })
})

describe('isKioskRoute', () => {
  it.each<[string, boolean]>([
    ['/digital-concierge', true],
    ['/digital-concierge/', true],
    ['/digital-concierge/x', true],
    ['/digital-concierge-admin', false],
    ['/', false],
    ['/visits', false],
  ])('%s → %s', (pathname, expected) => {
    expect(isKioskRoute(pathname)).toBe(expected)
  })
})

describe('describeNotifiedResidents (sin nombres en el kiosko)', () => {
  it.each([
    ['A-303', undefined, 'Residente de la casa A-303'],
    ['A-303', 1, 'Residente de la casa A-303'],
    ['15', 3, '3 residentes de la casa 15'],
    [' 15 ', 0, 'Residente de la casa 15'],
    [undefined, 2, '2 residentes de la casa marcada'],
    ['', undefined, 'Residente de la casa marcada'],
  ] as const)('casa %j, %j notificados -> %s', (house, count, expected) => {
    expect(describeNotifiedResidents(house, count)).toBe(expected)
  })
})
