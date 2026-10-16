# Módulo Hub - VigilIA Hub Integration

## Descripción

Este módulo maneja la comunicación con los dispositivos físicos **VigilIA Hub** (Raspberry Pi 3) que actúan como puentes inteligentes entre citófonos analógicos y el sistema de Conserje Digital.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│         Raspberry Pi 3 (VigilIA Hub)                        │
│  - Teclado matricial (GPIO)                                 │
│  - Relés DPDT (Control de audio)                            │
│  - USB Audio (Micrófono + Parlante)                         │
│  - @openai/realtime-api-beta (Cliente directo)              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ WebSocket (/hub namespace)
                         │ + REST API
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Backend NestJS (Este módulo)                   │
│  - HubGateway: WebSocket para comunicación en tiempo real  │
│  - Hub Entity: Registro de dispositivos                     │
│  - Endpoints: /api/v1/units/ai-enabled (cache local)       │
└─────────────────────────────────────────────────────────────┘
```

## Componentes

### 1. HubGateway (`hub.gateway.ts`)

Gateway de WebSocket que maneja las conexiones de los hubs físicos.

**Namespace**: `/hub`

**Autenticación** (Fase 1, Bloque A1.1 — docs/modulos/agente-cerebro.md §7/§11,
hallazgo H1: antes esto era un `HUB_SECRET` global COMPARTIDO por todos los
hubs, lo que permitía a un hub suplantar el `hubId` de otro condominio):
- `hubId`: Identificador único del hub (ej: `hub-001`)
- `hubSecret`: Secret **propio de este hub** (generado por `POST /hubs` al
  provisionarlo, se muestra en texto plano UNA sola vez; el backend solo
  guarda su hash bcrypt en `hubs.secretHash`). Se valida contra ESE hash
  específico, no contra un valor global.

**Autenticación antes del CONNECT** (Fase 4 · P4): las credenciales se validan
en un middleware del namespace (`afterInit` → `server.use`), no en
`handleConnection`. Ante cualquier rechazo (hub desconocido, inactivo, sin
secret, secret inválido, revocado durante la verificación o error de BD) el
cliente recibe `connect_error` con el mensaje genérico `unauthorized` y
nunca ve `connect`. Siempre se paga un bcrypt (contra un hash ficticio si el
hub no existe), así que ni el mensaje ni el tiempo revelan si el `hubId`
existe. Mismo criterio en `HubAuthGuard` (HTTP): un único 401 `Credencial de
dispositivo inválida` (`hub-credentials.ts`). Como socket.io-client no
reintenta tras un rechazo del middleware (`connect_error` con
`socket.active === false`) ni tras un corte del servidor (`io server
disconnect`), `vigilia-hub` reintenta a mano con backoff exponencial (5 s →
máx. 60 s, con jitter, un solo reintento pendiente) y lo reinicia recién
cuando la conexión lleva 30 s estable después de `hub:connected`.

**Identidad del socket** (Fase 4 · P4): el middleware guarda
`{ hubId, type, organizationId }` en `client.data.hub` y `handleConnection`
solo registra el socket (last-wins) y emite `hub:connected`. Es la única
fuente de verdad de los handlers `hub:*`: el `hubId` que venga en el body se
ignora, y un mensaje desde un socket no registrado (o ya reemplazado) se
ignora con `warn` y responde `{ success: false }`.

- **Reconexión con el mismo `hubId`** (last-wins): el socket nuevo reemplaza
  al anterior y el anterior se desconecta. La desconexión de un socket solo
  borra la entrada si sigue siendo la suya.
- **Rotar el secret o desactivar el hub** (`POST /hubs/:hubId/rotate-secret`,
  `PATCH /hubs/:hubId` con `active: false`, o un cambio de `type` u
  `organizationId`) desconecta su socket (`HubGateway.disconnectHub`). Un
  handshake que estaba en curso en ese momento se rechaza (contador de
  revocaciones), y un socket autenticado justo antes tampoco se registra.
  `vigilia-hub` reintenta solo (backoff de 5 s a 60 s): si el hub sigue
  activo con la misma credencial (p. ej. cambió de tipo o condominio) vuelve
  a conectarse con la identidad nueva; con la credencial revocada recibe
  `connect_error` en cada reintento hasta que se configure el secret nuevo en
  su `.env`. Dos procesos con la misma credencial se expulsan entre sí
  (last-wins), pero el backoff solo se reinicia tras 30 s de conexión estable,
  así que los reintentos se espacian.

**Rutas HTTP de una sesión con credencial de dispositivo** (Fase 4 · P4):
`POST /concierge/session/:id/execute-tool`, `/end` y `/status` solo aceptan
al dispositivo dueño de la sesión: `session.hubId === req.hub.hubId` **y** el
`organizationId` actual del hub igual al de la sesión. Otro hub o kiosko del
mismo condominio, o el dueño movido de condominio, recibe 403. El camino
humano no cambia.

**Eventos Recibidos del Hub** (el body ya no necesita `hubId`):

| Evento | Descripción | Payload |
|--------|-------------|---------|
| `hub:keypad` | Número marcado en teclado | `{ houseNumber, timestamp }` |
| `hub:stateChanged` | Cambio de estado FSM | `{ state, metadata }` |
| `hub:error` | Error crítico en el hub | `{ error, stack }` |
| `hub:heartbeat` | Señal de vida (cada 30s) | `{ uptime (ms), timestamp, status }` |

**Eventos Enviados al Hub**:

| Evento | Descripción | Payload | A quién |
|--------|-------------|---------|---------|
| `hub:connected` | Confirmación de conexión | `{ hubId, serverTime, message }` | Al socket que se conectó |
| `hub:door_open` | Orden de apertura del relé | `{ type: 'vehicular' \| 'pedestrian', visitId?, plate? }` | Solo hubs `physical-hub` (ver 2.2) |
| `visitor:response:<sessionId>` | Respuesta a la solicitud de visita | `{ sessionId, approved, entryRegistered, timestamp, ... }` | Solo al dispositivo dueño de la sesión (ver 2.2) |

**Métodos Públicos**:

```typescript
// Orden de apertura SOLO a hubs físicos: al de la sesión si es físico y está
// conectado; si no, a los físicos del condominio. Nunca a un web-kiosk.
// Condominio nulo o sin hubs físicos conectados: no-op con warn. Devuelve la
// cantidad de hubs que la recibieron.
sendDoorOpen(target: { hubId: string | null; organizationId: string | null }, command: DoorOpenCommand): number

