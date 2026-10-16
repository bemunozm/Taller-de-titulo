import { BadRequestException } from '@nestjs/common';
import { resolveCreationOrganizationId } from '../common/tenant/tenant-context.util';
import type { TenantContext } from '../common/tenant/tenant-context.types';

/**
 * Doble de `TenantContextService` para los specs de servicios que crean
 * recursos del condominio (Fase 4 · P5.C). `resolveCreationOrganizationId`
 * aplica las MISMAS reglas que el servicio real (la función pura
 * `resolveCreationOrganizationId` del util) y, para el super-admin, exige que
 * el condominio esté en `existingOrganizationIds` (el real lo consulta en la
 * tabla `organization`; ver tenant-context.service.spec.ts).
 */
export interface TenantContextDouble {
  getContext: jest.Mock<Promise<TenantContext>, []>;
  resolveCreationOrganizationId: jest.Mock<
    Promise<string>,
    [(string | null | undefined)?]
  >;
}

export function createTenantContextDouble(
  initial: TenantContext,
  existingOrganizationIds: readonly string[] = [],
): TenantContextDouble {
  const getContext = jest
    .fn<Promise<TenantContext>, []>()
    .mockResolvedValue(initial);
  const resolve = jest.fn<Promise<string>, [(string | null | undefined)?]>(
    async (requested) => {
      const ctx = await getContext();
      const organizationId = resolveCreationOrganizationId(ctx, requested);
      if (
        ctx.isSuperAdmin &&
        !existingOrganizationIds.includes(organizationId)
      ) {
        throw new BadRequestException('El condominio indicado no existe');
      }
      return organizationId;
    },
  );
  return { getContext, resolveCreationOrganizationId: resolve };
}
