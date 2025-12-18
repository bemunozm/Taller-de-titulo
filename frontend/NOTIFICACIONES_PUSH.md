# Sistema de Notificaciones Push - Frontend

Sistema de notificaciones en tiempo real implementado con Socket.IO y React.

## 📋 Contenido

- [Arquitectura](#arquitectura)
- [Componentes](#componentes)
- [Configuración](#configuración)
- [Uso](#uso)
- [Tipos de Notificaciones](#tipos-de-notificaciones)
- [Personalización](#personalización)

## 🏗️ Arquitectura

El sistema de notificaciones consta de tres capas principales:

```
┌─────────────────────────────────────┐
│     NotificationBell Component      │ <- UI Layer
├─────────────────────────────────────┤
│     useNotifications Hook           │ <- Logic Layer
├─────────────────────────────────────┤
│     WebSocketService                │ <- Connection Layer
└─────────────────────────────────────┘
```

### Capas

1. **WebSocketService** (`services/WebSocketService.ts`)
   - Gestiona la conexión WebSocket con el servidor
   - Maneja reconexiones automáticas
   - Proporciona suscripción a eventos

2. **useNotifications Hook** (`hooks/useNotifications.ts`)
   - Lógica de negocio de notificaciones
   - Gestiona el estado de notificaciones
   - Integra notificaciones del navegador
   - Conecta automáticamente cuando hay usuario autenticado

3. **NotificationBell Component** (`components/NotificationBell.tsx`)
   - Interfaz visual de notificaciones
   - Dropdown con lista de notificaciones
   - Indicadores visuales (contador, conexión)
   - Acciones (marcar como leída, limpiar)

## 🧩 Componentes

### WebSocketService

Servicio singleton que gestiona la conexión WebSocket.

**Métodos principales:**
- `connect(token: string)`: Conecta al servidor usando JWT
- `disconnect()`: Desconecta del servidor
- `registerUser(userId: string)`: Registra el usuario en el servidor
- `subscribe(callback)`: Suscribe un callback para recibir notificaciones
- `isConnected()`: Verifica si está conectado

**Características:**
- Reconexión automática (máx. 5 intentos)
- Soporte multi-dispositivo (múltiples sockets por usuario)
- Manejo robusto de errores

### useNotifications Hook

Hook de React que proporciona toda la funcionalidad de notificaciones.

**API:**

```typescript
const {
  notifications,      // Array de notificaciones
  unreadCount,        // Contador de no leídas
  isConnected,        // Estado de conexión
  markAsRead,         // Marcar una como leída
  markAllAsRead,      // Marcar todas como leídas
  clearAll,           // Limpiar todas
  requestPermission,  // Solicitar permiso del navegador
  hasPermission,      // Si tiene permiso del navegador
} = useNotifications()
```

**Comportamiento:**
- Se conecta automáticamente cuando el usuario está autenticado
- Guarda notificaciones en memoria (se pierden al refrescar)
- Muestra notificaciones del navegador si tiene permiso
- Desconecta automáticamente al hacer logout

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

## ⚙️ Configuración

### 1. Variables de entorno

Crear/editar `.env`:

```env
VITE_API_URL=http://localhost:3000/api/v1
VITE_WS_URL=http://localhost:3000
```

### 2. Instalación de dependencias

Las dependencias ya están instaladas:
- `socket.io-client` - Cliente WebSocket

### 3. Integración en el Layout

El componente ya está integrado en `router.tsx`:

```tsx
import { NotificationBell } from './components/NotificationBell'

// En el NavbarSection:
<NavbarSection>
  <NavbarItem href="/search" aria-label="Search">
    <MagnifyingGlassIcon />
  </NavbarItem>
  <NavbarItem href="/inbox" aria-label="Inbox">
    <InboxIcon />
  </NavbarItem>
  <NotificationBell />  {/* <-- Aquí */}
  <Dropdown>
    {/* Avatar dropdown */}
  </Dropdown>
</NavbarSection>
```

## 🚀 Uso

### Uso básico

El sistema funciona automáticamente una vez que el usuario inicia sesión:

1. Usuario hace login → `useAuth()` retorna datos del usuario
2. `useNotifications` detecta usuario autenticado
3. Conecta al WebSocket automáticamente
4. Registra el usuario en el servidor
5. Escucha notificaciones entrantes

### Solicitar permiso de notificaciones del navegador

```tsx
import { useNotifications } from '@/hooks/useNotifications'

function MyComponent() {
  const { requestPermission, hasPermission } = useNotifications()

  const handleEnableNotifications = async () => {
    const permission = await requestPermission()
    if (permission === 'granted') {
      console.log('Notificaciones habilitadas')
    }
  }

  return (
    <button onClick={handleEnableNotifications}>
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

En `hooks/useNotifications.ts`:

```typescript
const showBrowserNotification = useCallback((payload: NotificationPayload) => {
  // ...
  // Cambiar de 5000ms (5 segundos) a otro valor
  setTimeout(() => notification.close(), 5000) // <-- Cambiar aquí
}, [hasPermission])
```

### Personalizar reconexión WebSocket

En `services/WebSocketService.ts`:

```typescript
class WebSocketService {
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5  // <-- Número de intentos
  private reconnectDelay = 3000     // <-- Delay entre intentos (ms)
  // ...
}
```

## 🐛 Troubleshooting

### Las notificaciones no aparecen

1. Verificar que el backend esté corriendo
2. Verificar la variable `VITE_WS_URL` en `.env`
3. Abrir consola del navegador y buscar logs `[WebSocket]`
4. Verificar que el usuario esté autenticado

### No puedo conectar al WebSocket

```
Error: WebSocket connection failed
```

**Solución:**
1. Verificar que el backend esté corriendo en el puerto correcto
2. Verificar CORS en el backend (debe permitir el origen del frontend)
3. Verificar que `VITE_WS_URL` sea correcto

### Las notificaciones del navegador no aparecen

**Solución:**
1. Click en el botón "Habilitar notificaciones"
2. Verificar permisos del navegador (Configuración → Sitios → Notificaciones)
3. Verificar que el navegador soporte notificaciones (no funciona en modo incógnito en algunos navegadores)

### El indicador de conexión siempre está en rojo

**Solución:**
1. El WebSocket tarda 1 segundo en actualizar el estado
2. Verificar en consola si hay logs `[WebSocket] Conectado exitosamente`
3. Verificar que el token JWT sea válido

## 📝 Notas adicionales

### Persistencia

Las notificaciones actuales **NO se persisten** en el servidor ni en localStorage. Se almacenan solo en memoria (estado de React).

**Para agregar persistencia:**
1. Crear endpoint en backend para obtener historial de notificaciones
2. Crear endpoint para marcar notificaciones como leídas en BD
3. Modificar `useNotifications` para cargar historial al iniciar
4. Sincronizar estado local con el servidor

### Seguridad

- Las notificaciones requieren autenticación JWT
- El servidor valida que el usuario solo reciba sus propias notificaciones
- El token se envía en el handshake de Socket.IO

### Performance

- Solo se muestran las últimas 10 notificaciones en el dropdown
- El array de notificaciones se mantiene en memoria sin límite (considerar agregar límite en producción)
- La conexión WebSocket se reutiliza para todas las notificaciones

### Futuras mejoras

- [ ] Persistencia de notificaciones en el servidor
- [ ] Filtros por tipo de notificación
- [ ] Búsqueda de notificaciones
- [ ] Paginación de notificaciones antiguas
- [ ] Notificaciones con sonido
- [ ] Configuración de preferencias de notificación
- [ ] Agrupación de notificaciones similares
- [ ] Acciones rápidas desde la notificación (aprobar/rechazar)

## 🔗 Referencias

- [Socket.IO Client API](https://socket.io/docs/v4/client-api/)
- [Notifications API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
- [React Hooks](https://react.dev/reference/react)