// visitor:response:<sessionId> SOLO al socket dueño de la sesión (hub o
// kiosko), sin caer al condominio. Devuelve si se entregó.
sendVisitorResponse(session: { sessionId; hubId; organizationId }, payload): boolean

// Corta el socket de un hub (rotar secret / desactivar / cambiar tipo u org)
disconnectHub(hubId: string, reason: string): boolean

// Verificar si un hub está conectado
isHubConnected(hubId: string): boolean

// Obtener hubs conectados
getConnectedHubs(): Array<{ hubId: string; type: HubType; lastSeen: Date }>
```

No hay emisores genéricos: `broadcastToAllHubs` y `sendToSession` se
eliminaron (el primero cruzaba condominios y el segundo caía al condominio,
justo lo que D7 prohíbe para `hub:door_open` y `visitor:response:*`), y
`sendToHub`/`sendToOrganization` también, porque ya no tenían llamadas. Un
evento nuevo hacia los dispositivos se agrega con su propio método y su
propio enrutamiento.

### 2. Hub Entity (`entities/hub.entity.ts`)

Entidad que representa un dispositivo hub registrado.

**Campos**:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | uuid | ID interno |
| `organizationId` | uuid \| null | Condominio al que sirve este hub (Fase 1, Bloque A1.1 — "un hub sirve a UN condominio") |
| `hubId` | string | Identificador único (ej: `hub-001`) |
| `secretHash` | string \| null | Hash bcrypt del secret propio del hub — nunca se expone en texto plano tras el provisioning |
| `location` | string | Ubicación física (ej: "Edificio A - Panel Principal") |
| `description` | string | Descripción opcional |
| `active` | boolean | Estado del hub |
| `type` | enum | `physical-hub` (default, retrocompat) \| `web-kiosk` — ver "Tipos de hub" abajo |
| `firmwareVersion` | string | Versión del software del hub |
| `config` | jsonb | Configuración (pines GPIO, dispositivo audio, etc.) — hoy NO se expone en `CreateHubDto`/`UpdateHubDto`, así que ningún flujo de provisioning la exige; un `web-kiosk` simplemente la deja `null`, igual que cualquier hub sin config todavía |
| `lastSeen` | timestamp | Última vez que se conectó |
| `ipAddress` | string | IP del hub |

### 2.1 Provisioning de hubs (`hub.controller.ts` / `hub.service.ts`)

Fase 1, Bloque A1.1 — antes NO existía forma de crear un hub ni de asignarle
`organizationId` (la columna existía pero nunca se poblaba). Exclusivo de
plataforma (permiso `platform.manage-hubs`, solo "Super Administrador" por
defecto — mismo criterio que `platform.manage-organizations`).

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/hubs` | Provisiona un hub nuevo. Genera el secret y lo devuelve **en texto plano una única vez**. |
| GET | `/hubs` | Lista los hubs (sin `secretHash`). |
| GET | `/hubs/:hubId` | Detalle de un hub. |
| PATCH | `/hubs/:hubId` | Actualiza ubicación/descripción/organización/estado activo. Si lo desactiva o cambia su `type` u `organizationId`, desconecta su socket. |
| POST | `/hubs/:hubId/rotate-secret` | Invalida el secret anterior y genera uno nuevo (p.ej. ante sospecha de compromiso). Desconecta el socket conectado con el secret viejo. |

