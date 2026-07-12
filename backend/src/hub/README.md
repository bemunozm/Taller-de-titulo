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
│  - Endpoints: /units/ai-enabled (cache local)              │
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

**Eventos Recibidos del Hub**:

| Evento | Descripción | Payload |
|--------|-------------|---------|
| `hub:keypad` | Número marcado en teclado | `{ hubId, houseNumber }` |
| `hub:stateChanged` | Cambio de estado FSM | `{ hubId, state, metadata }` |
| `hub:error` | Error crítico en el hub | `{ hubId, error, stack }` |
| `hub:heartbeat` | Señal de vida (cada 30s) | `{ hubId, uptime, cpuUsage, memoryUsage }` |

**Eventos Enviados al Hub**:

| Evento | Descripción | Payload |
|--------|-------------|---------|
| `hub:connected` | Confirmación de conexión | `{ hubId, serverTime, message }` |

**Métodos Públicos**:

```typescript
// Enviar mensaje a un hub específico
sendToHub(hubId: string, event: string, data: any): boolean

// Enviar mensaje a todos los hubs de UN condominio (Fase 1, Bloque A1.1 —
// hallazgo H2: usar esto para eventos sensibles como hub:door_open, NUNCA
// broadcastToAllHubs, que cruzaría el aislamiento entre condominios)
sendToOrganization(organizationId: string | null, event: string, data: any): number

// Broadcast a TODOS los hubs conectados (de cualquier condominio) — solo
// para eventos genuinamente globales, no para acciones físicas dirigidas
broadcastToAllHubs(event: string, data: any): void

// Verificar si un hub está conectado
isHubConnected(hubId: string): boolean

// Obtener hubs conectados
getConnectedHubs(): Array<{ hubId: string; lastSeen: Date }>
```

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
| PATCH | `/hubs/:hubId` | Actualiza ubicación/descripción/organización/estado activo. |
| POST | `/hubs/:hubId/rotate-secret` | Invalida el secret anterior y genera uno nuevo (p.ej. ante sospecha de compromiso). |

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

**Confirmado sin cambios de código** (`type` no participa en autenticación ni
en resolución de tenant):
- `HubAuthGuard` autentica por `hubId` + `secretHash` sin mirar `type` — un
  `web-kiosk` se autentica exactamente igual que un `physical-hub`.
- `ConciergeAuthGuard`/`AuthorizedContextFactory` (`src/agent/`) arman el
  contexto del agente a partir de `request.hub: AuthenticatedHub` (solo
  `hubId`/`organizationId`, sin `type`) — `startSession`/`execute-tool`/
  `agent-config` funcionan igual para un `web-kiosk`.

**Pendiente de decisión de producto (fuera de este alcance)**: si un
`web-kiosk` debe o no poder disparar `hub:door_open` — hoy
`HubGateway.sendToOrganization` (usado por `abrir-acceso.tool.ts` y
`DigitalConciergeService.respondToVisitor`) envía el evento a TODOS los
sockets conectados de la organización sin distinguir `type`, porque
`ConnectedHubInfo` (mapa interno de `HubGateway`) no guarda el `type` del hub
— solo `organizationId`. Si un totem físicamente junto a un portón debe abrir
la reja igual que un hub físico, esto ya funciona tal cual; si NO debe, hace
falta filtrar por `type` en `sendToOrganization`/`connectedHubs` — se deja
documentado a propósito, sin implementarlo, porque es una decisión de
comportamiento físico que le corresponde a Benjamin, no una corrección de bug.

### 3. Endpoint de Sincronización de Cache

**GET** `/units/ai-enabled`

Retorna lista de unidades con Conserje Digital habilitado.

**Headers**:
```
X-Hub-Secret: tu_secreto_aqui
```

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
// En el Raspberry Pi
const socket = io('http://backend.com/hub', {
  auth: {
    hubId: 'hub-001',
    hubSecret: process.env.HUB_SECRET
  }
});

socket.on('hub:connected', (data) => {
  console.log('✅ Conectado:', data);
});
```

### 2. Sincronización de Cache

```typescript
// En el Raspberry Pi (cada 5 minutos)
const response = await axios.get('http://backend.com/units/ai-enabled', {
  headers: { 'X-Hub-Secret': process.env.HUB_SECRET }
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
// En el Raspberry Pi (cada 30 segundos)
socket.emit('hub:heartbeat', {
  hubId: 'hub-001',
  uptime: process.uptime() * 1000,
  cpuUsage: os.loadavg()[0],
  memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024
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

Ejecutar la migración para crear las tablas necesarias:

```bash
npm run migration:run
```

Esto creará:
- Tabla `hubs` para registro de dispositivos
- Campos `hubId` y `source` en `concierge_sessions`
- Campo `digitalConciergeEnabled` en `families`
- Índices para optimizar consultas

## Seguridad

### 1. Autenticación del Hub

Los hubs se autentican mediante:
- **hubId**: Identificador único (no es secreto)
- **hubSecret**: Secret **propio de este hub** (DEBE ser confidencial;
  Fase 1, Bloque A1.1 — ya no es un valor compartido entre hubs)

El secret se valida (contra el `secretHash` de ESE hub específico, `Hub.hubId`) en:
- Conexión WebSocket al HubGateway (`hub.gateway.ts`)
- Llamada HTTP a `/units/ai-enabled` y `/concierge/*` (`HubAuthGuard`)

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
# Test del endpoint de cache (Fase 1, Bloque A1.1: ahora requiere X-Hub-Id
# además de X-Hub-Secret — el secret se valida contra ESE hub específico)
curl -H "X-Hub-Secret: tu_secret_aqui" \
  -H "X-Hub-Id: hub-001" \
  http://localhost:3000/units/ai-enabled
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
  
  // Simular marcación de teclado
  socket.emit('hub:keypad', {
    hubId: 'hub-test-001',
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

### Cache desactualizado

1. El hub sincroniza cada 5 minutos automáticamente
2. Verificar endpoint: `GET /units/ai-enabled` retorna datos correctos
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
