import { describe, expect, it, vi } from 'vitest'
import { KIOSK_CREDENTIAL_STORAGE_KEY, KioskCredentialStore } from './kioskCredentialStore'

class MemoryStorage implements Storage {
  [name: string]: unknown
  private readonly data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }
  clear(): void {
    this.data.clear()
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

/** Storage que lanza en todas las operaciones (modo privado, cuota, política). */
class ThrowingStorage extends MemoryStorage {
  getItem(): string | null {
    throw new DOMException('denied', 'SecurityError')
  }
  setItem(): void {
    throw new DOMException('quota', 'QuotaExceededError')
  }
  removeItem(): void {
    throw new DOMException('denied', 'SecurityError')
  }
}

const CREDENTIAL = { hubId: 'hub-kiosk-1', hubSecret: 's3cr3t-value' }

describe('KioskCredentialStore', () => {
  it('guarda, lee y borra la credencial', () => {
    const storage = new MemoryStorage()
    const store = new KioskCredentialStore(() => storage)

    expect(store.get()).toBeNull()
    expect(store.save(CREDENTIAL)).toBe(true)
    expect(store.get()).toEqual(CREDENTIAL)
    expect(JSON.parse(storage.getItem(KIOSK_CREDENTIAL_STORAGE_KEY) ?? 'null')).toEqual(CREDENTIAL)

    store.clear()

    expect(store.get()).toBeNull()
    expect(storage.getItem(KIOSK_CREDENTIAL_STORAGE_KEY)).toBeNull()
    expect(store.getLastClearReason()).toBe('unpaired')
  })

  it('una instancia nueva (recarga del kiosko) lee la credencial persistida', () => {
    const storage = new MemoryStorage()
    new KioskCredentialStore(() => storage).save(CREDENTIAL)

    expect(new KioskCredentialStore(() => storage).get()).toEqual(CREDENTIAL)
  })

  it('normaliza espacios y rechaza credenciales vacías', () => {
    const store = new KioskCredentialStore(() => new MemoryStorage())

    expect(store.save({ hubId: '   ', hubSecret: 'x' })).toBe(false)
    expect(store.get()).toBeNull()
    expect(store.save({ hubId: ' hub-1 ', hubSecret: ' secret ' })).toBe(true)
    expect(store.get()).toEqual({ hubId: 'hub-1', hubSecret: 'secret' })
  })

  it('devuelve el mismo snapshot mientras no cambie (useSyncExternalStore)', () => {
    const store = new KioskCredentialStore(() => new MemoryStorage())
    store.save(CREDENTIAL)

    expect(store.get()).toBe(store.get())
  })

  it('ignora un valor persistido corrupto o con otra forma', () => {
    const storage = new MemoryStorage()
    storage.setItem(KIOSK_CREDENTIAL_STORAGE_KEY, '{no es json')
    expect(new KioskCredentialStore(() => storage).get()).toBeNull()

    storage.setItem(KIOSK_CREDENTIAL_STORAGE_KEY, JSON.stringify({ hubId: 'hub-1' }))
    expect(new KioskCredentialStore(() => storage).get()).toBeNull()
  })

  it('si el storage lanza, el kiosko queda sin emparejar sin romperse', () => {
    const store = new KioskCredentialStore(() => new ThrowingStorage())

    expect(store.get()).toBeNull()
    expect(store.save(CREDENTIAL)).toBe(false)
    expect(store.get()).toBeNull()
    expect(() => store.clear()).not.toThrow()
  })

  it('si acceder al storage lanza (SecurityError), tampoco se rompe', () => {
    const store = new KioskCredentialStore(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(store.get()).toBeNull()
    expect(store.save(CREDENTIAL)).toBe(false)
    expect(() => store.clear()).not.toThrow()
  })

  it('avisa a los suscriptores al guardar y al borrar', () => {
    const store = new KioskCredentialStore(() => new MemoryStorage())
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.save(CREDENTIAL)
    store.clear('unauthorized')
    unsubscribe()
    store.save(CREDENTIAL)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getLastClearReason()).toBeNull()
  })

  it('clearIfCurrent solo borra si la credencial guardada sigue siendo la misma', () => {
    const store = new KioskCredentialStore(() => new MemoryStorage())
    store.save(CREDENTIAL)

    expect(store.clearIfCurrent({ ...CREDENTIAL, hubSecret: 'otro' }, 'unauthorized')).toBe(false)
    expect(store.get()).toEqual(CREDENTIAL)

    expect(store.clearIfCurrent(CREDENTIAL, 'unauthorized')).toBe(true)
    expect(store.get()).toBeNull()
    expect(store.getLastClearReason()).toBe('unauthorized')
  })
})
