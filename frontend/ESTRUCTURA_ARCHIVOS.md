# 📁 Estructura de Archivos Creados - Sistema de Notificaciones

> **Modelo vigente (Fase 4 · P6, 2026-10-09).** Hay **un solo socket** por pestaña
> (`webSocketService`, namespace `/`) y lo gobierna `components/RealtimeConnection.tsx`
> según el login: conecta con un usuario autenticado y se cierra en logout. El
> handshake se autentica con la **cookie de sesión** de better-auth
> (`withCredentials`); el **servidor asigna las salas** (`user:<id>`,
> `session:<id>` y, con `detections.read` + `condominium.view-all`,
> `org:<id>:security`). El cliente no emite nada: ya no existen `register`,
> `join_room` ni `leave_room`. Al terminar la sesión (logout, expiración o
> revocación) el servidor envía `session:ended { reason }` y corta el socket.
> `ConserjeView`, `ResidenteView` y `AnomalyAlertModal` se eliminaron.
> Detalle en `NOTIFICACIONES_PUSH.md`.

## Frontend (React/TypeScript)

```
frontend/
├── .env                                    # ✨ Actualizado - agregada VITE_WS_URL
├── tsconfig.app.json                       # ✨ Actualizado - agregado path @/services/*
│
├── src/
│   ├── types/
│   │   └── index.ts                        # ✨ Actualizado - agregados tipos de notificaciones
│   │                                       #    - NotificationType
│   │                                       #    - NotificationPayload
│   │                                       #    - AppNotification
│   │
│   ├── services/                           # 🆕 Nueva carpeta
│   │   └── WebSocketService.ts             # 🆕 Socket único de la sesión (singleton)
│   │                                       #    - connect({ userId, verifySession }): idempotente
│   │                                       #    - disconnect(): logout / sin sesión / kiosko
│   │                                       #    - onNotification(handler)
│   │                                       #    - onAnomalyHighlight(handler)
│   │                                       #    - getStatus() / onStatusChange(listener)
│   │                                       #    - Sin register/join_room: salas del servidor
│   │                                       #    - Rechazo o cierre del servidor: revalida
│   │                                       #      la sesión HTTP antes de reintentar
│   │
│   ├── hooks/
│   │   ├── useAuth.ts                      # ✅ Existente (logout cierra el socket)
│   │   └── useNotifications.ts             # 🆕 Hook de notificaciones (no conecta)
│   │                                       #    - notifications: AppNotification[]
│   │                                       #    - unreadCount: number
│   │                                       #    - isConnected: boolean (estado del servicio)
│   │                                       #    - markAsRead()
│   │                                       #    - markAllAsRead()
│   │                                       #    - clearAll()
│   │                                       #    - requestPermission()
│   │                                       #    - hasPermission: boolean
│   │
│   ├── components/
│   │   ├── ui/                             # ✅ Componentes UI existentes
│   │   │   ├── Alert.tsx
│   │   │   ├── Avatar.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Dropdown.tsx
│   │   │   └── ... (otros componentes)
│   │   │
│   │   ├── NotificationBell.tsx            # 🆕 Componente de campana
│   │   │                                   #    - Ícono de campana con badge
│   │   │                                   #    - Indicador de conexión
│   │   │                                   #    - Dropdown con notificaciones
│   │   │                                   #    - Acciones (marcar leída, limpiar)
│   │   │
│   │   ├── RealtimeConnection.tsx          # ✨ P6: dueño único del socket (router)
│   │   │                                   #    - Conecta con usuario autenticado
│   │   │                                   #    - Desconecta sin sesión y en el kiosko
│   │   │                                   #    - Único suscriptor de `notification`
│   │   │
│   │   └── GlobalSecurityNotifications.tsx # ✨ P6: avisos `security:anomaly_highlight`
│   │                                       #    - Solo detections.read + condominium.view-all
│   │                                       #      (nunca el super-admin)
│   │                                       #    - Foto por GET /anomalies/:id
│   │
│   ├── views/
│   │   ├── DashboardView.tsx               # ✅ Existente
│   │   ├── SettingsView.tsx                # ✅ Existente
│   │   ├── TraceabilityView.tsx            # ✅ Existente
│   │   └── NotificationTestView.tsx        # 🆕 Vista de prueba
│   │                                       #    - Panel de estado de conexión
│   │                                       #    - Botones de prueba
│   │                                       #    - Historial de notificaciones
│   │                                       #    - Información de tipos
│   │
│   └── router.tsx                          # ✨ Actualizado
│                                           #    - Importado NotificationBell
│                                           #    - Agregado en NavbarSection
│                                           #    - Nueva ruta /notifications-test
│
├── NOTIFICACIONES_PUSH.md                  # 🆕 Documentación completa
│                                           #    - Arquitectura del sistema
│                                           #    - Guía de uso
│                                           #    - API de componentes
│                                           #    - Personalización
│                                           #    - Troubleshooting
│
├── TESTING_NOTIFICACIONES.md               # 🆕 Guía de pruebas
│                                           #    - Requisitos previos
│                                           #    - Pasos para probar
│                                           #    - Casos de prueba
│                                           #    - Troubleshooting
│
└── IMPLEMENTACION_NOTIFICACIONES.md        # 🆕 Resumen de implementación
                                            #    - Componentes implementados
                                            #    - Características
                                            #    - Flujo de datos
                                            #    - Mejoras futuras
```

