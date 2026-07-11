# Fase 0 — Auth robusta + Multi-tenant (better-auth): diseño y plan de migración

> Estado: 🟡 en diseño (para revisar antes de implementar). Basado en research de julio 2026 + mapa del auth actual.

## 1. Objetivo
Reemplazar el auth JWT+RBAC hecho a mano por una base **robusta y multi-tenant** para el SaaS, aprovechando que hoy hay ~cero datos (migración barata). Que el agente-cerebro y todos los módulos nazcan **tenant-aware**.

## 2. Decisión de stack (fundamentada)
- **Librería:** `@thallesp/nestjs-better-auth` (community, **v2.7.0 · 4-jul-2026**, 569★, activa, peer dep `better-auth >= 1.5.0`). Provee `AuthGuard` global, `@AllowAnonymous()`, `@Roles()`, `@OrgRoles()`, `@UserHasPermission()`, `@MemberHasPermission()` — idiomático NestJS.
- **NO montar el handler vanilla a mano:** reimplementaríamos justo lo que la lib ya da.
- **Skills:** instalar `npx skills add better-auth/skills` — son **agent-skills** (guías de mejores prácticas para asistentes de IA como Claude Code), agnósticas de framework. Se usan **junto** con la lib, no en su lugar.
- **better-auth core:** fijar versión (última estable 1.6.x) y suscribirse a advisories (ver Riesgos).
- **Riesgo a vigilar:** bus-factor (un mantenedor principal en la lib community).

## 3. Arquitectura: qué maneja cada capa

```
┌─────────────────────────────────────────────────────────────┐
│ better-auth (identidad + sesión + organización)             │
│  - user / session / account / verification                  │
│  - email+password (hash bcrypt override), OAuth, 2FA        │
│  - organization plugin  →  tenant = CONDOMINIO              │
│  - roles GRUESOS (6): Super Admin, Admin, Conserje, ...      │
└───────────────┬─────────────────────────────────────────────┘
                │ request.user poblado con roles + permisos
                ▼
┌─────────────────────────────────────────────────────────────┐
│ RBAC FINO (app-side, SE MANTIENE INTACTO)                   │
│  - tabla Permission (79) + AuthorizationGuard               │
│  - @RequirePermissions / @RequireRoles  (114 usos, 17 files)│
│  - NO se remapea a better-auth → migración acotada          │
└─────────────────────────────────────────────────────────────┘
```

**Clave (del mapa de auth):** `AuthorizationGuard` solo lee `request.user.roles/permissions`; no le importa quién emitió la sesión. Reemplazamos **solo la capa de identidad/sesión** y conservamos todo el RBAC fino. Para poblar los permisos en la sesión sin round-trip extra por request, usar el plugin **`customSession`** (inyecta `roles`/`permissions` en la respuesta de sesión) o `definePayload` del plugin JWT.

## 4. Reconciliación del modelo `User` (decisión importante 🟡)
Hoy el `User` es rico (rut, phone, age, family, roles M:N) y **5+ módulos** dependen de `UsersService` (digital-concierge, detections, visits, vehicles, notifications). better-auth "quiere ser dueño" de su tabla `user`. Opciones:

- **A) Identidad separada + perfil app:** better-auth maneja su `user`/`session` mínimos; la app mantiene su `User` rico, enlazados por id. Bajo riesgo, pero **dos conceptos de usuario** que reconciliar (deuda).
- **B) Mapear better-auth sobre la tabla `User` existente** (`modelName`/`fields`). Riesgo: bugs abiertos `#6391` (override de `account.modelName` en login) y `#3774` (tabla "user" hardcodeada) — verificar antes.
- **C) ✅ (recomendada) `user` de better-auth como canónica + campos extendidos:** adoptar su `user` como fuente de verdad y colgar los campos de dominio (rut/phone/age/family) y el M:N de roles. Requiere re-homar `UsersService`, pero **hoy no hay datos** y con desarrollo asistido es de días. Deja UN solo modelo de usuario (lo correcto para un SaaS).

**Lean:** C, con A como fallback si los bugs de `modelName` (B) o el re-homing resultan más caros de lo esperado.

