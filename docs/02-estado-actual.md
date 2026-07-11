# 02 — Estado actual del sistema

Foto del monorepo a **julio 2026** (tras retomar el proyecto).

## Subsistemas

| Carpeta | Stack | Rol | Estado |
|---|---|---|---|
| `backend/` | NestJS 11 + TypeORM/PostgreSQL | API central: auth/RBAC, vehículos, visitas (QR), cámaras/MediaMTX, notificaciones, ingesta de detecciones, digital-concierge | Maduro/funcional |
| `frontend/` | React 18 + Vite + TanStack Query + Tailwind v4 | App admin/residente/conserje: LPR, streaming (WHEP), trazabilidad, anomalías, dashboard | Maduro |
| `lpr/` | Python + FastAPI + YOLOv11 + fast-plate-ocr | Reconocimiento de patentes (worker por cámara) + modo "guardia" (anomalías) | Funcional, foco IA |
| `vigilia-hub/` | Node/TS (Raspberry Pi) | Puente físico del citófono GT: GPIO, relés, DTMF, audio, apertura de portón | Funcional (prototipo) |
| `mediamtx/` | Binario | Servidor de medios RTSP/WebRTC para las cámaras del condominio | Infra |
| `rtsp-simple-server/` | Binario (= mediamtx) | Solo para **simular** la webcam local como RTSP en pruebas | Redundante con mediamtx |

## Flujo estrella: control de acceso por patente
Cámara → `lpr/` (YOLO detecta patente → OCR → confirma) → `POST /detections/plates` → `DetectionsService.createDetection()` cruza contra vehículos/visitas → decide **Permitido/Denegado** → si Permitido dispara `hub:door_open` (abre portón físico vía `vigilia-hub`) → si no hay match, va a **aprobación del conserje** (expira 5 min).

## El conserje digital HOY (hallazgo importante)
La lógica del agente de voz ("Sofía") está **duplicada en dos clientes**:
- **Frontend** (`DigitalConciergeView.tsx`) — SDK `@openai/agents/realtime` (WebRTC).
- **vigilia-hub** (`concierge-client.service.ts`) — WebSocket nativo a OpenAI ("réplica exacta del flujo del frontend").

Cada copia tiene **su propio prompt y sus propias tools**, y **ya divergieron** (drift). El **backend no orquesta el diálogo**: solo genera el token efímero de OpenAI y ejecuta 4 tools cuando el cliente se las pide (`guardar_datos_visitante`, `buscar_residente`, `notificar_residente`, `reenviar_notificacion`).

➡️ **El cerebro vive en los clientes (por duplicado); el backend es solo un ejecutor de manos.** Es lo que hay que invertir (ver [03](03-arquitectura-objetivo.md)).

Lo que sí está del lado servidor y sirve de base: `DigitalConciergeService` integra Users/Families/Visits/Notifications/Hub/SMS/QR; el dispatcher `executeTool(toolName)` es el enganche natural; `ConciergeSession` ya tiene `source: 'web'|'hub'` y `hubId`; `HubGateway` es el canal seguro backend→Raspberry.

## Gaps / deuda conocida
- 🔴 **Seguridad:** endpoints de ingesta (`/detections/plates`, `/anomalies`) y el de token de OpenAI (`/concierge/session/start`) **sin auth**. Una detección "Permitido" abre el portón → cualquiera con la URL podría abrirlo o abusar del token de IA. Existe `createServiceToken()` sin enganchar.
- 🔴 **Multi-tenant:** una sola DB (`developDB`, un condominio). Para SaaS multi-condominio falta aislamiento por tenant.
- 🟡 **Tests:** cobertura casi nula en módulos críticos (detections, concierge, worker LPR).
- 🟡 **Modelos de visión** relativamente antiguos (YOLOv11 + fast-plate-ocr); conviene evaluar los últimos.
- 🟡 **Duplicación del agente** (frontend vs hub) → doble mantenimiento y comportamiento inconsistente.
- 🔴 **Sistema de cámaras del condominio SIN confirmar** (probablemente Hikvision/RTSP). No bloqueante por ahora.
- `TypeORM synchronize: true` en backend (deuda ya reconocida en el código).

## Infra local (desarrollo)
Backend `:3000` (API en `/api/v1`), frontend Vite `:5173`, Postgres `:5455` (proyecto Docker aislado `vigilia`), MediaMTX (RTSP `:8554`, WebRTC `:8889`). El worker LPR (Python) y `vigilia-hub` (Raspberry) se levantan aparte. Detalle en la memoria de sesión "como-levantar-el-stack".