Identidad del dispositivo (Fase 4 · P4): `GET /concierge/device` (solo
`HubAuthGuard`, headers `X-Hub-Id` + `X-Hub-Secret`) devuelve
`{ hubId, type, organizationId }`; sin credencial de hub responde 401. El
emparejamiento del kiosko lo usa para validar la credencial y exigir
`type = web-kiosk`. No va en `/hubs/me` porque chocaría con `GET /hubs/:hubId`.
CORS HTTP permite `X-Hub-Id`/`X-Hub-Secret` porque el kiosko los manda desde
el navegador.

### 2.1.1 Paso operativo: asociar cada hub a su condominio

Desde la Fase 4 · P5.C, un contexto **sin condominio** no ve ninguna fila
(`scopeWhere`/`applyTenantFilter`) ni puede crear recursos (403). Un hub
activo con `organizationId = null` autentica, pero `GET /units/ai-enabled`
le devuelve `[]`, `buscar_residente`/`notificar_residente` no encuentran a
nadie y el citófono no intercepta ninguna llamada.

Por eso, al provisionar o migrar hubs:

1. Provisiona el hub con su condominio: `POST /hubs` con `organizationId`.
2. Para los que ya existen: `PATCH /hubs/:hubId` con `{ "organizationId": "<uuid del condominio>" }`
   (desconecta el socket; el hub se reconecta solo).
3. Configura en el dispositivo `HUB_ID` **y** `HUB_SECRET`: `HubAuthGuard`
   exige los dos headers (`X-Hub-Id` + `X-Hub-Secret`).
4. Al arrancar, el backend avisa en el log cuántos hubs activos no tienen
   condominio (`HubsService.warnAboutHubsWithoutOrganization`): ese número
   debe ser 0.

El Conserje Digital se activa por familia: `PATCH /families/:id` con
`{ "digitalConciergeEnabled": true }` (permiso `families.update`). Sin eso,
`GET /units/ai-enabled` no lista la unidad.

### 2.2 Tipos de hub (`HubType`, `hub.entity.ts`)

Tarea "kiosko web como device del condominio" (2026-07-12): el totem web de
`/digital-concierge` (`DigitalConciergeView`) quedaba en 401 contra
`ConciergeAuthGuard` por ser ruta pública sin auth. En vez de inventar un
mecanismo de auth nuevo, se modela como un `Hub` más — mismo `secretHash`,
mismo `HubAuthGuard`, mismo `POST /hubs` — pero con `type: 'web-kiosk'` en vez
de `'physical-hub'`.

