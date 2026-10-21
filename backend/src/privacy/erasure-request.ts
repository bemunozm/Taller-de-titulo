import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type { PrivacyErasureDto } from './dto/privacy-erasure.dto';
import {
  PLATE_KEY_LENGTH,
  plateKey,
  RUT_KEY_LENGTH,
  rutKey,
} from './privacy-identifiers';

/** Supresión por un identificador del titular, en UN condominio. */
export interface SubjectErasureRequest {
  kind: 'rut' | 'plate';
  /** Identificador normalizado (`rutKey`/`plateKey`), nunca el texto crudo. */
  key: string;
  organizationId: string;
}

/** Anonimización inmediata de una cuenta deshabilitada. */
export interface UserErasureRequest {
  kind: 'userId';
  userId: string;
}

export type ErasureRequest = SubjectErasureRequest | UserErasureRequest;

export const EXACTLY_ONE_CRITERION_MESSAGE =
  'Indica exactamente uno de: rut, plate o userId';

/**
 * Valida el cuerpo de `POST /privacy/erasure` y lo reduce a un pedido sin
 * ambigüedad. Los mensajes NUNCA repiten el RUT ni la patente: llegan a la
 * auditoría (`... - FAILED: <mensaje>`) y a los logs.
 *
 * Condominio (mismas reglas que la creación estricta de la P5.C):
 *  - super-admin: debe indicar `organizationId` (400 si falta);
 *  - el resto: el de su contexto; enviar `organizationId` es 403 y no tener
 *    condominio también.
 */
export function resolveErasureRequest(
  dto: PrivacyErasureDto,
  context: TenantContext,
): ErasureRequest {
  const rut = nonBlank(dto.rut);
  const plate = nonBlank(dto.plate);
  const userId = nonBlank(dto.userId);
  const provided = [rut, plate, userId].filter((value) => value !== null);
  if (provided.length !== 1) {
    throw new BadRequestException(EXACTLY_ONE_CRITERION_MESSAGE);
  }

  const requestedOrganizationId = nonBlank(dto.organizationId);
  if (userId !== null) {
    if (requestedOrganizationId !== null) {
      throw new BadRequestException(
        'organizationId solo aplica a una supresión por rut o plate (el usuario define su condominio)',
      );
    }
    return { kind: 'userId', userId };
  }

  const organizationId = resolveErasureOrganizationId(
    context,
    requestedOrganizationId,
  );
  if (rut !== null) {
    const key = rutKey(rut);
    if (key.length < RUT_KEY_LENGTH.min || key.length > RUT_KEY_LENGTH.max) {
      throw new BadRequestException('El RUT no tiene un formato válido');
    }
    return { kind: 'rut', key, organizationId };
  }
  const key = plateKey(plate ?? '');
  if (key.length < PLATE_KEY_LENGTH.min || key.length > PLATE_KEY_LENGTH.max) {
    throw new BadRequestException('La patente no tiene un formato válido');
  }
  return { kind: 'plate', key, organizationId };
}

function resolveErasureOrganizationId(
  context: TenantContext,
  requested: string | null,
): string {
  if (context.isSuperAdmin) {
    if (!requested) {
      throw new BadRequestException(
        'Indica el condominio (organizationId) donde se suprimen los datos',
      );
    }
    return requested;
  }
  if (requested !== null) {
    throw new ForbiddenException(
      'Solo la plataforma (super-admin) puede indicar el condominio (organizationId)',
    );
  }
  if (!context.organizationId) {
    throw new ForbiddenException(
      'Tu cuenta no pertenece a ningún condominio todavía.',
    );
  }
  return context.organizationId;
}

function nonBlank(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