## Backend (NestJS) - Ya implementado

```
backend/
└── src/
    └── notifications/
        ├── notifications.gateway.ts         # ✅ Ya implementado
        ├── notifications.service.ts         # ✅ Ya implementado
        ├── notifications.module.ts          # ✅ Ya implementado
        └── index.ts                         # ✅ Ya implementado
```

## Archivos Modificados

### 1. `.env`
```diff
  VITE_API_URL=http://localhost:3000/api/v1
+ VITE_WS_URL=http://localhost:3000
```

### 2. `tsconfig.app.json`
```diff
  "paths": {
    "@/components/*": ["components/*"],
    "@/views/*": ["views/*"],
    "@/layouts/*": ["layouts/*"],
    "@/hooks/*": ["hooks/*"],
    "@/context/*": ["context/*"],
    "@/utils/*": ["utils/*"],
    "@/types/*": ["types/*"],
    "@/lib/*": ["lib/*"],
    "@/helpers/*": ["helpers/*"],
-   "@/api/*": ["api/*"]
+   "@/api/*": ["api/*"],
+   "@/services/*": ["services/*"]
  },
```

### 3. `types/index.ts`
```diff
+ // Notification schemas and types
+ export const notificationTypeSchema = z.enum([...])
+ export type NotificationType = z.infer<typeof notificationTypeSchema>
+ export const notificationPayloadSchema = z.object({...})
+ export type NotificationPayload = z.infer<typeof notificationPayloadSchema>
+ export const notificationSchema = z.object({...})
+ export type AppNotification = z.infer<typeof notificationSchema>
```

### 4. `router.tsx`
```diff
+ import { NotificationBell } from './components/NotificationBell'
+ import NotificationTestView from "./views/NotificationTestView";

  <NavbarSection>
    <NavbarItem href="/search" aria-label="Search">
      <MagnifyingGlassIcon />
    </NavbarItem>
    <NavbarItem href="/inbox" aria-label="Inbox">
      <InboxIcon />
    </NavbarItem>
+   <NotificationBell />
    <Dropdown>
      <DropdownButton as={NavbarItem}>
        <Avatar src="/profile-photo.jpg" square />
      </DropdownButton>
    </Dropdown>
  </NavbarSection>

  {/* Rutas */}
  <Route path="/" element={<DashboardView />} index />
  <Route path="/settings" element={<SettingsView />} />
  <Route path="/traceability" element={<TraceabilityView />} />
  <Route path="/traceability/:id" element={<TraceabilityDetailView />} />
+ <Route path="/notifications-test" element={<NotificationTestView />} />

  {/* Fuera de <Routes>: socket único de la sesión (P6) */}
+ <RealtimeConnection />
```

## Paquetes Instalados

```json
{
  "dependencies": {
    "socket.io-client": "^4.x.x"
  }
}
```

## Resumen de Cambios

| Tipo | Cantidad | Detalles |
|------|----------|----------|
| 🆕 Archivos nuevos | 7 | WebSocketService, useNotifications, NotificationBell, NotificationTestView, 3 documentos MD |
| ✨ Archivos modificados | 4 | .env, tsconfig.app.json, types/index.ts, router.tsx |
| 📦 Paquetes instalados | 1 | socket.io-client |
| 📝 Líneas de código | ~1,200 | Estimado total de líneas de TypeScript |
| 📖 Documentación | ~1,500 | Líneas de documentación en Markdown |