- **`physical-hub`** (default, retrocompat — todo hub creado antes de esta
  tarea quedó así): Raspberry Pi con teclado matricial + relés GPIO.
- **`web-kiosk`**: totem web, sin control de relés. `Hub.config` (pines GPIO,
  audio) no aplica — hoy tampoco se valida para NINGÚN tipo de hub, porque
  `CreateHubDto`/`UpdateHubDto` no exponen ese campo (nunca se puebla vía API,
  solo existiría si se escribe directo en BD), así que no hizo falta agregar
  ninguna validación condicional por tipo.

**Autenticación**: `type` no participa. `HubAuthGuard` autentica por
`hubId` + `secretHash`, así que un `web-kiosk` se autentica igual que un
`physical-hub`. Desde la Fase 4 · P4 (D6) el guard expone el `type` en
`request.hub: AuthenticatedHub` (`{ hubId, type, organizationId }`) y el
gateway lo guarda en `ConnectedHubInfo` y en `client.data.hub`. Las reglas que
dependen del canal (tools por canal, P4.B) lo leen de ahí.

**Decisión D7 (Fase 4 · P4, docs/modulos/hardening-pre-piloto.md §2)** — el
kiosko se conecta a `/hub` igual que un hub físico, y:

- **`hub:door_open` solo va a hubs `physical-hub`** (`HubGateway.sendDoorOpen`):
  al hub de la sesión si es físico, está conectado y es del mismo condominio;
  si no, a todos los hubs físicos conectados del condominio. **Nunca a un
  `web-kiosk`**: no tiene relés, y si recibiera la orden el portón no se
  abriría. Sin condominio, o sin hubs físicos conectados, no se envía nada
  (`warn`). Lo usan las tres fuentes de apertura: la respuesta del residente
  (`DigitalConciergeService.respondToVisitor`), la tool `abrir_acceso`
  (también cuando la ejecuta una `PendingAction` aprobada) y el LPR
  (`DetectionsService.createDetection`, por el condominio de la cámara). Si
  ningún hub físico recibe la orden, `abrir_acceso` responde `abierto: false`
  y `respondToVisitor` alerta a los conserjes. `respondToVisitor` envía la
  orden de apertura ANTES de `visitor:response`, para que este lleve el
  acceso efectivo.
- **`visitor:response:<sessionId>` solo va al dispositivo dueño de la sesión**
  (`session.hubId`, `HubGateway.sendVisitorResponse`), **sin caer al
  condominio**: esa caída filtraría la respuesta a otros hubs o kioskos. Si el
  dueño no está conectado no se entrega; el kiosko se respalda con el polling
  de `POST /concierge/session/:id/status`, que ahora devuelve `visitId`,
  `residentResponse` y `entryRegistered` (el valor persistido en
  `concierge_sessions.entryRegistered`; `null` mientras se procesa).
- **Payload uniforme y mensaje fail-closed**: todo emisor de
  `visitor:response:*` manda `approved` y `entryRegistered`. El hub y el
  kiosko solo le dicen al visitante que pase si `approved === true &&
  entryRegistered === true`; aprobada sin ingreso registrado → que espere
  (conserjería fue avisada); payload inesperado → igual que "no registrado".
  `entryRegistered` es el acceso EFECTIVO: `true` solo si esa respuesta
  registró el ingreso y un hub físico recibió la orden de apertura (con el
  ingreso ya registrado por otra vía, o sin hubs físicos, es `false` y se
  alerta a conserjería).

### 3. Endpoint de Sincronización de Cache

**GET** `/api/v1/units/ai-enabled` (`HubAuthGuard`)

Retorna lista de unidades con Conserje Digital habilitado, del condominio del
hub autenticado.

**Headers**:
```
X-Hub-Id: hub-001
X-Hub-Secret: <secret propio del hub>
```

Sin credencial válida responde 401 con el mensaje genérico `Credencial de
dispositivo inválida`.

