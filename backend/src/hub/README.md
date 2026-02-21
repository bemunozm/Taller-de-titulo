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

**Autenticación**: 
- `hubId`: Identificador único del hub (ej: `hub-001`)
- `hubSecret`: Secret compartido (variable `HUB_SECRET` en .env)

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

// Broadcast a todos los hubs
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
| `hubId` | string | Identificador único (ej: `hub-001`) |
| `location` | string | Ubicación física (ej: "Edificio A - Panel Principal") |
| `description` | string | Descripción opcional |
| `active` | boolean | Estado del hub |
| `firmwareVersion` | string | Versión del software del hub |
| `config` | jsonb | Configuración (pines GPIO, dispositivo audio, etc.) |
| `lastSeen` | timestamp | Última vez que se conectó |
| `ipAddress` | string | IP del hub |

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

Agregar al archivo `.env`:

```env
# Hub Configuration (Raspberry Pi)
HUB_SECRET=tu_super_secreto_cambiar_en_produccion_12345
```

⚠️ **IMPORTANTE**: Cambiar el secret en producción por un valor aleatorio seguro.

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
- **hubSecret**: Secret compartido (DEBE ser confidencial)

El secret se valida en:
- Conexión WebSocket al HubGateway
- Llamada HTTP a `/units/ai-enabled`

### 2. Recomendaciones

✅ **Hacer**:
- Usar HTTPS/WSS en producción
- Cambiar `HUB_SECRET` por valor aleatorio fuerte
- Rotar el secret periódicamente
- Monitorear intentos de conexión fallidos

❌ **No hacer**:
- Hardcodear el secret en el código del hub
- Exponer el secret en logs
- Usar el mismo secret en desarrollo y producción

## Testing

### 1. Simular Hub con cURL

```bash
# Test del endpoint de cache
curl -H "X-Hub-Secret: tu_secret_aqui" \
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

1. Verificar que `HUB_SECRET` sea el mismo en backend y hub
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