## Rutas Disponibles

| Ruta | Descripción | Autenticación |
|------|-------------|---------------|
| `/` | Dashboard principal | ✅ Requerida |
| `/settings` | Configuración | ✅ Requerida |
| `/traceability` | Trazabilidad | ✅ Requerida |
| `/notifications-test` | Panel de pruebas de notificaciones | ✅ Requerida |

## Integración en el Layout

```
┌────────────────────────────────────────────────────────┐
│                      Navbar                            │
│  ┌──────┐ ┌────────┐ ┌─────────┐ ┌──────────────┐    │
│  │ Logo │ │ Search │ │  Inbox  │ │ 🔔 Notif (2) │ ... │
│  └──────┘ └────────┘ └─────────┘ └──────────────┘    │
│                                         ↑               │
│                              NotificationBell Component │
└────────────────────────────────────────────────────────┘
```

## Flujo de Componentes

```
App (router.tsx)
  ├── RealtimeConnection ← ✨ P6 (dueño único de WebSocketService)
  ├── StackedLayout
  │    ├── Navbar
  │    │    └── NavbarSection
  │    │         ├── Search Icon
  │    │         ├── Inbox Icon
  │    │         ├── NotificationBell ← 🆕
  │    │         │    ├── useNotifications() hook (lista + estado del socket)
  │    │         │    └── Dropdown
  │    │         │         ├── NotificationItem[]
  │    │         │         └── Actions (mark read, clear)
  │    │         └── Avatar Dropdown
  │    └── GlobalSecurityNotifications ← ✨ P6 (solo con permisos de seguridad)
  └── GlobalApprovalDialogs
```

## Arquitectura Técnica

```
┌─────────────────────────────────────────────┐
│           Capa de Presentación              │
│  ┌─────────────────────────────────────┐   │
│  │     NotificationBell.tsx            │   │
│  │     NotificationTestView.tsx        │   │
│  └─────────────────────────────────────┘   │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│           Capa de Lógica                    │
│  ┌─────────────────────────────────────┐   │
│  │     useNotifications.ts             │   │
│  │     - Estado de notificaciones      │   │
│  │     - Permisos del navegador        │   │
│  │     - Acciones (mark, clear)        │   │
│  └─────────────────────────────────────┘   │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│           Capa de Comunicación              │
│  ┌─────────────────────────────────────┐   │
│  │     RealtimeConnection.tsx          │   │
│  │     WebSocketService.ts             │   │
│  │     - Socket único (cookie sesión)  │   │
│  │     - Salas asignadas por servidor  │   │
│  │     - Sin register / join_room      │   │
│  │     - Fin de sesión: no reintenta   │   │
│  └─────────────────────────────────────┘   │
└──────────────┬──────────────────────────────┘
               │
               │ Socket.IO (WebSocket)
               │
┌──────────────▼──────────────────────────────┐
│              BACKEND                         │
│  NotificationsGateway → NotificationsService │
└─────────────────────────────────────────────┘
```

## Estado del Sistema

| Componente | Estado | Funcional |
|------------|--------|-----------|
| WebSocketService | ✅ Completo | ✅ Sí |
| useNotifications | ✅ Completo | ✅ Sí |
| NotificationBell | ✅ Completo | ✅ Sí |
| NotificationTestView | ✅ Completo | ✅ Sí |
| Integración Backend | ✅ Ya existía | ✅ Sí |
| Documentación | ✅ Completa | ✅ Sí |
| Tests Manuales | ⚠️ Pendiente | - |

## Próximos Pasos

1. ✅ Implementación frontend completada
2. ⏭️ Pruebas manuales (seguir TESTING_NOTIFICACIONES.md)
3. ⏭️ Ajustes según feedback de usuario
4. ⏭️ Implementar persistencia en BD (futuro)
5. ⏭️ Tests automatizados (futuro)

---

**Leyenda:**
- 🆕 = Archivo nuevo creado
- ✨ = Archivo modificado/actualizado
- ✅ = Ya existía/implementado
- ⏭️ = Pendiente/futuro