**Response**:
```json
[
  {
    "houseNumber": "A-504",
    "hasAI": true,
    "familyId": "uuid-123"
  },
  {
    "houseNumber": "B-302",
    "hasAI": true,
    "familyId": "uuid-456"
  }
]
```

**Uso**: El hub descarga esta lista cada 5 minutos para mantener un cache local y decidir en <50ms si debe interceptar una llamada.

## Flujo de Funcionamiento

### 1. Conexión Inicial

```typescript
// En el Raspberry Pi — vigilia-hub/src/services/websocket-client.service.ts.
// HUB_ID / HUB_SECRET salen del .env del hub (validado por loadHubConfig):
// el secret es el PROPIO de este hub, devuelto una sola vez por POST /hubs
// (o por POST /hubs/:hubId/rotate-secret). El backend solo guarda su
// `secretHash`. En producción la URL es https:// (wss://).
const socket = io(`${config.backendSocketUrl}/hub`, {
  auth: {
    hubId: config.hubId,
    hubSecret: config.hubSecret
  }
});

socket.on('hub:connected', (data) => {
  console.log('✅ Conectado:', data);
});
```

### 2. Sincronización de Cache

```typescript
// En el Raspberry Pi (cada 5 minutos) — vigilia-hub/src/services/local-cache.service.ts
// Credenciales PROPIAS del hub (X-Hub-Id + X-Hub-Secret), las mismas del
// handshake; HubAuthGuard las verifica contra el secretHash de ESE hubId.
const response = await axios.get(`${config.backendUrl}/api/v1/units/ai-enabled`, {
  headers: {
    'X-Hub-Id': config.hubId,
    'X-Hub-Secret': config.hubSecret,
  },
});

// Guardar en cache local
cacheService.updateCache(response.data);
```

### 3. Detección de Llamada

```
1. Visitante marca "504#" en el teclado físico
2. Hub detecta la secuencia mediante GPIO
3. Hub consulta cache LOCAL (< 50ms):
   - Si casa 504 tiene IA → Interceptar inmediatamente
   - Si no → Dejar pasar (citófono normal)
4. Si intercepta:
   - Activa relés (audio → USB)
   - Conecta DIRECTAMENTE con OpenAI Realtime API
   - Ejecuta tools del backend (buscar_residente, notificar_residente, etc.)
```

### 4. Heartbeat y Monitoreo

```typescript
// En el Raspberry Pi (cada 30 segundos). Sin hubId: el gateway usa la
// identidad del handshake.
socket.emit('hub:heartbeat', {
  uptime: Math.round(process.uptime() * 1000),
  timestamp: Date.now(),
  status: 'active'
});
```

## Variables de Entorno

Fase 1, Bloque A1.1: ya **no existe** un `HUB_SECRET` global en el `.env` del
backend — cada hub recibe su propio secret al provisionarse (`POST /hubs`).
El secret se configura en el `.env` **del hub físico** (`vigilia-hub/.env`):

```env
# En vigilia-hub/.env (Raspberry Pi) — valores devueltos por POST /hubs
HUB_ID=hub-001
HUB_SECRET=<secret devuelto una única vez al provisionar>
```

⚠️ **IMPORTANTE**: el secret solo se muestra una vez en la respuesta de
`POST /hubs` (o de `POST /hubs/:hubId/rotate-secret`) — si se pierde, hay que
rotarlo (invalida el anterior).

## Migración de Base de Datos

El esquema se crea con las migraciones del backend (`npm run migration:run`,
ver `src/migrations/`): la tabla `hubs` y las columnas de
`concierge_sessions` vienen en la migración base (`InitialSchema`), y la
Fase 4 · P4 agrega `concierge_sessions.entryRegistered` y
`visits.respondedById`/`respondedAt` (`ConciergeResponseTracking`). Las
migraciones viejas del módulo quedaron en `src/migrations/legacy/` y ya no se
ejecutan.

## Seguridad

### 1. Autenticación del Hub

Los hubs se autentican mediante:
- **hubId**: Identificador único (no es secreto)
- **hubSecret**: Secret **propio de este hub** (DEBE ser confidencial;
  Fase 1, Bloque A1.1 — ya no es un valor compartido entre hubs)

