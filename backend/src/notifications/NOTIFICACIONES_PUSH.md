# Sistema de Notificaciones Push en Tiempo Real

## 📡 Tecnologías Implementadas

- **WebSockets** con Socket.IO
- **NestJS WebSocket Gateway**
- **Notificaciones en Tiempo Real**

## 🏗️ Arquitectura

```
Cliente (Frontend)          Backend (NestJS)
     │                           │
     │──────── connect ─────────>│ NotificationsGateway
     │<───── connected ───────────│
     │                            │
     │─── register(userId) ──────>│ Mapea socket → userId
     │<─── success ────────────────│
     │                            │
     │                            │ VisitsService.checkIn()
     │                            │      │
     │                            │      ↓
     │                            │ NotificationsService
     │                            │ .notifyVisitCheckIn()
     │                            │      │
     │<── visit:check-in {data} ──┤<─────┘
     │                            │
```

## 🎯 Eventos Implementados

### 1. `visit:check-in` - Entrada de Visita
**Cuándo**: Cuando una visita ingresa al condominio (auto check-in por IA)

**Payload**:
```json
{
  "title": "Visita Ingresada",
  "message": "Juan Pérez ha ingresado al condominio",
  "type": "info",
  "data": {
    "visitId": "uuid-123",
    "visitorName": "Juan Pérez",
    "entryTime": "2025-11-04T10:30:00Z",
    "type": "vehicular"
  },
  "timestamp": "2025-11-04T10:30:05Z"
}
```

### 2. `visit:check-out` - Salida de Visita
**Cuándo**: Cuando una visita sale del condominio (auto check-out por IA)

**Payload**:
```json
{
  "title": "Visita Finalizada",
  "message": "Juan Pérez ha salido del condominio",
  "type": "success",
  "data": {
    "visitId": "uuid-123",
    "visitorName": "Juan Pérez",
    "exitTime": "2025-11-04T18:00:00Z",
    "duration": "7h 30m"
  },
  "timestamp": "2025-11-04T18:00:05Z"
}
```

### 3. `access:denied` - Acceso Denegado
**Cuándo**: Cuando se intenta acceder con un vehículo no autorizado

**Payload**:
```json
{
  "title": "Acceso Denegado",
  "message": "Intento de acceso denegado - Patente: XYZ789",
  "type": "warning",
  "data": {
    "plate": "XYZ789",
    "reason": "Vehículo no registrado y sin visita autorizada",
    "cameraId": "camera-1"
  },
  "timestamp": "2025-11-04T14:00:00Z"
}
```

### 4. `visit:expiring-soon` - Visita Próxima a Expirar
**Cuándo**: Recordatorio antes de que expire una visita (implementación futura)

**Payload**:
```json
{
  "title": "Visita Próxima a Expirar",
  "message": "La visita de Juan Pérez expira pronto",
  "type": "warning",
  "data": {
    "visitId": "uuid-123",
    "visitorName": "Juan Pérez",
    "validUntil": "2025-11-04T22:00:00Z"
  },
  "timestamp": "2025-11-04T21:30:00Z"
}
```

### 5. `alert` - Alertas Generales (Broadcast)
**Cuándo**: Mensajes importantes para todos los usuarios

**Payload**:
```json
{
  "title": "Mantenimiento Programado",
  "message": "El sistema estará en mantenimiento mañana de 2-4 AM",
  "type": "info",
  "timestamp": "2025-11-04T10:00:00Z"
}
```

## 💻 Implementación en el Frontend

### 1. Instalación de Dependencias

```bash
npm install socket.io-client
```

### 2. Cliente de WebSocket (React)

```typescript
// src/services/websocket.service.ts
import { io, Socket } from 'socket.io-client';

class WebSocketService {
  private socket: Socket | null = null;
  private userId: string | null = null;

  connect(userId: string) {
    this.userId = userId;
    this.socket = io('http://localhost:3000', {
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      console.log('✅ Conectado al servidor WebSocket');
      
      // Registrar usuario
      this.socket?.emit('register', { userId });
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Desconectado del servidor WebSocket');
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event: string, callback: (data: any) => void) {
    this.socket?.on(event, callback);
  }

  off(event: string) {
    this.socket?.off(event);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

export const wsService = new WebSocketService();
```

### 3. Hook de Notificaciones (React)

```typescript
// src/hooks/useNotifications.ts
import { useEffect, useState } from 'react';
import { wsService } from '../services/websocket.service';

interface Notification {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  data?: any;
  timestamp: Date;
}

export const useNotifications = (userId: string | null) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;

    // Conectar al WebSocket
    const socket = wsService.connect(userId);
    setIsConnected(true);

    // Escuchar evento de entrada de visita
    wsService.on('visit:check-in', (data: Notification) => {
      console.log('🔔 Visita ingresó:', data);
      setNotifications(prev => [...prev, data]);
      
      // Mostrar notificación del navegador
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(data.title, {
          body: data.message,
          icon: '/logo.png',
        });
      }
    });

    // Escuchar evento de salida de visita
    wsService.on('visit:check-out', (data: Notification) => {
      console.log('🔔 Visita salió:', data);
      setNotifications(prev => [...prev, data]);
      
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(data.title, {
          body: data.message,
          icon: '/logo.png',
        });
      }
    });

    // Escuchar accesos denegados
    wsService.on('access:denied', (data: Notification) => {
      console.log('⚠️ Acceso denegado:', data);
      setNotifications(prev => [...prev, data]);
    });

    // Cleanup al desmontar
    return () => {
      wsService.disconnect();
      setIsConnected(false);
    };
  }, [userId]);

  const clearNotifications = () => {
    setNotifications([]);
  };

  const removeNotification = (index: number) => {
    setNotifications(prev => prev.filter((_, i) => i !== index));
  };

  return {
    notifications,
    isConnected,
    clearNotifications,
    removeNotification,
  };
};
```

