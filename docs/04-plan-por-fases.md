# 04 — Plan de mejora por fases

Plan priorizado para llevar el prototipo a un sistema **robusto, production-ready y comercializable**. El orden pone primero la base (auth + multi-tenant), para que todo lo que se construya encima nazca aislado por condominio.

> Estado: 🔴 no iniciado · 🟡 en progreso · 🟢 hecho. Todas las fases están 🔴 salvo lo indicado.

## Horizonte temporal
- **Tope:** noviembre. **Ideal:** mediados de septiembre. Son fechas **holgadas** (colchón), no un cronograma inflado.
- **Cadencia real:** desarrollo asistido por IA (Claude Code) → se avanza en **días por fase, no semanas**. Medir por **entregable**, no por calendario.
- **Orden:** Fase 0 (auth/multi-tenant) → Fases 1–2 (agente-cerebro, el diferenciador) → Fases 3–4 (visión, métricas, hardening).
- Regla: no sobredimensionar; la Fase 0 es plumbing con librería, debe ser rápida.

## Fase 0 — Auth robusta + Multi-tenant (migración a better-auth) 🟢 *fundacional — hecho*
> **Completada** y mergeada a `main` en el PR #48 (tareas #15–#23). Ver bitácora `06-bitacora.md` y `modulos/auth-multitenant.md`.

