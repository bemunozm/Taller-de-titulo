# 04 — Plan de mejora por fases

Plan priorizado para llevar el prototipo a un sistema **robusto, production-ready y comercializable**. El orden pone primero la base (auth + multi-tenant), para que todo lo que se construya encima nazca aislado por condominio.

> Estado: 🔴 no iniciado · 🟡 en progreso · 🟢 hecho. Todas las fases están 🔴 salvo lo indicado.

## Horizonte temporal
- **Tope:** noviembre. **Ideal:** mediados de septiembre. Son fechas **holgadas** (colchón), no un cronograma inflado.
- **Cadencia real:** desarrollo asistido por IA (Claude Code) → se avanza en **días por fase, no semanas**. Medir por **entregable**, no por calendario.
- **Orden:** Fase 0 (auth/multi-tenant) → Fases 1–2 (agente-cerebro, el diferenciador) → Fase 3 (robustez del `lpr/`) → Fase 4 (hardening pre-piloto: seguridad, base de producción, privacidad) → Fase 5 (banco de pruebas y benchmark de visión, en paralelo con la 4) → Fase 6 (kiosko QR, pendiente de confirmación) → Fase 7 (piloto y validación). La redacción de la tesis corre en paralelo desde ya.
- **Replanificación (2026-10-08):** una auditoría integral (estado por subsistema, builds/tests, seguridad y fuentes de video; ver memoria del proyecto) concluyó que el sistema **no es apto para piloto**: hay caminos que abren el portón sin aprobación, el repo es público con credenciales en su historial, no existe migración base de BD ni CI, y faltan mínimos de la Ley 21.719. Las Fases 4–7 se reescribieron a partir de esa auditoría.
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

## Fase 3 — Visión: robustez, instalabilidad y operabilidad del `lpr/` 🟡 *en progreso*
> **Reencuadre (2026-07-17):** una auditoría integral de `lpr/` (5 frentes adversariales; ver [modulos/vision-auditoria.md](modulos/vision-auditoria.md)) reveló que el subsistema **no filtra las detecciones que emite** (el gate de confianza está desconectado), **es incapaz de reportar sus propios fallos** (el manejador de excepciones es código muerto → 7 meses de bugs invisibles) y **no se instala en una Raspberry limpia**. Optimizar modelos sobre esa base habría producido números sobre ruido. Por eso la Fase 3 pasa a ser **correctitud + producto**, y la evaluación/benchmark de modelos se movió a la nueva **Fase 5**.

Dejar el pipeline de visión **correcto, desplegable y operable** antes de medirlo o migrarlo.
- **3.A — Correctitud del pipeline:** conectar `post_event` al gate de confianza; arreglar el manejador de excepciones del executor (hoy traga todo); `continuedebug` (`NameError`); purgar `plate_sightings` (destruye la confirmación multi-frame); cablear el filtro de tamaño de crop (config muerta); `LPR_PLATE_REGEX` chileno (18 letras); honrar `enableGuardian:false`.
- **3.B — Instalabilidad:** pins + lockfile, `pydantic-settings`, arreglar `pyproject.toml` (hoy empaqueta cero), systemd/Docker, `.env.example` completo, gestión unificada de modelos, borrar `yolo11s.pt` huérfano y `transformers` sin uso.
- **3.C — Operabilidad:** supervisión real de workers (`/health` honesto), reconexión RTSP con timeouts + detección de frames stale, rotación de logs, retención de disco, cola local de eventos (autonomía sin internet).
- **3.seg — Seguridad pre-piloto:** cerrar el fail-open del manager (`if not SECRET: return True`) y el path traversal vía `camera_id`; dejar de filtrar la RTSP con credenciales al backend.
- **Entregable:** worker de visión que **solo emite lo que debe**, **grita cuando falla**, y **se instala y se mantiene** en la RPi del piloto.

