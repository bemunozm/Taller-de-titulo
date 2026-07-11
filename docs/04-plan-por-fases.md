# 04 — Plan de mejora por fases

Plan priorizado para llevar el prototipo a un sistema **robusto, production-ready y comercializable**. El orden pone primero la base (auth + multi-tenant), para que todo lo que se construya encima nazca aislado por condominio.

> Estado: 🔴 no iniciado · 🟡 en progreso · 🟢 hecho. Todas las fases están 🔴 salvo lo indicado.

## Horizonte temporal
- **Tope:** noviembre. **Ideal:** mediados de septiembre. Son fechas **holgadas** (colchón), no un cronograma inflado.
- **Cadencia real:** desarrollo asistido por IA (Claude Code) → se avanza en **días por fase, no semanas**. Medir por **entregable**, no por calendario.
- **Orden:** Fase 0 (auth/multi-tenant) → Fases 1–2 (agente-cerebro, el diferenciador) → Fases 3–4 (visión, métricas, hardening).
- Regla: no sobredimensionar; la Fase 0 es plumbing con librería, debe ser rápida.

## Fase 0 — Auth robusta + Multi-tenant (migración a better-auth) 🔴 *fundacional*
Cerrar identidad, sesiones y aislamiento por condominio de una, aprovechando que hoy no hay datos que migrar.
- **POC primero** (de-risk, ver [D4](05-decisiones-tecnicas.md#d4)): integración better-auth + NestJS, y mapeo del RBAC fino (79 permisos) al modelo de organization/access-control.
- Migrar auth a **better-auth** (identidad, sesiones, OAuth/2FA si aplica, plugins de organización/multi-tenant).
- Modelo de **tenant = condominio**: aislamiento en datos (scoping por `tenantId`), auth y configuración.
- Cerrar el **gap de auth en endpoints** hoy abiertos (ingesta LPR/anomalías + token de OpenAI).
- **Entregable:** auth robusta + sistema multi-tenant listo; todo lo siguiente se construye tenant-aware.
- *Habilita la tesis de emprendimiento (SaaS multi-condominio) + "production-ready".*

## Fase 1 — Consolidar el agente-cerebro en el backend 🔴
Matar la duplicación y mover el cerebro al servidor, ya tenant-aware.
- Cerebro (prompt + tools + orquestación) como **única fuente de verdad en el backend**.
- Web y `vigilia-hub` pasan a **transportes delgados** (audio/estado, sin lógica de agente).
- Separar responsabilidades (`OpenAITokenService` mezcla voz + Vision).
- **Entregable:** el agente responde y actúa desde el backend; los clientes solo transportan.

## Fase 2 — Agente-cerebro completo 🔴
El agente como gestor con acceso a todas las capacidades.
- Framework de agente provider-agnóstico ([D1](05-decisiones-tecnicas.md#d1) — Vercel AI SDK + `@ai-sdk/gateway`).
- **Set completo de tools** sobre los módulos: vehículos, visitas, portón/puerta, llamar a residencia, anomalías/accesos, reportes, notificaciones.
- Orquestación **event-driven** (patente, citófono, anomalía → decisión).
- Capa de **voz en tiempo real** ([D2](05-decisiones-tecnicas.md#d2)): RPi como puente delgado, voz en la nube.
- **Entregable:** un agente que atiende el citófono y razona/actúa sobre el sistema. **← corazón del diferenciador.**

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
