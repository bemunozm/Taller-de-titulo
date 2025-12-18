# Sistema de Notificaciones - Documentación

## Componentes del Sistema

### 1. NotificationBell
- **Ubicación**: Navbar (header)
- **Función**: Dropdown con lista de notificaciones recientes (últimas 10)
- **Características**:
  - Badge con contador de notificaciones no leídas
  - Al hacer click en una notificación, abre el modal de detalles
  - Botones para marcar todas como leídas o limpiar todo
  - Estado visual (leída/no leída) con punto azul

### 2. NotificationDetailModal
- **Función**: Modal para ver detalles completos de una notificación
- **Características**:
  - Muestra información completa según el tipo de notificación
  - Para notificaciones que requieren acción (ej: VISITOR_ARRIVAL):
    - Botones de Aprobar/Rechazar
    - Validación de sesión activa
    - Manejo de expiración
  - Para notificaciones informativas:
    - Solo botón de cerrar
  - Marca automáticamente como leída al cerrar
  - Información adicional expandible (JSON)

### 3. VisitorApprovalDialog
- **Función**: Dialog automático que aparece cuando llega un visitante
- **Características**:
  - Se muestra automáticamente para notificaciones VISITOR_ARRIVAL no leídas
  - Validación de sesión en tiempo real
  - Indicador de tiempo restante para aprobar
  - Advertencias de sesión expirada

## Tipos de Notificaciones Soportadas

### Visitas
- `VISIT_CHECK_IN`: Registro de entrada de visitante
- `VISIT_CHECK_OUT`: Registro de salida de visitante
- `VISIT_APPROVED`: Visita aprobada por residente
- `VISIT_REJECTED`: Visita rechazada por residente
- `VISIT_EXPIRING_SOON`: Visita próxima a expirar
- `VISIT_EXPIRED`: Visita expirada

### Conserje Digital
- `VISITOR_ARRIVAL`: Visitante en portería **[REQUIERE ACCIÓN]**
  - Datos mostrados:
    - Nombre del visitante
    - Patente del vehículo (si aplica)
    - Motivo de la visita
    - RUT/Teléfono (en datos adicionales)
  - Acciones disponibles:
    - Aprobar acceso
    - Rechazar acceso
  - Validaciones:
    - Sesión activa
    - No expirada

### Acceso y Seguridad
- `ACCESS_DENIED`: Acceso denegado
- `VEHICLE_DETECTED`: Vehículo detectado
- `UNKNOWN_VEHICLE`: Vehículo desconocido

### Sistema
- `SYSTEM_ALERT`: Alerta del sistema
- `SYSTEM_INFO`: Información del sistema

### Familia
- `FAMILY_INVITATION`: Invitación a familia
- `FAMILY_MEMBER_ADDED`: Miembro agregado
- `FAMILY_MEMBER_REMOVED`: Miembro removido

## Flujo de Usuario

### Escenario 1: Visitante llega a la portería
1. Conserje digital recopila datos del visitante
2. Se envía notificación push al residente (`VISITOR_ARRIVAL`)
3. **Opción A**: El `VisitorApprovalDialog` se abre automáticamente
4. **Opción B**: El residente ve el badge en NotificationBell y hace click
5. Se abre `NotificationDetailModal` con los detalles
6. Residente aprueba o rechaza
7. Notificación se marca como leída automáticamente

### Escenario 2: Ver notificaciones pasadas
1. Usuario hace click en el icono de campana
2. Ve lista de notificaciones (últimas 10)
3. Hace click en cualquier notificación
4. Se abre `NotificationDetailModal` con información completa
5. Para notificaciones informativas, solo puede cerrar
6. Para notificaciones con acciones (VISITOR_ARRIVAL no expiradas), puede aprobar/rechazar

## Estructura de Datos

### Notificación Básica
```typescript
{
  id: string
  payload: {
    title: string
    message: string
    type: NotificationType
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    timestamp: Date
    data?: Record<string, unknown>
    requiresAction?: boolean
  }
  read: boolean
  receivedAt: Date
}
```

### Notificación VISITOR_ARRIVAL
```typescript
{
  id: "notif-uuid"
  payload: {
    title: "Visitante en Portería"
    message: "Juan Pérez solicita acceso"
    type: "VISITOR_ARRIVAL"
    priority: "high"
    timestamp: Date
    requiresAction: true
    data: {
      sessionId: "session-uuid"
      expiresAt: "2024-11-24T12:30:00Z"
      visitor: {
        name: "Juan Pérez"
        rut: "12.345.678-9"
        phone: "+56912345678"
        plate: "ABCD12"
        reason: "Visita personal"
      }
    }
  }
  read: false
  receivedAt: Date
}
```

## Integración con WebSocket

Las notificaciones llegan en tiempo real a través de Socket.IO:

```typescript
// Evento recibido
socket.on('notification', (notification: AppNotification) => {
  // Se agrega automáticamente al estado
  // Se muestra badge actualizado
  // Si es VISITOR_ARRIVAL y requiresAction, se abre VisitorApprovalDialog
})
```

## Mejoras Futuras

- [ ] Sonido/vibración al recibir notificaciones urgentes
- [ ] Filtros por tipo de notificación
- [ ] Búsqueda en historial de notificaciones
- [ ] Paginación (actualmente solo últimas 10)
- [ ] Notificaciones de escritorio (browser notifications)
- [ ] Configuración de preferencias de notificaciones
- [ ] Agrupar notificaciones similares
