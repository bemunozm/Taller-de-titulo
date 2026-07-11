# 05 — Decisiones técnicas

Decisiones abiertas y en discusión. Formato mini-ADR. Estado: 🟢 decidido · 🟡 en discusión · 🔴 pendiente.

---

## D1 — Framework del agente (cerebro) 🟡
**Contexto:** hoy el agente está atado a OpenAI y duplicado en clientes. Se quiere un cerebro en el backend, provider-agnóstico.

**Propuesta de Benjamin:** [Vercel AI SDK](https://ai-sdk.dev/) + AI Gateway.

**Evaluación (Nova):** buena elección y apropiada.
- ✅ Provider-agnóstico (OpenAI, Anthropic, Google, etc.), tool-calling de primera clase, streaming, TypeScript-nativo → encaja directo en el backend NestJS.
- ✅ El AI Gateway agrega ruteo/fallback/observabilidad de proveedores, pero **es opcional**: el desacople de proveedor ya lo da el SDK a nivel de código (puedes usar los providers directo sin Gateway). Ojo: el Gateway es un servicio hosteado (dependencia + costo + los datos pasan por Vercel) — a considerar si algo debe ser on-prem/edge.
- 💡 **Alternativa a evaluar encima del AI SDK:** [Mastra](https://mastra.ai/) — framework de agentes construido sobre el propio Vercel AI SDK; añade agentes, workflows, memory y tools con más estructura. Si queremos scaffolding de agente listo, Mastra; si queremos control total y mínimas dependencias, AI SDK "core" (`streamText`/`generateText` + tools + loop propio).

**Lean:** AI SDK core como base; evaluar Mastra si necesitamos más andamiaje. Gateway opcional.

---

## D2 — Capa de voz en tiempo real 🟡
**Contexto:** el cerebro (D1) razona con texto/tools; hablar con el visitante en el citófono necesita **speech-to-speech de baja latencia**. Son problemas distintos.

**Opciones:**
- (a) Mantener un **modelo realtime dedicado** (hoy OpenAI Realtime) como transporte de voz, y que sus tool-calls apunten al **cerebro del backend** (única fuente de verdad de tools/lógica).
- (b) Desacoplar STT → cerebro (AI SDK, cualquier modelo) → TTS: 100% provider-agnóstico pero **más latencia** (malo para una llamada).

**Lean:** (a) — voz realtime como transporte, tools resueltas por el backend. Reconcilia "cerebro agnóstico" con "mejor voz". Revisar si el AI SDK/Gateway ya expone una vía realtime aceptable.

**Voz en la Raspberry (decidido 🟢):** la RPi NO corre ASR. Es un **puente de audio delgado** (captura mic del citófono + reproduce respuesta); el speech-to-speech ocurre en la nube (modelo realtime). Lo único local: **VAD** liviano (`webrtcvad` / Silero) para turnos. Excepción: si no hay internet confiable en la conserjería, STT offline con **Vosk** (mejor que whisper.cpp en RPi, tiene español) — degrada UX, no es el default del piloto.

> Nota: "AI Gateway" = el provider `@ai-sdk/gateway` del propio AI SDK (acceso multi-modelo + failover con una API key), no un producto edge aparte. Los datos pasan por el gateway hosteado (a considerar solo si algo debe ser 100% on-prem).

---

## D3 — Modelos de visión 🟡
**Contexto:** hoy YOLOv11 + fast-plate-ocr (relativamente antiguos), para patentes, OCR y anomalías.

**Propuesta de Benjamin:** evaluar la última YOLO (variante nano) para detección de patentes, extracción de texto y anomalías/seguridad.

**Evaluación (Nova):**
- 👍 Buena idea evaluar, pero **medir, no cambiar a ciegas**. La versión exacta ("v26") hay que **verificar cuál es la vigente** de Ultralytics antes de comprometerla.
- El **detector** (YOLO) y el **OCR de patentes** son dos modelos distintos: mejorar uno no mejora el otro. El texto de la patente depende tanto o más del OCR.
- Para anomalías hay una segunda etapa (GPT-4o Vision). Evaluar si conviene un detector edge + verificación en la nube.

**Acción:** armar un **harness de benchmark** con patentes reales/etiquetadas del piloto y comparar objetivamente (precisión, latencia, tamaño) los candidatos. Se puede delegar una investigación del SOTA actual (deep-web-researcher) cuando lleguemos a Fase 3.

---

## D4 — Auth + Multi-tenant 🟢 (decidido: migrar a better-auth, es Fase 0)
**Contexto:** hoy JWT + RBAC propio (roles/permisos/service-token), **funcional**. Se quiere multi-tenant para SaaS.

**Propuesta de Benjamin:** migrar a [better-auth](https://www.better-auth.com/) (tiene plugins de organización/multi-tenant).

**Evaluación (Nova) — cuidado, trade-off real:**
- La **multi-tenancy es un problema de la capa de datos**, resoluble SIN cambiar de librería de auth (agregar `tenantId` a las entidades + guard/interceptor de scoping por tenant). Bajo riesgo, lo controlas tú.
- Migrar auth es un **rewrite significativo**: re-implementar el RBAC que ya funciona, y **verificar que better-auth encaje bien con NestJS** (better-auth está más orientado a Next.js/Hono; su fit con Nest no es de primera clase — a validar antes de comprometer).
- Better-auth sí vale la pena **si además** quieres sus otras features (OAuth social, orgs, 2FA, sesiones robustas), no solo por el multi-tenant.

**DECISIÓN (Benjamin, 2026-07-11):** migrar a **better-auth** y hacerlo **Fase 0 (fundacional)** para cerrar identidad robusta + multi-tenant desde el inicio, de modo que el agente-cerebro nazca tenant-aware. Aprovechar que **hoy hay ~cero datos (1 usuario)** → la migración es lo más barata que va a ser nunca.

**Razonamiento a favor:** mantener auth hecho a mano es un pasivo (sensible; ya tiene huecos: register deshabilitado, service-token sin enganchar, endpoints sin guard); better-auth trae identidad/sesiones/OAuth/2FA/organizaciones battle-tested; y multi-tenant es central a la tesis de emprendimiento.

**Guardias antes de comprometer la migración completa (POC/spike primero):**
1. **Fit con NestJS** — el core de better-auth es agnóstico (se monta su handler en una ruta), pero no es un módulo Nest nativo; validar que quede cableado limpio.
2. **Mapeo del RBAC fino (79 permisos)** — ver si el plugin organization/access-control lo modela, o dejar permisos app-side y usar better-auth solo para identidad/sesiones/orgs.
3. **Timebox** — es plumbing con librería; no debe comerse el runway de septiembre (donde vive el agente). Si amenaza, se recorta alcance.

**Riesgo asumido:** re-homar los flujos actuales (register/confirm/forgot/reset/profile/service-token/email) al modelo de better-auth. Bounded, y más barato ahora que con datos.

**Resultado del research (jul-2026) — camino elegido:**
- **Stack:** lib community `@thallesp/nestjs-better-auth` (v2.7.0, activa) **+** las skills de skills.sh (agent-skills, se usan junto con la lib). NO montar el handler vanilla.
- **Enfoque híbrido (confirmado por el mapa de auth):** better-auth para identidad/sesión/**organización (=condominio)**/roles gruesos; el **RBAC fino (79 permisos) queda app-side intacto** (`AuthorizationGuard` + `@RequirePermissions`, 114 usos, no se tocan). Poblar permisos en la sesión con `customSession`.
- **Diseño + plan completo:** ver [modulos/auth-multitenant.md](modulos/auth-multitenant.md). Decisiones abiertas ahí: modelo User (A vs C), sesión (cookies vs stateless), service-token, teams.

---

## D5 — Cloud vs Edge (define el modelo de negocio) 🟡
**Contexto:** ¿qué corre en la nube y qué en el sitio? Clave por los modelos de IA que procesan cámaras.

**Evaluación (Nova):**
- **Edge (en el condominio):** el `vigilia-hub` (obligado, está en el hardware) y **la inferencia de visión** (LPR/anomalías) cerca de las cámaras → NO subir video crudo a la nube (ancho de banda, latencia, privacidad), enviar solo **eventos**. El `lpr/` ya es worker por-cámara → encaja. Requiere un **equipo edge** con cómputo (mini-PC / Jetson; la RPi sola es lenta para YOLO).
- **Cloud:** cerebro (agente), DB, app web, dashboard, orquestación multi-condominio.
- **Modelo de negocio derivado:** suscripción SaaS por condominio (cloud) + **appliance edge** (venta/arriendo del equipo). Limpio y defendible.

**Restricción de presupuesto:** NO hay plata para Jetson/mini-PC. El edge debe caber en una **Raspberry Pi 5** o irse a la nube donde salga más barato. Análisis:
- **LPR en RPi5: plausible por-evento** (no 24/7): motion-trigger en el portón → YOLO **nano optimizado** (NCNN/ONNX) a pocos FPS → OCR. Un auto en el portón es lento, no se necesitan 30 FPS.
- **Anomalías/seguridad: NO continuo en RPi** (modelo más pesado + ya se usa GPT-4o Vision). Hacerlo **cloud-on-trigger** (solo frames gatillados).
- **Regla de oro:** el edge manda **eventos/frames**, NUNCA video crudo continuo a la nube (eso dispara ancho de banda + GPU 24/7 y mata el margen del SaaS).
- **Modelo de negocio derivado:** SaaS por condominio (cloud) + la RPi5 como appliance edge barato (puente citófono + LPR gatillado).

**Lean:** edge (RPi5) para hub + LPR gatillado; cloud para cerebro/datos/app + Vision-on-trigger. **Pendiente:** números reales (FPS de YOLO nano en RPi5, costo de inferencia cloud, inversión por condominio) → investigar con deep-web-researcher.

---

## D6 — Sistema de cámaras del condominio 🔴 (pendiente, no bloqueante)
**Lo que se sabe:** San Lorenzo tiene cámaras Hikvision visibles desde una app móvil. Benjamin vive ahí pero no ha podido acceder a la conserjería (no hay contacto con el conserje estos días).
**Riesgo/hipótesis:** alta probabilidad de que sean **IP con RTSP nativo** (Hikvision: `rtsp://user:pass@ip:554/Streaming/Channels/101`) → premisa viable sin encoder.
**Falta confirmar:** ¿hay NVR? IPs/credenciales, cobertura del portón. **No bloquea** el trabajo de arquitectura/agente; sí bloquea la prueba real de captura.