> **Estado (2026-10-08):** 3.A, 3.B, 3.seg y 3.C están hechos en código, con 30 tests verdes en `lpr/tests`, pero **sin commitear** en `feature/fase-3-lpr-robustez`. Queda diferida la **cola local de eventos** de 3.C (autonomía sin internet): no bloquea un piloto con conectividad.
- **3.cierre — Higiene inmediata (hoy):**
  - **Rotar la API key/secret de Cloudinary:** el repo es **público** y `lpr/.env` estuvo versionado entre `ce303fe` y `e23a490`.
  - Confirmar que ningún entorno usa el `JWT_SECRET` de ejemplo.
  - Commitear la Fase 3 por bloques, abrir PR a `main` y mergear.
  - ✅ Investigación del citófono versionada en [`docs/investigaciones/aiphone-gt-vs-kiosko-qr/`](investigaciones/aiphone-gt-vs-kiosko-qr/informe.md).

## Fase 4 — Hardening pre-piloto: seguridad, base de producción y privacidad 🔴
> **Origen:** auditoría de seguridad y de builds/tests del 2026-10-08. **Nada de esta fase es opcional antes de un piloto con personas reales**, porque el sistema abre puertas físicas y guarda datos personales. Se trabaja en ramas separadas por bloque, desde `main` ya con la Fase 3 mergeada.

- **4.A — Seguridad de la apertura física (1–2 días)**
  - **Visitas "esperando aprobación":** hoy `notifyResident` crea la visita en `PENDING` con la patente que dicta el visitante, y el LPR acepta `PENDING` → 24 h de acceso en auto sin que nadie apruebe. Crear un estado propio (p. ej. `AWAITING_APPROVAL`) que el LPR no acepte, y pasar a `PENDING`/aprobada solo cuando un residente apruebe.
  - **`POST /concierge/session/:id/respond`:** exigir sesión humana, permiso explícito, que el usuario esté entre los residentes notificados y un DTO con `@IsBoolean()` (hoy `"false"` aprueba).
  - **Kiosko web:** sacar `VITE_KIOSK_HUB_SECRET` del bundle público (build aparte o credencial por dispositivo); los hubs tipo kiosko solo pueden usar `start/execute-tool/end` con tools mínimas.
  - **Escalada de roles:** impedir que un admin de condominio asigne roles de plataforma (hoy puede volverse super-admin vía `PATCH /users/:id`).
  - Límites de tasa en `session/start`, `/respond` y `forgot-password`.
- **4.B — Aislamiento multi-tenant y transporte (1–2 días)**
  - Filtrar por condominio `detections` (listados, intentos, pendientes), `users` y `units` (hoy hay fugas de RUT/teléfono entre condominios).
  - `UnitsController` con `AuthorizationGuard` y permisos reales.
  - WebSocket de notificaciones autenticado en el handshake, salas por condominio, sin imágenes en base64 por broadcast.
  - **MediaMTX** con autenticación contra el backend y puertos acotados.
  - **`wss://` obligatorio** entre hub y backend en producción.
  - Canal del citófono/kiosko con tools mínimas (`buscar_residente`, `guardar_datos_visitante`, `notificar_residente`, `finalizar_llamada`). Los datos de la BD van al modelo como datos, nunca como mensaje `system`.
- **4.C — Base de producción (2–3 días)**
  - **Migración base** del esquema actual, `data-source.ts` para el CLI de TypeORM y `migrationsRun`. Quitar la dependencia de `synchronize`, incluidas las entidades de better-auth.
  - Reparar los **67 tests rojos** del backend (módulos de test desactualizados) y los **3 del control de relés** del hub.
  - **CI mínimo** en GitHub Actions: build + tests del backend y del hub, `tsc` + lint del frontend, `pytest` de `lpr/`.
  - Actualizar dependencias con vulnerabilidades alcanzables (socket.io-parser, ws, engine.io, multer, axios, react-router, torch, Pillow).
  - Retirar la ruta legacy de JWT y los tokens de servicio de 365 días. Rechazar secretos con valor de ejemplo (`JWT_SECRET`, manager LPR, `CAMERAS_ENCRYPTION_KEY`).
  - **Service-key del worker LPR por condominio/cámara** (follow-up de Fase 2).
  - `Logger` de Nest en vez de `console.*`: quitar el `console.log(createUserDto)`, que imprime contraseñas. Normalizar CRLF con `.gitattributes`.
