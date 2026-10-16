# Sistema de Notificaciones Push - Frontend

Sistema de notificaciones en tiempo real implementado con Socket.IO y React.

> **Modelo vigente: Fase 4 · P6 (2026-10-09).** Un solo socket por pestaña,
> autenticado con la cookie de sesión de better-auth, salas asignadas por el
> servidor y ciclo de vida ligado al login. Ya no existen `register`,
> `join_room`/`leave_room`, `security:anomaly_detected` ni `visitor:arrival`, y
> se eliminaron `ConserjeView`, `ResidenteView` y `AnomalyAlertModal` (cada uno
> abría su propio socket).

## 📋 Contenido

- [Arquitectura](#arquitectura)
- [Componentes](#componentes)
- [Ciclo de vida del socket](#ciclo-de-vida-del-socket)
- [Configuración](#configuración)
- [Uso](#uso)
- [Tipos de Notificaciones](#tipos-de-notificaciones)
- [Personalización](#personalización)

## 🏗️ Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│ NotificationBell · diálogos de aprobación ·                  │ <- UI Layer
│ GlobalSecurityNotifications                                  │
├──────────────────────────────────────────────────────────────┤
│ useNotifications (lista, leídas, permiso del navegador)      │ <- Logic Layer
├──────────────────────────────────────────────────────────────┤
│ RealtimeConnection (dueño único, ligado a useAuth)           │ <- Session Layer
├──────────────────────────────────────────────────────────────┤
│ WebSocketService (singleton `webSocketService`)              │ <- Connection Layer
└──────────────────────────────────────────────────────────────┘
```

### Capas

1. **WebSocketService** (`services/WebSocketService.ts`)
   - Un solo socket al namespace `/`, con `withCredentials: true`: el
     handshake lleva la cookie de sesión y el servidor lo autentica antes del
     CONNECT.
   - No emite nada al servidor: las salas las asigna el servidor.
   - Entrega los eventos a los suscriptores del servicio, que sobreviven a un
     logout y a un nuevo login.

2. **RealtimeConnection** (`components/RealtimeConnection.tsx`, montado en
   `router.tsx`)
   - Único lugar que conecta y desconecta: conecta cuando `useAuth()` tiene un
     usuario, desconecta sin sesión (logout, sesión caída) y en el kiosko
     (`/digital-concierge`, donde ni consulta la sesión humana).
   - Único suscriptor de `notification`: muestra la notificación del navegador
     (si hay permiso) y refresca `['notifications', userId]`.

3. **useNotifications Hook** (`hooks/useNotifications.ts`)
   - Lista de notificaciones (`GET /notifications` vía TanStack Query, con
     refresco cada 60 s como respaldo del tiempo real).
   - Marcar como leídas, limpiar, permiso del navegador.
   - `isConnected` sale del estado del servicio. **No conecta nada.**

4. **NotificationBell Component** (`components/NotificationBell.tsx`)
   - Interfaz visual de notificaciones
   - Dropdown con lista de notificaciones
   - Indicadores visuales (contador, conexión)
   - Acciones (marcar como leída, limpiar)

5. **GlobalSecurityNotifications** (`components/GlobalSecurityNotifications.tsx`,
   montado en `StackedLayout`)
   - Avisos del Guardián Visual (`security:anomaly_highlight`).
   - Solo se monta con `detections.read` + `condominium.view-all` (Conserje,
     Administrador). **Nunca para el super-admin**: el servidor no lo une a
     ninguna sala de seguridad (la plataforma consulta `GET /anomalies`).
   - El aviso no trae la foto: se pide con `GET /anomalies/:id` (acotado al
     condominio). Si falla, el aviso se muestra igual.

## 🧩 Componentes

### WebSocketService

**Métodos:**
- `connect({ userId, verifySession })`: abre el socket de la sesión. Es
  idempotente para el mismo usuario (también mientras conecta); con otro
  usuario cierra el socket anterior.
- `disconnect()`: cierre intencional (logout, sin sesión, kiosko).
- `onNotification(handler)`: evento `notification` del usuario.
- `onAnomalyHighlight(handler)`: evento `security:anomaly_highlight`, ya
  normalizado; los payloads sin id se descartan.
- `getStatus()` / `onStatusChange(listener)`: `idle`, `connecting`,
  `connected`, `reconnecting` o `session-ended`.
- `isConnected()`.

**Salas (las asigna el servidor):**
- `user:<id>`: notificaciones del usuario, en todas sus pestañas.
- `session:<id>`: permite cortar los sockets de una sesión al terminarla.
- `org:<id>:security`: avisos de anomalías del condominio, solo con
  `detections.read` + `condominium.view-all` y nunca para el super-admin.

### useNotifications Hook

**API:**

```typescript
const {
  notifications,      // Array de notificaciones
  unreadCount,        // Contador de no leídas
  isConnected,        // Estado del socket de la sesión
  markAsRead,         // Marcar una como leída
  markAllAsRead,      // Marcar todas como leídas
  clearAll,           // Limpiar todas
  requestPermission,  // Solicitar permiso del navegador
  hasPermission,      // Si tiene permiso del navegador
} = useNotifications()
```

### NotificationBell Component

Componente visual integrado en el Navbar.

**Características visuales:**
- 🔔 Ícono de campana (gris = normal, amarillo = notificaciones)
- 🔴 Badge con contador de notificaciones no leídas
- 🟢 Indicador de conexión (verde = conectado, rojo = desconectado)
- 📋 Dropdown con lista de notificaciones recientes (últimas 10)
- 🎨 Badges de colores según tipo de notificación
- ⏱️ Formato de tiempo relativo usando helper `formatRelativeTime()`

**Acciones disponibles:**
- Click en notificación → marcar como leída
- "Marcar todas como leídas" → marcar todas
- "Limpiar todo" → eliminar todas las notificaciones
- "Habilitar notificaciones" → solicitar permiso del navegador

## 🔄 Ciclo de vida del socket

1. **Login:** `useAuth()` entrega el usuario → `RealtimeConnection` llama a
   `connect({ userId, verifySession })`. El servidor valida la cookie en el
   handshake y asigna las salas.
2. **Logout:** `useAuth().logout()` cierra el socket antes de `sign-out`, y
   `RealtimeConnection` desconecta cuando el usuario deja de existir.
3. **Fin de sesión del lado del servidor** (expiración, logout en otra
   pestaña o revocación): el servidor envía `session:ended { reason }`
   (`logout` | `expired` | `revoked`) y corta el socket (`io server disconnect`).
4. **Handshake rechazado** (`connect_error` con `unauthorized`): socket.io no
   reintenta.

En los casos 3 y 4 el cliente **no reintenta a ciegas**: revalida la sesión con
`GET /auth/user`, lo que además actualiza el estado de login de la app.
- Sesión inválida → estado `session-ended` y sin socket hasta el próximo login
  (el layout redirige al login).
- Sesión aún válida → hasta 3 reintentos con backoff (2 s, 4 s, 8 s, ±20 %).
  El presupuesto se reinicia tras 30 s de conexión estable.

Un corte de red (transporte) lo reintenta socket.io solo, de 2 s hasta un
máximo de 30 s y sin tope: cada reconexión vuelve a validar la cookie en el
handshake.

## ⚙️ Configuración

### 1. Variables de entorno

Crear/editar `.env`:

```env
VITE_API_URL=http://localhost:3000/api/v1
VITE_WS_URL=http://localhost:3000
```

Sin `VITE_WS_URL` no se abre el socket; las notificaciones siguen llegando por
el refresco periódico de la lista.

### 2. Instalación de dependencias

Las dependencias ya están instaladas:
- `socket.io-client` - Cliente WebSocket

### 3. Integración

- `RealtimeConnection` y `GlobalApprovalDialogs` van en `router.tsx`, fuera de
  `<Routes>`.
- `NotificationBell` va en el `NavbarSection` del layout principal.
- `GlobalSecurityNotifications` va en `layouts/StackedLayout.tsx`.

## 🚀 Uso

### Uso básico

El sistema funciona automáticamente una vez que el usuario inicia sesión:

1. Usuario hace login → `useAuth()` retorna datos del usuario
2. `RealtimeConnection` conecta el socket de la sesión (cookie)
3. El servidor asigna las salas según la identidad y los permisos
4. Las notificaciones entrantes refrescan la lista y, con permiso, muestran
   la notificación del navegador

### Solicitar permiso de notificaciones del navegador

```tsx
import { useNotifications } from '@/hooks/useNotifications'

function MyComponent() {
  const { requestPermission, hasPermission } = useNotifications()

  return (
    <button onClick={() => void requestPermission()}>
      {hasPermission ? 'Notificaciones activadas' : 'Activar notificaciones'}
    </button>
  )
}
```

### Usar notificaciones en otro componente

```tsx
import { useNotifications } from '@/hooks/useNotifications'

function CustomNotificationPanel() {
  const { notifications, markAsRead, clearAll } = useNotifications()

  return (
    <div>
      <h2>Mis Notificaciones</h2>
      {notifications.map((notification) => (
        <div key={notification.id}>
          <h3>{notification.payload.title}</h3>
          <p>{notification.payload.message}</p>
          <button onClick={() => markAsRead(notification.id)}>
            Marcar como leída
          </button>
        </div>
      ))}
      <button onClick={clearAll}>Limpiar todas</button>
    </div>
  )
}
```

Para reaccionar a un evento del socket en otro componente, suscríbete al
servicio (`webSocketService.onNotification` / `onAnomalyHighlight`) dentro de
un `useEffect` y devuelve la función de desuscripción. Nunca abras un socket
propio ni llames a `connect()` fuera de `RealtimeConnection`.

## 📬 Tipos de Notificaciones

El sistema soporta los siguientes tipos de notificaciones:

| Tipo | Color Badge | Descripción | Ejemplo |
|------|-------------|-------------|---------|
| `VISIT_CHECK_IN` | 🟢 Verde | Visita ha ingresado | "Juan Pérez ha ingresado al condominio" |
| `VISIT_CHECK_OUT` | 🔵 Azul | Visita ha salido | "Juan Pérez ha salido del condominio" |
| `ACCESS_DENIED` | 🔴 Rojo | Acceso denegado | "Vehículo ABC123 sin autorización" |
| `VISIT_APPROVED` | 🟢 Verde | Visita aprobada | "Visita de Juan Pérez aprobada" |
| `VISIT_REJECTED` | 🔴 Rojo | Visita rechazada | "Visita de Juan Pérez rechazada" |
| `VISIT_EXPIRED` | 🟡 Amarillo | Visita expirada | "La visita de Juan Pérez ha expirado" |
| `SYSTEM_ALERT` | 🟡 Amarillo | Alerta del sistema | "Cámara 1 desconectada" |

### Estructura de una notificación

```typescript
interface AppNotification {
  id: string                      // UUID único
  payload: {
    title: string                 // Título de la notificación
    message: string               // Mensaje descriptivo
    type: NotificationType        // Tipo de notificación
    timestamp: Date               // Fecha/hora del evento
    data?: Record<string, unknown> // Datos adicionales opcionales
  }
  read: boolean                   // Si fue leída
  receivedAt: Date                // Cuándo se recibió en el cliente
}
```

### Aviso de anomalía (`security:anomaly_highlight`)

```typescript
// Payload del servidor (sin imagen):
// { anomalyId, cameraId, cameraName, type, severity, reasoning, timestamp }
// La foto se pide con GET /anomalies/:id (snapshotJpegB64).
```

Ver `helpers/securityAlerts.ts` (`parseAnomalyHighlight`,
`canReceiveSecurityAlerts`).

## 🎨 Personalización

### Cambiar colores de badges

Editar `components/NotificationBell.tsx`:

```typescript
function getNotificationColor(type: string): 'lime' | 'sky' | 'amber' | 'rose' | 'zinc' {
  switch (type) {
    case 'VISIT_CHECK_IN':
      return 'lime'    // Verde
    case 'VISIT_CHECK_OUT':
      return 'sky'     // Azul
    case 'ACCESS_DENIED':
      return 'rose'    // Rojo
    // ... agregar más casos
    default:
      return 'zinc'    // Gris por defecto
  }
}
```

### Cambiar formato de tiempo

En `helpers/index.ts`:

```typescript
export function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const targetDate = typeof date === 'string' ? new Date(date) : date
  
  const diffMs = now.getTime() - targetDate.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Ahora'
  if (diffMins < 60) return `Hace ${diffMins} min`
  if (diffHours < 24) return `Hace ${diffHours} h`
  if (diffDays < 7) return `Hace ${diffDays} día${diffDays !== 1 ? 's' : ''}`
  
  // Personalizar este formato según preferencia
  return targetDate.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: targetDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}
```

### Cambiar número de notificaciones mostradas

En `NotificationBell.tsx`:

```typescript
// Cambiar de 10 a otro número
const recentNotifications = notifications.slice(0, 10) // <-- Cambiar aquí
```

### Cambiar duración de notificaciones del navegador

En `components/RealtimeConnection.tsx` (`showBrowserNotification`): el
`setTimeout` de 5 s que cierra la notificación.

### Personalizar reconexión WebSocket

En `services/WebSocketService.ts`, las constantes exportadas:
`REALTIME_RECONNECT_DELAY_MS` / `REALTIME_RECONNECT_DELAY_MAX_MS` (cortes de
red), `REALTIME_RECOVERY_BASE_MS` / `REALTIME_RECOVERY_MAX_ATTEMPTS` (rechazo o
cierre del servidor con la sesión aún válida) y `REALTIME_STABLE_CONNECTION_MS`.

## 🐛 Troubleshooting

### Las notificaciones no aparecen

1. Verificar que el backend esté corriendo
2. Verificar la variable `VITE_WS_URL` en `.env`
3. Verificar que el usuario esté autenticado (el socket solo existe con sesión)
4. En el kiosko (`/digital-concierge`) no hay socket de sesión humana: es
   intencional

### No puedo conectar al WebSocket

```
connect_error: unauthorized
```

**Solución:**
1. La cookie de sesión no llegó o expiró: volver a iniciar sesión
2. Verificar CORS en el backend: origen del frontend (`FRONTEND_URL`) con
   `credentials`
3. Verificar que `VITE_WS_URL` apunte al mismo backend que emitió la cookie

### Las notificaciones del navegador no aparecen

**Solución:**
1. Click en el botón "Habilitar notificaciones"
2. Verificar permisos del navegador (Configuración → Sitios → Notificaciones)
3. Verificar que el navegador soporte notificaciones (no funciona en modo incógnito en algunos navegadores)

### El indicador de conexión siempre está en rojo

**Solución:**
1. Revisar el estado con `webSocketService.getStatus()`:
   `session-ended` significa que el servidor cerró la sesión (iniciar sesión de
   nuevo); `reconnecting`, que hay un corte de red o un reintento en curso
2. Verificar que la sesión siga vigente (`GET /auth/user`)

## 📝 Notas adicionales

### Persistencia

Las notificaciones se persisten en el servidor (`GET /notifications`) y se
marcan como leídas por la API. El socket solo avisa que hay algo nuevo y la
lista se vuelve a pedir.

### Seguridad

- El handshake se autentica con la cookie httpOnly de better-auth, no con un
  token en el cliente.
- El servidor elige las salas: el cliente no puede unirse a otra (no hay
  `join_room`) ni registrarse como otro usuario (no hay `register`).
- Los avisos de anomalías no viajan con la foto; se pide por
  `GET /anomalies/:id`, acotado al condominio y con `detections.read`.
- Los payloads (datos de visitantes, anomalías) no se escriben en consola
  (`no-console` en ESLint para estos archivos).

### Performance

- Un solo socket por pestaña, compartido por todos los componentes
- Un solo suscriptor de `notification`: una notificación del navegador y un
  refresco de la lista por evento
- Solo se muestran las últimas 10 notificaciones en el dropdown

### Futuras mejoras

- [ ] Filtros por tipo de notificación
- [ ] Búsqueda de notificaciones
- [ ] Paginación de notificaciones antiguas
- [ ] Notificaciones con sonido
- [ ] Configuración de preferencias de notificación
- [ ] Agrupación de notificaciones similares

## 🔗 Referencias

- [Socket.IO Client API](https://socket.io/docs/v4/client-api/)
- [Notifications API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
- [React Hooks](https://react.dev/reference/react)
