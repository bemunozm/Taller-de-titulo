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

## Fuentes
Ver informe completo en la bitácora / memoria del research (`agent-memory/deep-web-researcher/better-auth-nestjs-migration-2026.md`). Docs oficiales: better-auth.com (NestJS integration, Organization, Admin, Database, Auth0 migration, Security update June 2026), repo `ThallesP/nestjs-better-auth`, skills.sh/better-auth.
