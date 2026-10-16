import { ConflictException } from '@nestjs/common';
import {
  isUniqueViolation,
  uniqueViolationColumns,
  uniqueViolationConstraint,
} from '../common/utils/unique-violation.util';

/** Campos únicos de `user` que el cliente puede repetir. */
export type UserUniqueField = 'email' | 'rut' | 'phone';

const FIELD_MESSAGES: Record<UserUniqueField, string> = {
  email: 'El email ya está en uso',
  rut: 'El RUT ya está en uso',
  phone: 'El teléfono ya está en uso',
};

/** Nombres de los UNIQUE de `user` (migración InitialSchema), por si el detalle no viene. */
const CONSTRAINT_FIELDS: Readonly<Record<string, UserUniqueField>> = {
  UQ_e12875dfb3b1d92d7d7c5377e22: 'email',
  UQ_9f839e522b3b8c8c8223cde81db: 'rut',
  UQ_8e1f623798118e629b46a9e6299: 'phone',
};

function isUserUniqueField(value: string): value is UserUniqueField {
  return value === 'email' || value === 'rut' || value === 'phone';
}

/**
 * 409 de un campo único repetido (corrección P5, QA). Forma del cuerpo:
 * `{ statusCode: 409, error: 'Conflict', message, field }`, con `field` en
 * `email | rut | phone` (o `null` si no se pudo determinar). Antes era 400 y
 * decía "email o RUT" aunque el repetido fuera el teléfono.
 */
export function userFieldConflict(
  field: UserUniqueField | null,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: field
      ? FIELD_MESSAGES[field]
      : 'El email, RUT o teléfono ya está en uso',
    field,
  });
}

/**
 * Traduce la violación de un UNIQUE de `user` al 409 de su campo, o `null`
 * si `error` no es una violación de unicidad.
 */
export function userUniqueConflictFrom(
  error: unknown,
): ConflictException | null {
  if (!isUniqueViolation(error)) {
    return null;
  }
  const column = uniqueViolationColumns(error).find(isUserUniqueField);
  if (column) {
    return userFieldConflict(column);
  }
  const constraint = uniqueViolationConstraint(error);
  return userFieldConflict(
    constraint ? (CONSTRAINT_FIELDS[constraint] ?? null) : null,
  );
}
