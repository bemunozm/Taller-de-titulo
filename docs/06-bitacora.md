# 06 — Bitácora

Registro cronológico de conversaciones, decisiones y avances. Lo más reciente arriba.

---

## 2026-07-11 (cont. 7) — Fase 0 #18: flujos + apiKey + disableSignUp ✅
- Delegado a senior-backend-engineer, revisado y verificado por Nova.
- Sign-up cerrado (`disableSignUp`), flujos forgot/reset/confirm migrados a better-auth, emails re-cableados, bridge `user.password` que mantiene el login legacy vivo, service-token vía apiKey.
- Verificado: login legacy + módulos 200, sign-up 400, apiKey endpoint 201. Build limpio.
- Detalle y deudas (#21: retro-assign de permisos, retirar Token/createServiceToken legacy, Jest/ESM) en [modulos/auth-multitenant.md §14](modulos/auth-multitenant.md#14-tarea-18--flujos-de-cuenta--apikey--disablesignup--2026-07-11-verificado).
- **Fase 0: 4/7 tareas hechas (#15–#18). Faltan #19 (multi-tenant/organization), #20 (frontend cookies), #21 (cleanup+seguridad+tests).**

---

## 2026-07-11 (cont. 6) — Fase 0 #17: AuthGuard dual-mode ✅
- Delegado a senior-backend-engineer, revisado y verificado por Nova.
- `AuthGuard` autentica con sesión de better-auth (cookie) primario + JWT Bearer legacy fallback; ambos cargan el User con roles/permisos. RBAC fino intacto.
- Verificado: legacy 200/401/401, cookie better-auth 403(sin rol)/200(con rol Super Admin). Build limpio.
- Deuda para #21: Jest roto por imports ESM-only de la lib (baseline ya estaba rojo). Ver [modulos/auth-multitenant.md §13](modulos/auth-multitenant.md#13-tarea-17--authguard-dual-mode--2026-07-11-verificado).

---

## 2026-07-11 (cont. 5) — Fase 0 #16: modelo User unificado ✅
- Delegado a senior-backend-engineer (con skills), revisado y verificado por Nova.
- `user` de better-auth = fuente de verdad (opción C). Una sola tabla `user` en `public` (TypeORM la crea con nativos + additionalFields); better-auth crea el resto vía CLI. `confirmed`→`emailVerified`; `customSession` inyecta roles/permisos.
- Verificado: build limpio, login legacy + 5 módulos dependientes 200, sign-up + get-session con user unificado (roles/permisos). RBAC fino intacto.
- Aristas transitorias (dual password store, disableSignUp abierto, rut/phone requeridos) documentadas en [modulos/auth-multitenant.md §12](modulos/auth-multitenant.md#12-tarea-16--modelo-user-unificado--2026-07-11-verificado). Onboarding (org+invitaciones) en §7b.
- Documentado el modelo de onboarding: plataforma → admin de condominio → usuarios (sign-up cerrado, invitaciones del organization plugin).

---

## 2026-07-11 (cont. 4) — Fase 0 arrancada: POC better-auth verificado
- Rama `feature/fase-0-auth-multitenant`. Instaladas skills de skills.sh (`.agents/skills`, symlink a `.claude/skills`) y deps (better-auth 1.6.23 + nestjs-better-auth 2.4.0 + @better-auth/api-key).
- **POC (delegado a senior-backend-engineer, revisado por Nova contra las skills):** better-auth montado en paralelo, no destructivo. Verificado end-to-end (build ok, sign-in con cookie httpOnly, get-session ok, auth propio intacto 401). Detalle y aristas en [modulos/auth-multitenant.md](modulos/auth-multitenant.md#11-estado-del-poc-2026-07-11--verificado).
- Aristas flagueadas para el cableado real: sign-up abierto (cerrar `disableSignUp`), rate-limit storage, npm audit, audit logging.

---

## 2026-07-11 (cont. 3) — Research better-auth + mapa de auth → diseño Fase 0
- **Research (deep-web-researcher, jul-2026):** la lib `@thallesp/nestjs-better-auth` está sana (v2.7.0, 4-jul-2026); las skills de skills.sh son agent-skills que se usan junto con la lib. Recomendación: lib community + skills, NO vanilla. Organization plugin = tenant; RBAC fino mejor app-side (customSession). CVEs parchadas en jun-2026 → pinnear versión.
- **Mapa de auth (codebase-explorer):** hallazgo clave = el RBAC es SEPARABLE de la autenticación (`AuthorizationGuard` solo lee `request.user`), así que se reemplaza solo la capa de sesión y se conservan los 114 usos de `@RequirePermissions`. Blast radius acotado.
- **Entregable:** [modulos/auth-multitenant.md](modulos/auth-multitenant.md) — diseño + plan de migración de la Fase 0, con 4 decisiones abiertas para Benjamin (modelo User, sesión, service-token, teams).

---

## 2026-07-11 (cont. 2) — better-auth pasa a ser Fase 0
- **Decisión:** migrar a **better-auth** como **Fase 0 (fundacional)** para cerrar auth robusta + multi-tenant desde el inicio, y que el agente-cerebro nazca tenant-aware. Se aprovecha que hoy hay ~cero datos (migración barata).
- **Guardia de tech lead:** POC primero (fit NestJS + mapeo de los 79 permisos) y **timebox**, para no comerse el runway de septiembre (donde vive el agente, el diferenciador).
- El plan se reordenó: Fase 0 = auth/multi-tenant; Fase 1 = consolidar agente-cerebro en backend; Fase 2 = agente completo; Fase 3 = visión; Fase 4 = métricas/piloto/hardening. Ver [04](04-plan-por-fases.md).

---

## 2026-07-11 (cont.) — Decisiones técnicas afinadas
- **Timeline:** ideal "todo perfecto" a mediados de septiembre (~2 meses); tope noviembre (5 meses). → meta sept = agente-cerebro (Fases 0–1); resto a nov.
- **Voz en RPi (🟢):** la Raspberry es puente de audio delgado; el speech-to-speech va en la nube (realtime). VAD liviano local. Vosk solo si no hay internet.
- **AI Gateway:** aclarado que es el provider `@ai-sdk/gateway` del AI SDK.
- **better-auth (revisado):** se aprueba avanzar (buena opción para SaaS + hoy no hay datos = migración barata), condicionado a un POC (fit NestJS + mapeo RBAC).
- **Presupuesto edge:** sin plata para Jetson → el edge cabe en RPi5 (LPR gatillado por evento) o va a la nube (Vision-on-trigger). Regla: el edge manda eventos/frames, nunca video continuo. Falta investigar números concretos (FPS RPi5, costo cloud).
- **Hardware:** Benjamin decodifica las señales R1/R2 del citófono GT hoy.
- Amin no participa en la construcción.

---

## 2026-07-11 — Retoma del proyecto + definición de enfoque y futuro

**Contexto:** Benjamin retoma la tesis tras un tiempo sin tocarla (antes trabajada con GitHub Copilot, primera vez con Claude Code).

**Trabajo técnico de la sesión:**
- Se indexó el monorepo con **CodeGraph** (índices por-subproyecto + índice raíz unificado + auto-sync) y se actualizó CodeGraph a v1.4.1.
- Se exploró y entendió toda la arquitectura (backend, frontend, lpr, vigilia-hub).
- Se **rescató trabajo sin commitear** (feature "Guardián Visual" end-to-end + LogsModule que estaba mal ignorado por gitignore) y se consolidó en `main` vía PRs #45/#46. Ramas viejas limpiadas; repo quedó ordenado (solo `main`).
- Se levantó el stack completo en local (backend, frontend, Postgres, MediaMTX) y se verificó funcionando. Se aisló el proyecto Docker como `vigilia` (chocaba con RUKLO por carpetas `backend/` homónimas; data de RUKLO intacta).
- Se sembró un usuario Super Admin de bootstrap y se corrigió un bug real (`userSchema.age` no aceptaba `null` → 403 en toda ruta protegida).

**Conversación estratégica (lo importante):**
- Se aclaró la **visión**: el proyecto es un **agente conserje autónomo** (el cerebro del condominio), no "LPR + citófono". Ver [01](01-vision-contexto.md).
- **Hallazgo clave:** el agente de voz hoy vive **duplicado** en frontend y `vigilia-hub`, ya divergido; el backend solo mintea tokens y ejecuta 4 tools. Ver [02](02-estado-actual.md).
- **Decisión de rumbo:** mover el **cerebro al backend** como única fuente de verdad; web y hub pasan a transportes delgados. Ver [03](03-arquitectura-objetivo.md).
- Se detalló el rol de `vigilia-hub`: dispositivo de punteo **dentro** del citófono **Aiphone GT**, que intercepta la llamada antes de la casa, puentea mic/altavoz/teclado, decodifica R1/R2, redirige a la casa marcada, abre portón/puerta.
- Se definió el **plan por fases** ([04](04-plan-por-fases.md)) y se abrieron **decisiones técnicas** ([05](05-decisiones-tecnicas.md)): Vercel AI SDK (+Gateway) para el agente, capa de voz realtime, evaluar última YOLO, better-auth vs extender RBAC para multi-tenant, split cloud/edge, cámaras pendientes.

**Aclaraciones de Benjamin:**
- Cámaras: quedan como incógnita por ahora (sin contacto con el conserje), no bloqueante, alta probabilidad RTSP/Hikvision.
- Amin no participa en la construcción; Benjamin lleva solo el desarrollo (avisará si delega).
- Modelo de negocio aún abierto, depende del split cloud/edge.

**Próximo paso sugerido:** iniciar Fase 0 por un módulo concreto (consolidar el cerebro del agente en el backend), documentando el diseño del módulo antes de implementar.