### 4. Componente de Notificaciones

```tsx
// src/components/NotificationBell.tsx
import { useState } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { useAuth } from '../hooks/useAuth';

export const NotificationBell = () => {
  const { user } = useAuth();
  const { notifications, isConnected, removeNotification } = useNotifications(user?.id);
  const [showDropdown, setShowDropdown] = useState(false);

  const unreadCount = notifications.length;

  return (
    <div className="relative">
      {/* Botón de campana */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 rounded-full hover:bg-gray-100"
      >
        <BellIcon className="w-6 h-6" />
        
        {/* Badge de notificaciones no leídas */}
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
        
        {/* Indicador de conexión */}
        <span
          className={`absolute bottom-0 right-0 w-2 h-2 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-gray-400'
          }`}
        />
      </button>

      {/* Dropdown de notificaciones */}
      {showDropdown && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border z-50">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Notificaciones</h3>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No hay notificaciones
              </div>
            ) : (
              notifications.map((notif, index) => (
                <div
                  key={index}
                  className={`p-4 border-b hover:bg-gray-50 cursor-pointer ${
                    notif.type === 'error' ? 'bg-red-50' :
                    notif.type === 'warning' ? 'bg-yellow-50' :
                    notif.type === 'success' ? 'bg-green-50' :
                    'bg-blue-50'
                  }`}
                  onClick={() => removeNotification(index)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">{notif.title}</h4>
                      <p className="text-sm text-gray-600 mt-1">{notif.message}</p>
                      <span className="text-xs text-gray-400 mt-2 block">
                        {new Date(notif.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNotification(index);
                      }}
                      className="ml-2 text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
```

### 5. Integración en el Layout Principal

```tsx
// src/layouts/MainLayout.tsx
import { NotificationBell } from '../components/NotificationBell';
import { useEffect } from 'react';

export const MainLayout = ({ children }) => {
  // Solicitar permiso para notificaciones del navegador
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <div>
      <header className="bg-white shadow">
        <div className="flex items-center justify-between px-4 py-3">
          <h1>Conserje Digital</h1>
          <NotificationBell />
        </div>
      </header>
      
      <main>{children}</main>
    </div>
  );
};
```

## 🧪 Pruebas

### Prueba Manual desde Consola del Navegador

```javascript
// Conectar
const socket = io('http://localhost:3000');

// Registrar usuario
socket.emit('register', { userId: 'tu-user-id-aqui' });

// Escuchar eventos
socket.on('visit:check-in', (data) => {
  console.log('Check-in:', data);
});

socket.on('visit:check-out', (data) => {
  console.log('Check-out:', data);
});

// Desconectar
socket.disconnect();
```

### Prueba desde Backend (Manualmente)

```typescript
// En cualquier servicio con acceso a NotificationsService
await this.notificationsService.notifyVisitCheckIn('user-uuid', {
  id: 'visit-123',
  visitorName: 'Test Visitor',
  entryTime: new Date(),
  type: 'vehicular',
});
```

## 🔒 Seguridad

### Autenticación de WebSocket (Mejora Futura)

```typescript
// notifications.gateway.ts
@UseGuards(WsAuthGuard)
@WebSocketGateway()
export class NotificationsGateway {
  // ...
}

// ws-auth.guard.ts
@Injectable()
export class WsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();
    const token = client.handshake.auth.token;
    
    // Validar JWT token
    // ...
    
    return true;
  }
}
```

## 📊 Monitoreo

### Ver Usuarios Conectados

```typescript
// En cualquier endpoint
@Get('online-users')
getOnlineUsers() {
  return this.notificationsService.getOnlineUsers();
}
```

### Ver Estado de Conexión de un Usuario

```typescript
@Get('user/:userId/online')
isUserOnline(@Param('userId') userId: string) {
  return {
    online: this.notificationsService.isUserOnline(userId),
  };
}
```

## 🚀 Flujo Completo

```
1. Usuario abre app → Frontend conecta WebSocket
2. Frontend emite 'register' con userId
3. Backend mapea socket ↔ userId
4. IA detecta patente → createDetection()
5. DetectionsService → checkIn() automático
6. VisitsService → notifyVisitCheckIn()
7. NotificationsGateway → sendToUser()
8. Frontend recibe 'visit:check-in'
9. Muestra notificación en pantalla y navegador
```

## 🎁 Beneficios

✅ **Tiempo Real**: Notificaciones instantáneas sin polling
✅ **Eficiente**: Solo envía a usuarios conectados
✅ **Escalable**: Socket.IO maneja miles de conexiones
✅ **Multi-dispositivo**: Un usuario puede tener varios dispositivos
✅ **Offline-ready**: Si el usuario no está conectado, no se pierde (podrías guardar en DB)

## 📝 Próximas Mejoras

- [ ] Autenticación JWT en WebSocket
- [ ] Persistencia de notificaciones en base de datos
- [ ] Envío de notificaciones push nativas (FCM/APN)
- [ ] Salas por familia/departamento
- [ ] Notificaciones por SMS/Email como fallback
- [ ] Panel de configuración de notificaciones por usuario
