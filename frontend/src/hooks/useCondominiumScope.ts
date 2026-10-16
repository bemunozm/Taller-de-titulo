import { usePermissions } from './usePermissions'

interface CondominiumScope {
  /** Super-admin creando un recurso: debe elegir condominio (selector visible y obligatorio). */
  chooseCondominium: boolean
  isSuperAdmin: boolean
}

/**
 * ¿El formulario debe pedir el condominio? Solo al super-admin y solo al
 * crear: el backend responde 403 si otro actor envía `organizationId` y 400
 * si llega en una edición.
 */
export function useCondominiumScope(isEditing: boolean): CondominiumScope {
  const { isSuperAdmin } = usePermissions()
  return { chooseCondominium: isSuperAdmin && !isEditing, isSuperAdmin }
}
