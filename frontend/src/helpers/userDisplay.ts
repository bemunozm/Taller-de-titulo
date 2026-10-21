import { ApiError } from '@/helpers/httpErrors'
import { RETENTION_DAYS } from '@/helpers/privacyPolicy'

/** Texto de un dato que la API no entrega (p.ej. a quien no tiene `users.update`). */
export const MISSING_VALUE = '—'

// --- Cuentas anonimizadas (Ley 21.719, P7.R) ---

/** Nombre que el backend deja en una cuenta anonimizada. */
export const DELETED_USER_NAME = 'Usuario eliminado'

/**
 * Email que el backend deja en una cuenta anonimizada: `deleted+<id>@vigilia.invalid`
 * (único y no entregable). Es un marcador interno: la UI no lo muestra.
 */
const DELETED_USER_EMAIL_PATTERN = /^deleted\+[^@\s]+@vigilia\.invalid$/i

export function isDeletedUserEmail(email: unknown): boolean {
  return typeof email === 'string' && DELETED_USER_EMAIL_PATTERN.test(email.trim())
}

interface AnonymizableUser {
  anonymizedAt?: string | Date | null
  email?: string | null
}

/** ¿La cuenta fue anonimizada? (`anonymizedAt` o, si no llegó, su email marcador). */
export function isAnonymizedUser(user: AnonymizableUser): boolean {
  return Boolean(user.anonymizedAt) || isDeletedUserEmail(user.email)
}

/** Email para mostrar: `null` si falta o es el marcador de una cuenta anonimizada. */
export function visibleUserEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string' || email.trim() === '' || isDeletedUserEmail(email)) {
    return null
  }
  return email
}

/** Fecha aproximada en que se anonimiza una cuenta deshabilitada en `disabledAt`. */
export function getAnonymizationDate(disabledAt: Date, days: number = RETENTION_DAYS.disabledUsers): Date {
  const date = new Date(disabledAt.getTime())
  date.setDate(date.getDate() + days)
  return date
}

/** "8 de noviembre de 2026". */
export function formatLongDate(date: Date): string {
  return date.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface ContactFields {
  email?: string | null
  rut?: string | null
  phone?: string | null
}

/**
 * Línea de contacto de un usuario embebido ("email • RUT"), o `null` si llegó
 * como `{ id, name }` (P5) o anonimizado: la UI no debe inventar ni dejar
 * "undefined" ni mostrar el email marcador.
 */
export function formatUserContact(user: ContactFields): string | null {
  const parts = [visibleUserEmail(user.email), user.rut].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  )
  return parts.length > 0 ? parts.join(' • ') : null
}

/**
 * Opción de un selector con contacto ("Ana - ana@x.cl (11.111.111-1)"). Una
 * cuenta anonimizada se muestra solo como "Usuario eliminado".
 */
export function formatUserWithContact(user: {
  name: string
  email?: string | null
  rut?: string | null
  anonymizedAt?: string | Date | null
}): string {
  if (isAnonymizedUser(user)) {
    return DELETED_USER_NAME
  }
  const email = visibleUserEmail(user.email)
  const rut = typeof user.rut === 'string' && user.rut.trim() !== '' ? user.rut : null
  return `${user.name}${email ? ` - ${email}` : ''}${rut ? ` (${rut})` : ''}`
}

export type DuplicateUserField = 'email' | 'rut' | 'phone'

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Campos que nombra el 409 de duplicados de `POST /users/create-by-admin` y
 * `PATCH /users/:id` ("El email ya está en uso", "El RUT ya está registrado",
 * "El teléfono ya existe"...), para marcarlos en el formulario.
 */
export function getDuplicateUserFields(message: string): DuplicateUserField[] {
  const text = normalize(message)
  const fields: DuplicateUserField[] = []
  if (/\b(e-?mail|correo)\b/.test(text)) fields.push('email')
  if (/\brut\b/.test(text)) fields.push('rut')
  if (/\b(telefono|phone|celular)\b/.test(text)) fields.push('phone')
  return fields
}

const DUPLICATE_FIELDS: ReadonlySet<string> = new Set<DuplicateUserField>(['email', 'rut', 'phone'])

function isDuplicateUserField(value: string | null): value is DuplicateUserField {
  return value !== null && DUPLICATE_FIELDS.has(value)
}

/**
 * Campos a marcar por un 409 de duplicados. Usa el `field` estructurado del
 * backend (`{ ..., field: 'email' | 'rut' | 'phone' | null }`); solo si no
 * viene, cae a la detección por texto del `message`.
 */
export function getDuplicateUserFieldsFromError(error: unknown): DuplicateUserField[] {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return []
  }
  if (isDuplicateUserField(error.field)) {
    return [error.field]
  }
  return getDuplicateUserFields(error.message)
}