## 5. Sesiones
better-auth default = **cookies httpOnly + server session** (lookup en DB). Es más seguro que el JWT en `localStorage` actual (elimina XSS-token-theft). Cambia el contrato del frontend: `axios.ts`/`useAuth.ts`/`AuthAPI.ts` dejan `localStorage.AUTH_TOKEN` y pasan a cookies (withCredentials). Si se quiere stateless, hay `cookieCache` con `strategy:"jwt"` + plugin JWT (con el trade-off de invalidación).
**Lean:** cookies httpOnly (default) — más robusto y es lo esperado en un SaaS.

## 6. Casos especiales a resolver
- **Service token** (`createServiceToken`, JWT largo para el worker LPR): better-auth no lo cubre nativo. → usar el **plugin `apiKey`** o el plugin JWT de better-auth para credenciales de máquina, o mantener un emisor de service-tokens propio acotado. Decidir.
- **Códigos de 6 dígitos** (confirm/reset, tabla `Token`): se solapan con la verificación nativa de better-auth (`verification`). → migrar esos flujos a better-auth (emailOTP / verification) y retirar la tabla `Token` propia.
- **Emails** (`AuthEmailService`, 4 flujos): re-cablear a los hooks de better-auth (`sendVerificationEmail`, `sendResetPassword`, etc.) manteniendo tus templates.
- **bcrypt:** better-auth usa scrypt; override `emailAndPassword.password.hash/verify` para seguir con bcrypt (no hay passwords que migrar igual). 
- **JWT_SECRET hardcodeado** `'yourSecretKey'` (auth.module.ts:25): arreglar de paso.

## 7. Multi-tenant (organization = condominio)
- `organization` plugin: tablas `organization`/`member`/`invitation`/`team`; la sesión gana `activeOrganizationId`. → **organization = condominio**.
- `team` = subgrupo dentro del tenant (útil para **torres/edificios** de un condominio).
- **Tenant scoping en datos:** agregar `organizationId` a las entidades de dominio (vehículos, visitas, detecciones, cámaras, notificaciones, hubs) + un interceptor/guard que filtre por el tenant activo. Es el grueso del trabajo de aislamiento.
- `dynamicAccessControl` solo si cada condominio necesitara roles propios en runtime (por ahora, no).

## 7b. Onboarding y creación de cuentas (modelo de negocio)
**Política: NADIE se auto-registra** (`disableSignUp: true`). Las cuentas se crean en cascada, tal como Benjamin lo tenía pensado — y better-auth lo da nativo:

```
Plataforma (super-admin / nosotros)
  └─ crea el Condominio (organization) + su Administrador (owner de la org)
        └─ el Admin del condominio crea/invita a SUS usuarios
              (residentes, conserjes) DENTRO de su organization
```

Mecanismos de better-auth (organization + admin plugin):
- **Invitaciones** (`organization.inviteMember({ email, role })`): email al invitado → acepta y establece su contraseña. Tablas `invitation`/`member` ya vienen con el plugin.
- **Creación directa por admin** (admin plugin / API server-side): el admin crea la cuenta y el usuario la activa con un link de "establecer contraseña" (reutiliza el flujo de verification/reset).
- **Roles de la organización** (owner/admin/member, customizables) → se mapean a: Admin-condominio / Conserje / Residente.

Esto **reemplaza** el `/auth/register` deshabilitado y el "cuenta creada por admin" propio (`sendAccountCreatedByAdminEmail`). Se materializa en las fases de **organization (tenant)** + **flujos**. Guía: skill `organization-best-practices`.

## 8. Plan de migración (por pasos, cadencia en días)
1. **Spike/POC:** instalar `nestjs-better-auth` + skills; levantar auth email+password con bcrypt override; verificar body-parser deshabilitado y coexistencia con TypeORM (schema separado o tabla compartida).
2. **Modelo User:** implementar opción C (o A si el POC lo pide); enlazar roles/permisos; poblar `request.user` con permisos (customSession).
3. **Guards:** cambiar `AuthGuard` propio por el de la lib; **conservar `AuthorizationGuard` + decoradores** (verificar que `request.user` trae `roles.permissions`).
4. **Flujos:** migrar confirm/reset/forgot a verification de better-auth; re-cablear emails; resolver service-token.
5. **Multi-tenant:** organization plugin; agregar `organizationId` + scoping a entidades de dominio.
6. **Frontend:** migrar de `localStorage` a cookies (withCredentials); ajustar `useAuth`/`usePermissions`/`ProtectedRoute` al nuevo contrato.
7. **Limpieza:** retirar `auth.service`/`auth.guard`/`Token` propios ya reemplazados; arreglar `JWT_SECRET`; tests de los flujos críticos.

