/**
 * Credencial de hub del kiosko web (`web-kiosk`), emparejada en runtime.
 *
 * Antes vivía en variables de entorno de Vite, embebida en el bundle servido a
 * cualquier navegador. Ahora el operador la ingresa en la pantalla de
 * emparejamiento de `/digital-concierge` y queda solo en el `localStorage` de
 * ese dispositivo (docs/modulos/hardening-pre-piloto.md, detalle de la P4).
 *
 * Riesgo aceptado para el piloto: un XSS en el origen puede leer el
 * `localStorage`. El follow-up es el código de emparejamiento de un solo uso.
 *
 * Fail-closed: si el storage no está disponible o lanza (modo privado,
 * cuota, política del navegador), el kiosko queda sin emparejar, sin romperse.
 */

export interface KioskCredential {
  hubId: string
  hubSecret: string
}

/** Por qué se borró la credencial por última vez (para explicarlo al operador). */
export type KioskCredentialClearReason = 'unauthorized' | 'unpaired'

type Listener = () => void
type StorageProvider = () => Storage | null

/** Versionado: un cambio de forma usa otra clave en vez de leer datos viejos. */
export const KIOSK_CREDENTIAL_STORAGE_KEY = 'vigilia.kiosk.credential.v1'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function normalizeCredential(value: unknown): KioskCredential | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { hubId, hubSecret } = value as Record<string, unknown>
  if (!isNonEmptyString(hubId) || !isNonEmptyString(hubSecret)) {
    return null
  }
  return { hubId: hubId.trim(), hubSecret: hubSecret.trim() }
}

function browserLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Acceder a `window.localStorage` lanza SecurityError si el navegador lo bloquea.
    return null
  }
}

export class KioskCredentialStore {
  private readonly storageProvider: StorageProvider
  private readonly listeners = new Set<Listener>()
  /** `undefined` = aún no se leyó el storage. */
  private cached: KioskCredential | null | undefined = undefined
  private lastClearReason: KioskCredentialClearReason | null = null

  constructor(storageProvider: StorageProvider = browserLocalStorage) {
    this.storageProvider = storageProvider
  }

  /** Snapshot estable (misma referencia hasta que cambie): apto para `useSyncExternalStore`. */
  get = (): KioskCredential | null => {
    if (this.cached === undefined) {
      this.cached = this.readFromStorage()
    }
    return this.cached
  }

  /**
   * Guarda la credencial. Devuelve `false` (y el kiosko sigue sin emparejar)
   * si la credencial es inválida o el storage no permite escribir.
   */
  save = (credential: KioskCredential): boolean => {
    const normalized = normalizeCredential(credential)
    if (!normalized) {
      return false
    }

    try {
      const storage = this.storageProvider()
      if (!storage) {
        return false
      }
      storage.setItem(KIOSK_CREDENTIAL_STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      return false
    }

    this.cached = normalized
    this.lastClearReason = null
    this.emit()
    return true
  }

  /** Borra la credencial. En memoria siempre se borra, aunque el storage falle. */
  clear = (reason: KioskCredentialClearReason = 'unpaired'): void => {
    try {
      this.storageProvider()?.removeItem(KIOSK_CREDENTIAL_STORAGE_KEY)
    } catch {
      // Sin storage no hay nada persistido que borrar; el estado en memoria manda.
    }

    const hadCredential = this.get() !== null
    this.cached = null
    this.lastClearReason = reason
    if (hadCredential) {
      this.emit()
    }
  }

  /**
   * Borra solo si la credencial guardada sigue siendo `credential`. Evita que
   * un 401 tardío de una request hecha con la credencial anterior borre una
   * recién emparejada.
   */
  clearIfCurrent = (credential: KioskCredential, reason: KioskCredentialClearReason): boolean => {
    const current = this.get()
    if (!current || current.hubId !== credential.hubId || current.hubSecret !== credential.hubSecret) {
      return false
    }
    this.clear(reason)
    return true
  }

  getLastClearReason = (): KioskCredentialClearReason | null => this.lastClearReason

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private readFromStorage(): KioskCredential | null {
    try {
      const raw = this.storageProvider()?.getItem(KIOSK_CREDENTIAL_STORAGE_KEY)
      if (!raw) {
        return null
      }
      const parsed: unknown = JSON.parse(raw)
      return normalizeCredential(parsed)
    } catch {
      return null
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}

export const kioskCredentialStore = new KioskCredentialStore()