- **4.D — Privacidad mínima, Ley 21.719 (1 día; vigente desde el 1-dic-2026)**
  - Aviso al visitante de que atiende una IA y qué datos se procesan, en el citófono y en la web del kiosko.
  - Job de **retención/anonimización** de datos de visitantes, sesiones del conserje e imágenes (30–90 días).
  - Sacar la imagen base64 de la tabla de anomalías.
  - Inventario de encargados (OpenAI, Cloudinary, proveedor SMS) y procedimiento para los derechos de los titulares.
  - La voz **no** se usa para identificar; si algún día se usa, pasa a ser dato biométrico y requiere consentimiento expreso.
- **Entregable:** sistema **apto para piloto**: sin caminos de apertura no autorizados, aislado por condominio, desplegable desde migraciones, con CI en verde y mínimos de privacidad cumplidos.

## Fase 5 — Visión: banco de pruebas, benchmark y rendimiento 🔴 *(en paralelo con la Fase 4)*
> Sobre un `lpr/` ya correcto y desplegable (Fase 3), recién ahora tiene sentido medir y optimizar. Primero el **banco de pruebas**, porque sin datos con verdad de terreno cualquier optimización es a ciegas.

- **5.A — Banco de pruebas (1–2 días)**
  - **Cámaras simuladas:** MediaMTX + FFmpeg publicando videos en bucle como RTSP (`ffmpeg -re -stream_loop -1 -i video.mp4 -c copy -f rtsp rtsp://localhost:8554/porton`).
  - **Datasets** (solo fuentes con licencia; nunca cámaras de terceros expuestas ni feeds licenciados como los de sitios de apuestas):
    - **RodoSol-ALPR** (patentes Mercosur, cámara fija): requiere acuerdo académico, **pedirlo ya**.
    - **Roboflow "Patentes 2"** (CC BY 4.0, detección de patentes chilenas).
    - **MEVA** (CC BY 4.0) y **VIRAT** para intrusos.
  - **Captura propia autorizada** en San Lorenzo: 300–500 frames etiquetados con el texto de la patente. **No existe ningún dataset público de video con patentes chilenas**, así que esta es la base de la métrica de la tesis.
  - **Script de métricas:** exact match por patente y por carácter, falsos positivos por hora de escena vacía, y latencia punta a punta con timestamps del worker.
- **5.B — Acceso a las cámaras reales ([D6](05-decisiones-tecnicas.md))**
  - El NVR es un **Hikvision DS-7616NI-K2/16P**: 16 canales con **PoE integrado**, así que las cámaras viven en la red interna del NVR y el LPR consume el RTSP del propio NVR (`/Streaming/Channels/<n>01`).
  - Pasos: entrar por HDMI y mouse; si nadie tiene la clave, reseteo oficial de Hikvision con autorización escrita del comité; crear un usuario dedicado de solo visualización.
  - Identificar qué cámara cubre el portón.