## 9. Riesgos y mitigaciones
- **Seguridad de la propia lib:** el update "Security update: June 2026" parchó varias CVEs (2 críticas en SSO y OIDC/MCP). → **pinnear versión**, no usar plugins deprecados, suscribirse a advisories.
- **Bugs `modelName`** (`#6391`/`#3774`): afectan la opción B → preferir C.
- **"better-auth quiere ser dueño del user"** + cookie-chunking (reportes 2026) → diseñar bien el esquema de sesión/cookies; opción C lo evita.
- **Express vs Fastify:** el backend debe correr sobre **Express** (el soporte Fastify de la lib es beta, issue `#147`). Confirmar (NestJS default es Express — OK).
- **Bus-factor** de la lib community → mantener la opción de caer al handler vanilla si se abandonara.

## 10. Decisiones (cerradas — Benjamin, 2026-07-11)
1. **Modelo User:** ✅ **Opción C** — `user` de better-auth canónica + campos de dominio extendidos (rut/phone/age/family/roles). Un solo modelo de usuario.
2. **Sesión:** ✅ **Cookies httpOnly** (default de better-auth). El frontend migra de `localStorage.AUTH_TOKEN` a cookies (`withCredentials`).
3. **Service token (worker LPR):** ✅ **Plugin `apiKey`** de better-auth para credenciales de máquina.
4. **Tenant:** ✅ **Solo `organization` = condominio** por ahora; `teams` (torres/edificios) se agregan después si el piloto lo pide.

Con esto el diseño queda **cerrado** y listo para implementar en la Fase 0.

## 11. Estado del POC (2026-07-11) — ✅ verificado
better-auth quedó montado **en paralelo** al auth propio, sin romper nada. Verificado end-to-end (build limpio, sign-in con cookie httpOnly, get-session ok, rutas propias siguen 401). Archivos: `src/auth/better-auth.ts`, `main.ts`, `app.module.ts`, `scripts/create-better-auth-schema.js`. Schema Postgres dedicado `better_auth`; bcrypt override; `secret` 48 chars.

**Correcciones/hallazgos del POC:**
- El plugin **apiKey NO está en el core** de better-auth 1.6.23 → es paquete **oficial separado** `@better-auth/api-key` (mismo monorepo). Ya instalado.
- **Orden de carga de env:** `better-auth.ts` construye el `pg.Pool` a nivel de import (antes de `ConfigModule`) → requiere `import 'dotenv/config'` explícito.

**Aristas de seguridad a resolver al cablear better-auth como auth REAL (checklist de la skill `better-auth-security-best-practices`):**
- 🔴 **Sign-up abierto:** `emailAndPassword` sin `disableSignUp` deja `/api/auth/sign-up/email` público — contradice la política "solo admins crean usuarios". Cerrar con `disableSignUp: true` + creación por invitación/admin (organization plugin).
- 🟠 **Rate limiting:** en prod viene ON, pero `storage` default es "memory" → configurar `storage: "database"` + `customRules` para sign-in/sign-up.
- 🟠 **Prod:** `baseURL` con HTTPS + `useSecureCookies`; auditar `npm audit` (vulns detectadas al instalar) con cybersecurity-engineer antes de mergear.
- 🟡 **Audit logging** vía `databaseHooks` (sesión creada/revocada) — refuerza la narrativa de seguridad de la tesis.

## 12. Tarea #16 — Modelo User unificado ✅ (2026-07-11, verificado)
El `user` de better-auth es la fuente de verdad (opción C). **Una sola tabla `user` en `public`**: TypeORM la crea (declara columnas nativas de better-auth + additionalFields `rut/phone/age/profilePicture`); better-auth crea `session/account/verification/organization/...` vía su CLI. `confirmed`→`emailVerified` nativo. `generateId: uuid` calza con las FK existentes. Plugin `customSession` inyecta `roles`+`permissions` (SQL parametrizado) en `get-session`. Verificado por Nova: build limpio, login legacy + módulos dependientes (`/users`,`/vehicles`) 200, sign-up + get-session devuelven el user unificado con roles/permisos. El RBAC fino quedó intacto.