Cerrar identidad, sesiones y aislamiento por condominio de una, aprovechando que hoy no hay datos que migrar.
- **POC primero** (de-risk, ver [D4](05-decisiones-tecnicas.md#d4)): integración better-auth + NestJS, y mapeo del RBAC fino (79 permisos) al modelo de organization/access-control.
- Migrar auth a **better-auth** (identidad, sesiones, OAuth/2FA si aplica, plugins de organización/multi-tenant).
- Modelo de **tenant = condominio**: aislamiento en datos (scoping por `tenantId`), auth y configuración.
- Cerrar el **gap de auth en endpoints** hoy abiertos (ingesta LPR/anomalías + token de OpenAI).
- **Entregable:** auth robusta + sistema multi-tenant listo; todo lo siguiente se construye tenant-aware.
- *Habilita la tesis de emprendimiento (SaaS multi-condominio) + "production-ready".*

> **Diseño detallado (F1+F2):** ver [modulos/agente-cerebro.md](modulos/agente-cerebro.md) — contrato `VigiliaTool`+Zod, `AuthorizedContext` sobre el RBAC de Fase 0, seguridad anti prompt-injection, y el mapa del código actual (qué migrar/separar/arreglar).
>
> **Reajuste clave (2026-07-12):** la frontera F1/F2 **no** es "framework viejo vs nuevo" sino **alcance de capacidades**. El framework definitivo (Vercel AI SDK, [D1](05-decisiones-tecnicas.md#d1)) entra **desde Fase 1** — el cerebro hoy vive en los clientes atado a OpenAI, así que llevarlo al backend **no es "mover", es reconstruir**; hacerlo sobre el AI SDK una sola vez evita reescribir lo migrado. Principio rector: *la IA orquesta, NestJS decide y calcula; el catálogo de tools es el activo durable, el framework es la pieza desechable.*

## Fase 1 — Consolidar el core del agente en el backend (sobre AI SDK) 🟢 *hecho*
> **Completada** y mergeada a `main` (PR #49); hardening de cierre en PR #52. Ver [modulos/agente-cerebro.md](modulos/agente-cerebro.md).

Reconstruir el cerebro como **única fuente de verdad en el backend**, ya tenant-aware, sobre la base definitiva.
- **Agent Runner sobre Vercel AI SDK** ([D1](05-decisiones-tecnicas.md#d1)) con el system prompt en una sola copia (hoy duplicado en web + `vigilia-hub`).
- Contrato **`VigiliaTool` + Zod (in/out) + dispatcher + `AuthorizedContext`**, reusando el **RBAC de Fase 0** (79 permisos, `tenantId` del contexto, nunca del modelo).
- **Paridad**: reimplementar las 5 tools de facto de hoy como `VigiliaTool` (read primero, p. ej. `buscar_residente`).
- **Arreglar el gap de Fase 0:** `/concierge/*` hoy **sin guard** → el agente quedó fuera del multi-tenant (`buscar_residente` solo ve `organizationId IS NULL`). Añadir guard + `organizationId` a `ConciergeSession`.
- Separar responsabilidades (`OpenAITokenService` mezcla voz Realtime + Vision GPT-4o).
- Web y `vigilia-hub` pasan a **transportes delgados** (audio/estado + I/O físico, sin lógica de agente).
- **Entregable:** el agente responde y actúa desde el backend, tenant-aware; los clientes solo transportan.

## Fase 2 — Agente-cerebro completo (expansión) 🟢 *núcleo hecho*
> **Núcleo completado** (PR #51) + hardening (PR #52). Estado real y lo diferido, abajo.

El agente como gestor con acceso a todas las capacidades, sobre el core de Fase 1.
- **Set completo de tools** sobre los módulos: vehículos, visitas, portón/puerta, llamar a residencia, anomalías/accesos, reportes, notificaciones — con **write sensible** (approval / políticas de autonomía por condominio).
- Orquestación **event-driven** (patente, citófono, anomalía → decisión).
- Capa de **voz en tiempo real** ([D2](05-decisiones-tecnicas.md#d2)): modelo realtime como transporte, tools resueltas por el backend; RPi como puente de audio delgado.
- **Entregable:** un agente que atiende el citófono y razona/actúa sobre el sistema. **← corazón del diferenciador.**

> **Estado real (2026-07-12):**
> - ✅ **Set de tools** sobre el dominio: consulta (`buscar_residente`, `consultar_vehiculo`, `consultar_visitas`, `consultar_accesos_recientes`) + write (`abrir_acceso` portón/puerta, `guardar_datos_visitante`, `notificar_residente`, `reenviar_notificacion`, `finalizar_llamada`).
> - ✅ **Mecanismo de autonomía**: `requiresApproval` **dinámico** + `PendingAction` (escalamiento al residente/conserje + aprobación idempotente + aviso en vivo al visitante).
> - ✅ **Voz realtime ya resuelta en F1** (cliente delgado; D2 opción a) — F2 no la reconstruyó.
> - ✅ **Apertura autónoma**: la cubre el **flujo LPR determinista** (patente + visita válida → abre, tenant-scoped por la cámara); el agente por citófono **escala al residente** (fail-closed, sin identidad verificada en la sesión).
> - ⏳ **Diferido (no bloquea el entregable):** orquestación **event-driven** (over-engineering sin canal conversacional), tools **write de gestión** (crear visitas / reportes), y cablear identidad verificada LPR/QR↔sesión (redundante con el flujo LPR para el caso vehicular).
> - 🟠 **Follow-up de seguridad:** la service-key del worker LPR es global → ligar por-condominio (como el secret-por-hub de F1).

## Fase 3 — Visión: evaluación y mejora 🔴
- Evaluar la **última YOLO** (variante nano) vs los modelos actuales, para patentes, OCR y anomalías, con benchmark sobre datos del piloto ([D3](05-decisiones-tecnicas.md#d3)).
- Definir el split **cloud/edge** de inferencia con números reales ([D5](05-decisiones-tecnicas.md#d5)).
- (Opcional, objetivo 1) reconocimiento de **rostros**.
- **Entregable:** pipeline de visión validado con números + costo por condominio.

## Fase 4 — Métricas, validación en piloto y hardening 🔴
- **Métricas al dashboard** para admins del condominio + métricas internas de desarrollo.
- Validación en piloto (objetivo 5): precisión, tiempos de respuesta, satisfacción.
- **Tests** en módulos críticos, observabilidad, quitar `synchronize:true`.
- **Entregable:** evidencia cuantitativa para la defensa + sistema desplegable.

## Mapa fases ↔ objetivos de la tesis
| Objetivo | Fase(s) |
|---|---|
| 1. Visión (patentes/rostros) | 3 (base en el sistema actual) |
| 2. IoT citófono | 1–2 (agente + hub como transporte) |
| 3. App residentes | ya construida; se refina transversalmente |
| 4. Dashboard admin | 4 (métricas) |
| 5. Validación con métricas | 4 |
| SaaS multi-condominio (emprendimiento) | 0 |

## Fases y módulos
Las fases se ejecutan por **módulos**; al abrir un módulo se documenta su diseño en `docs/modulos/<modulo>.md` antes de implementar. Este archivo es el índice de alto nivel.
