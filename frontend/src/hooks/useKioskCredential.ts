import { useSyncExternalStore } from 'react'
import { kioskCredentialStore, type KioskCredential } from '@/services/kioskCredentialStore'

/** Credencial emparejada del kiosko; re-renderiza al emparejar o desemparejar (incluido un 401). */
export function useKioskCredential(): KioskCredential | null {
  return useSyncExternalStore(kioskCredentialStore.subscribe, kioskCredentialStore.get)
}