- **5.C — Rendimiento y precisión**
  - **Runtime liviano:** exportar los YOLO a ONNX/NCNN y sacar torch del runtime (−60% RAM, ~2,3× CPU, sin reentrenar) ([D3](05-decisiones-tecnicas.md#d3), [D5](05-decisiones-tecnicas.md#d5)).
  - **Reglas y scoring:** rediseñar la confirmación (agrupar por *paso de vehículo*, no por string) y el scoring (que domine la señal más débil, no una media ponderada).
  - **Robustez ambiental:** CLAHE, gate de nitidez, `imgsz`, para noche/contraluz/niebla, financiado con el motion-gating que hoy el LPR no tiene.
  - **Guardián:** zonas dinámicas, merodeo consciente de zona, revisar el motion-gating que ciega al merodeo.
  - **Evaluar la última YOLO** (YOLO26n) contra la actual, y el OCR (`cct-xs-v2` + charset chileno), con el banco de pruebas de 5.A y luego con datos del piloto (RPi5 objetivo).
  - (Opcional, objetivo 1) reconocimiento de **rostros**.
- **Entregable:** pipeline de visión validado con números reales + costo/cámaras por condominio (input de pricing del SaaS).

## Fase 6 — Kiosko QR de acceso peatonal 🔴 *(pendiente de confirmación)*
> Decisión de integración con el citófono: ver [investigaciones/aiphone-gt-vs-kiosko-qr](investigaciones/aiphone-gt-vs-kiosko-qr/informe.md) (informe y notas, 2026-09-26). Se recomienda el **kiosko QR** frente a intervenir la placa del Aiphone: no anula la garantía, no requiere asamblea extraordinaria (Ley 21.442) y, si falla, el citófono sigue funcionando. El **Aiphone queda intacto** como canal para quien no tiene smartphone.

- **Prerrequisitos**
  - **Permiso del comité de administración** de San Lorenzo.
  - **Inspección en terreno:** terminal **BP** del GT-DB y su polaridad, modelo del motor del portón y su entrada **P.P./START**, enchufe y WiFi en la entrada.
- **Backend (~3 días)**
  - Token de QR rotativo por dispositivo (30–60 s, un solo uso).
  - Canje público del token por una sesión del conserje, con límite de tasa.
  - Flujo "invitación + presencia": una visita pre-registrada abre por regla determinista al escanear el QR físico.
  - Verificar el posible desajuste de WebSocket del kiosko (escucha en la raíz y `visitor:response` sale por `/hub`).
- **Web del visitante (~2 días):** adaptar `DigitalConciergeView` para entrar por QR sin login, con aviso de privacidad antes de pedir el micrófono.
- **Firmware del kiosko ESP32 (2–3 días):** muestra el QR que entrega el backend y se reconecta solo. **No tiene cables hacia la puerta.**
- **Módulo de apertura en el lado protegido (1–2 días):** `vigilia-hub` con relé de señal con contacto de oro (Omron G5V-1) o PhotoMOS (AQY212) hacia **BP** (puerta, pulso de ~0,5 s), y relé hacia la entrada **P.P./START** del motor (portón, pulso corto de 200–500 ms), con watchdog. Los módulos de relé genéricos con contacto de plata no son fiables con la baja corriente de BP.
- **Entregable:** visitante → QR → conserje IA en su celular → residente aprueba en la app → se abre la puerta o el portón, con todo registrado.

## Fase 7 — Piloto San Lorenzo y validación (objetivo 5) 🔴
- Despliegue en la RPi/servidor del piloto **desde migraciones y CI** (Fase 4).
- **Métricas al dashboard** para admins + métricas internas:
  - Latencia **punta a punta** (cámara → decisión → portón), no solo la del backend (`responseTimeMs`).
  - Precisión de lectura sobre accesos etiquetados.
  - Tasa de éxito de llamadas WebRTC en iOS/Android.
- **Satisfacción:** encuesta real a residentes y visitantes (conectar `ShareFeedbackView` o un formulario dedicado).
- **Entregable:** evidencia cuantitativa para la defensa.

## Transversal — Redacción de la tesis
- **Se puede redactar ya:**
  - Estado del arte: investigaciones del citófono, de visión (D3) y del kiosko QR.
  - Arquitectura y decisiones técnicas D1–D6.
  - Auth multi-tenant ([modulos/auth-multitenant.md](modulos/auth-multitenant.md)) y agente-cerebro ([modulos/agente-cerebro.md](modulos/agente-cerebro.md)).
  - Auditoría de visión como capítulo de hallazgos y correcciones.
  - Evaluación de alternativas de integración con el citófono.
  - Análisis de seguridad (hallazgos de la Fase 4 y cómo se cerraron).
- **Después de las Fases 5 y 7:** resultados de precisión, tiempos del piloto y satisfacción.
- **Aporte original a destacar:** no hay literatura revisada por pares sobre agentes de voz con IA como porteros de edificios de varios departamentos.

## Mapa fases ↔ objetivos de la tesis
| Objetivo | Fase(s) |
|---|---|
| 1. Visión (patentes/rostros) | 3 (robustez del pipeline) + 5 (banco de pruebas, benchmark y rendimiento) |
| 2. IoT citófono | 1–2 (agente + hub como transporte) + 6 (kiosko QR y apertura por BP / P.P.) |
| 3. App residentes | ya construida; aprobaciones endurecidas en 4.A |
| 4. Dashboard admin | 7 (métricas al dashboard) |
| 5. Validación con métricas | 5 (benchmark de visión) + 7 (piloto) |
| SaaS multi-condominio (emprendimiento) | 0 + 4.B (aislamiento real por condominio) |

## Fases y módulos
Las fases se ejecutan por **módulos**; al abrir un módulo se documenta su diseño en `docs/modulos/<modulo>.md` antes de implementar. Este archivo es el índice de alto nivel.