**Aristas transitorias (para #17/#18/#19):**
- 🟠 **Dos stores de credenciales** conviven: `user.password` (legacy, AuthService JWT) y tabla `account` (better-auth). Un usuario existe en un path de login o el otro hasta que #17/#18 unifiquen. `user.password` quedó `nullable`.
- 🔴 **`disableSignUp` sigue sin setear** — `/api/auth/sign-up/email` alcanzable. Cerrar en #18/onboarding.
- 🟠 **`rut`/`phone` son additionalFields requeridos** → los flujos de invitación/creación por admin (#19, onboarding §7b) DEBEN proveerlos o el INSERT falla por NOT NULL. `phone` es `varchar(15)` (formato chileno `+569XXXXXXXX` = 12, cabe).

## 13. Tarea #17 — AuthGuard dual-mode ✅ (2026-07-11, verificado)
`src/auth/auth.guard.ts` reescrito: autentica vía **sesión de better-auth (cookie)** como primario y **JWT Bearer legacy** como fallback (`??`); en ambos caminos carga el User completo (roles.permissions.family) → `request.user`. `AuthorizationGuard` + los 114 `@RequirePermissions` + `@Public` intactos. Verificado por Nova: legacy 200/401/401, cookie better-auth 403(sin rol)/200(con rol). Build limpio.
- **Modo dual = transitorio:** #20 migra el frontend a cookies; #21 retira el fallback JWT.
- 🔴 **Deuda Jest/ESM (para #21):** `@thallesp/nestjs-better-auth` importa subpaths ESM-only de better-auth → Jest no puede parsear specs que importen `auth.guard.ts` (Node 22 sí, la app y el build funcionan). El suite ya estaba 100% rojo en baseline por otras razones. Arreglar la config de Jest (transform/ESM) antes de escribir tests de auth.

## 14. Tarea #18 — Flujos de cuenta + apiKey + disableSignUp ✅ (2026-07-11, verificado)
- **`disableSignUp: true`** → `/api/auth/sign-up/email` cerrado (400). Cuentas nacen por `UsersService.createAccountByAdmin` (admin-only) que dispara `requestPasswordReset` para que el usuario ponga su clave.
- **Flujos migrados a better-auth:** forgot/reset → `requestPasswordReset`/`resetPassword`; confirm/verify email → `verifyEmail`/`sendVerificationEmail`. Emails re-cableados a `src/auth/templates/better-auth-email.templates.ts` (nodemailer directo, sin DI). `forgot-password` ahora responde 200 genérico (anti-enumeración).
- **Bridge `user.password`** (mantiene vivo el login legacy hasta #20): `onPasswordReset` + `databaseHooks.account.create.after` espejan `account.password` → `user.password` (mismo hash bcrypt). Verificado: tras reset, login legacy funciona con la clave nueva. Limitación transitoria: `changePassword/setPassword` nativos aún no expuestos → sin bridge propio hasta que se cableen.
- **Service-token:** plugin `apiKey({enableMetadata:true})`; endpoint admin `POST /api/v1/auth/service-api-keys` (perm nuevo `auth.manage-service-tokens`). `createServiceToken` legacy → `@deprecated`.
- Verificado por Nova: build limpio, login legacy + módulos 200, sign-up 400, apiKey 201.
- 🟠 **Deuda (para #21):** `DataInitializationService` NO retro-asigna permisos nuevos a roles ya sembrados (solo si `role.permissions.length===0`) — Super Admin sí (dinámico), pero Administrador/Desarrollador no reciben `auth.manage-service-tokens` en re-seed. Falta un backfill/migration para permisos nuevos.

## Fuentes
Ver informe completo en la bitácora / memoria del research (`agent-memory/deep-web-researcher/better-auth-nestjs-migration-2026.md`). Docs oficiales: better-auth.com (NestJS integration, Organization, Admin, Database, Auth0 migration, Security update June 2026), repo `ThallesP/nestjs-better-auth`, skills.sh/better-auth.
