import type { BetterAuthOptions } from 'better-auth';

type EmailAndPasswordOptions = NonNullable<
  BetterAuthOptions['emailAndPassword']
>;

/**
 * Política de sesiones al restablecer la contraseña (Fase 4 · P2). Se aplica
 * en `betterAuth({ emailAndPassword })` (better-auth.ts).
 *
 * `revokeSessionsOnPasswordReset`: al restablecer la contraseña con el token
 * del email, better-auth borra TODAS las sesiones del usuario
 * (`resetPassword` en better-auth/dist/api/routes/password.mjs). Si alguien
 * robó la sesión, el reset lo deja afuera. Cubre el endpoint nativo
 * `/api/auth/reset-password` y `POST /api/v1/auth/reset-password`
 * (`AuthService.updatePasswordWithToken` llama a `auth.api.resetPassword`).
 *
 * Vive fuera de better-auth.ts para poder testearla: ese módulo abre el pool
 * de Postgres al importarse. `satisfies` amarra el nombre de la opción al tipo
 * de better-auth: si la librería la renombra, falla el typecheck.
 */
export const PASSWORD_RESET_SESSION_POLICY = {
  revokeSessionsOnPasswordReset: true,
} as const satisfies Partial<EmailAndPasswordOptions>;
