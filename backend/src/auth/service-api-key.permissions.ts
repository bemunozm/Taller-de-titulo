/**
 * Vínculo de una API key de servicio con su condominio (Fase 4 · P2, hallazgo
 * C1 de la revisión de seguridad).
 *
 * El condominio viaja en `permissions` y NO en `metadata`: el plugin `apiKey`
 * de better-auth trata `permissions` como propiedad server-only (un cliente no
 * puede fijarla en `/api-key/create` ni en `/api-key/update`), mientras que
 * `metadata` es escribible desde el cliente. `metadata` queda solo para
 * trazabilidad (descripción, quién la emitió) y nunca para autorizar.
 */

/** Recurso/acción que identifica a una key emitida para el worker LPR. */
export const SERVICE_KEY_RESOURCE = 'service';
export const LPR_SERVICE_ACTION = 'lpr';
/** Recurso cuyo único valor es el `organizationId` (condominio) de la key. */
export const SERVICE_KEY_ORG_RESOURCE = 'org';

export type ServiceKeyPermissions = Record<string, string[]>;

/** Permisos con los que el backend emite una key del LPR para `organizationId`. */
export function buildServiceKeyPermissions(
  organizationId: string,
): ServiceKeyPermissions {
  return {
    [SERVICE_KEY_RESOURCE]: [LPR_SERVICE_ACTION],
    [SERVICE_KEY_ORG_RESOURCE]: [organizationId],
  };
}

/** Permisos que exige `ServiceApiKeyGuard` al verificar (`verifyApiKey`). */
export function requiredServiceKeyPermissions(): ServiceKeyPermissions {
  return { [SERVICE_KEY_RESOURCE]: [LPR_SERVICE_ACTION] };
}

/**
 * Lee el condominio de los `permissions` de una key verificada. Devuelve
 * `null` si falta, si no es un string no vacío o si hay más de uno (una key se
 * emite para UN condominio; cualquier otra forma se trata como inválida).
 */
export function extractServiceKeyOrganizationId(
  permissions: unknown,
): string | null {
  if (typeof permissions !== 'object' || permissions === null) {
    return null;
  }
  const orgs = (permissions as Record<string, unknown>)[
    SERVICE_KEY_ORG_RESOURCE
  ];
  if (!Array.isArray(orgs) || orgs.length !== 1) {
    return null;
  }
  const [organizationId] = orgs as unknown[];
  return typeof organizationId === 'string' && organizationId.length > 0
    ? organizationId
    : null;
}