El secret se valida (contra el `secretHash` de ESE hub específico, `Hub.hubId`) en:
- Conexión WebSocket al HubGateway (`hub.gateway.ts`)
- Llamada HTTP a `/api/v1/units/ai-enabled` y `/api/v1/concierge/*` (`HubAuthGuard`)

### 2. Recomendaciones

✅ **Hacer**:
- Usar HTTPS/WSS en producción
- Provisionar cada hub con `POST /hubs` (secret único, generado por el backend)
- Rotar el secret de un hub con `POST /hubs/:hubId/rotate-secret` ante sospecha de compromiso
- Monitorear intentos de conexión fallidos (`HubAuthGuard`/`HubGateway` los loguean con `logger.warn`)

❌ **No hacer**:
- Hardcodear el secret en el código del hub
- Exponer el secret en logs
- Reutilizar el secret de un hub en otro (cada hub = su propio secret, generado por `POST /hubs`)

## Testing

### 1. Simular Hub con cURL

```bash
# Test del endpoint de cache: requiere X-Hub-Id además de X-Hub-Secret (el
# secret se valida contra ESE hub específico) y el prefijo global /api/v1
curl -H "X-Hub-Secret: tu_secret_aqui" \
  -H "X-Hub-Id: hub-001" \
  http://localhost:3000/api/v1/units/ai-enabled
```

### 2. Cliente WebSocket de Prueba

```javascript
const io = require('socket.io-client');

const socket = io('http://localhost:3000/hub', {
  auth: {
    hubId: 'hub-test-001',
    hubSecret: 'tu_secret_aqui'
  }
});

socket.on('hub:connected', (data) => {
  console.log('✅ Conectado:', data);
  
  // Simular marcación de teclado (el hubId sale del handshake)
  socket.emit('hub:keypad', {
    houseNumber: '504'
  });
});

socket.on('connect_error', (error) => {
  console.error('❌ Error de conexión:', error.message);
});
```

## Dashboard de Monitoreo (Futuro)

Se puede agregar al frontend un dashboard para:
- Ver hubs conectados en tiempo real
- Monitorear estado (uptime, CPU, memoria)
- Ver últimas llamadas procesadas
- Configurar hubs remotamente
- Ver logs de errores

Ejemplo de endpoint para el dashboard:

```typescript
// En un futuro HubController
@Get('connected')
@UseGuards(AuthGuard)
@RequirePermissions('view_system_status')
getConnectedHubs() {
  return this.hubGateway.getConnectedHubs();
}
```

## Troubleshooting

### Hub no se conecta

1. Verificar que el `HUB_SECRET` del `.env` del hub coincida con el secret vigente de ESE `hubId` (si se rotó, el hub necesita el valor nuevo)
2. Verificar conectividad de red (`ping backend.com`)
3. Ver logs del backend: `npm run start:dev`
4. Ver logs del hub: `sudo journalctl -u vigilia-hub -f`

### Hub o kiosko rechazado por el límite de intentos (HTTP 429 / WS `unauthorized`)

Verificar una credencial de dispositivo cuesta un bcrypt. `HubAuthGuard`
(HTTP) y el middleware de `/hub` (WebSocket) la resuelven en dos pasos:

1. **Caché de credenciales verificadas** (`hub/hub-credential-cache.ts`). Si
   el `hubId` + secret ya se verificó, entra sin bcrypt y sin pasar por el
   limitador, aunque su IP esté bloqueada o el backend esté bajo una ráfaga.
   - Guarda un HMAC-SHA256 del secret con una clave aleatoria por proceso
     (nunca el secret en claro), comparado en tiempo constante, más la
     identidad verificada (`type`, `organizationId`).
   - Vence a los 10 min sin uso y, aunque se use, a las 24 h (Fase 4 · P6.R).
     El heartbeat de un socket `/hub` registrado la renueva (`touch`), así un
     hub conectado no vuelve al camino con bcrypt solo por no hacer requests
     HTTP. Tope de 10 000 entradas.
   - Se invalida en `HubGateway.disconnectHub`: rotar el secret, desactivar
     el hub, cambiar su tipo o su condominio (`HubsService`) cortan también
     la credencial cacheada. Un cambio hecho directo en la BD (sin pasar por
     la API) tarda hasta 24 h en verse; reiniciar el backend lo limpia.
   - Un secret distinto para un `hubId` cacheado es un fallo normal (paso 2).
2. **Limitador del camino con bcrypt** (`hub/hub-auth-failure-limiter.ts`):

| Límite | Valor | Efecto al superarlo |
|---|---|---|
| Fallos por IP (IPv6: por /64) | 20 en 5 min (ventana deslizante) | Rechazo sin verificar, para cualquier `hubId` |
| Verificaciones en curso por IP | 3 | Rechazo inmediato del exceso |
| Verificaciones en curso en todo el backend | 8 | Rechazo inmediato del exceso |

- Cada intento cuenta como fallo al empezar y se perdona si la credencial
  es válida. Un error de BD no cuenta.
- HTTP responde **429** (`Demasiados intentos de autenticación de
  dispositivo`); el WebSocket responde el mismo `connect_error`
  **`unauthorized`** que una credencial inválida. vigilia-hub reintenta con
  backoff (5 s a 60 s).
- Bajo bloqueo, la respuesta es la misma para un `hubId` existente, uno
  inexistente o un secret incorrecto: no revela qué `hubId` existen.
- Un dispositivo que verificó su credencial en los últimos minutos (caché)
  no queda fuera por basura de otros equipos detrás de la misma NAT. Uno
  que no está en caché (p. ej. recién reiniciado el backend, o sin uso ni
  heartbeat por más de 10 min) espera a que la ventana de su IP se libere.
- `hubId` con formato inválido (más de 64 caracteres o fuera de
  `[A-Za-z0-9_-]`) se rechaza sin consultar la BD.
- Contadores y caché viven en memoria (una instancia del backend); un
  reinicio los limpia.

**Dependencia de `TRUST_PROXY`:** la IP sale de `req.ip` (HTTP) y de
`X-Forwarded-For` del handshake (WebSocket), ambos con la cantidad de proxies
de `TRUST_PROXY`. Debe coincidir EXACTAMENTE con la cantidad de reverse
proxies delante del backend:
- Si es menor (o falta), todos los clientes comparten la IP del proxy: 20
  fallos de cualquiera bloquean a todos los dispositivos que no estén en
  caché.
- Si es mayor, un cliente elige su IP con `X-Forwarded-For` y evade el
  límite.

### Cache desactualizado

1. El hub sincroniza cada 5 minutos automáticamente
2. Verificar endpoint: `GET /api/v1/units/ai-enabled` retorna datos correctos
3. Reiniciar el servicio del hub: `sudo systemctl restart vigilia-hub`

### Audio con latencia

1. Verificar que el hub use 48kHz nativo (no 24kHz con resampling)
2. Monitorear CPU del hub: `htop`
3. Verificar calidad de red: `ping -c 100 backend.com`

## Logs Importantes

El backend registra estos eventos críticos:

```
✅ Hub conectado: hub-001 (socket: abc123)
🔢 Keypad input de hub-001: 504
🔄 Hub hub-001 cambió de estado: AI_INTERCEPT
❌ Error en Hub hub-001: Audio device not found
💓 Heartbeat de hub-001 (uptime: 3600s)
❌ Hub desconectado: hub-001
```

## Próximos Pasos

1. ✅ Implementación básica completada
2. ⏳ Dashboard de monitoreo en frontend
3. ⏳ Registro automático de hubs nuevos
4. ⏳ Actualización OTA (Over-The-Air) de firmware
5. ⏳ Alertas push cuando un hub se desconecta
6. ⏳ Métricas de uso (llamadas procesadas, tiempo promedio, etc.)

## Recursos Adicionales

- [Documentación del Hub (Raspberry Pi)](../../../vigilia-hub/README.md)
- [Guía de Instalación del Hub](../../../vigilia-hub/INSTALL.md)
- [Esquemático del Hardware](../../../vigilia-hub/docs/hardware-schematic.pdf)
