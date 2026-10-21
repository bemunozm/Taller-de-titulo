# Sistema de Auditoría - Resumen Completo

## 📋 Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  SettingsView (/settings)                                        │
│    └─> AuditLogsView (/settings/audit) [audit.read]            │
│         ├─> Stats Dashboard (total, users, modules, actions)    │
│         ├─> Filtros (module, action, dates, search)             │
│         ├─> Tabla paginada con metadata                         │
│         └─> Exportación (próximamente)                          │
└─────────────────────────────────────────────────────────────────┘
                            ↓ REST API
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND                                   │
├─────────────────────────────────────────────────────────────────┤
│  AuditController                                                 │
│    GET  /audit                    → findAll (con filtros)        │
│    GET  /audit/stats              → getStats (agregaciones)      │
│    GET  /audit/entity/:type/:id   → getEntityHistory            │
│    GET  /audit/:id                → findOne (detalle)           │
│                                                                  │
│  AuditInterceptor (GLOBAL)                                      │
│    ├─> Captura metadata (IP, userAgent, endpoint, duration)     │
│    ├─> Sanitiza passwords/tokens automáticamente                │
│    └─> Logging asíncrono (no bloquea response)                  │
│                                                                  │
│  @Auditable Decorator                                           │
│    ├─> Uso simple en métodos de controladores                   │
│    └─> Opciones: module, action, entityType, capture flags      │
│                                                                  │
│  AuditService                                                    │
│    ├─> log(dto)                    → Crear registro             │
│    ├─> findAll(query)              → Query con filtros          │
│    ├─> getStats(dates)             → Estadísticas               │
│    ├─> getEntityHistory(type, id)  → Historial completo         │
│    (retención: la hace RetentionService, privacy/ - 365 días)   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                      DATABASE (PostgreSQL)                       │
├─────────────────────────────────────────────────────────────────┤
│  audit_logs                                                      │
│    ├─> id (uuid)                                                │
│    ├─> module (enum: 13 valores)                                │
│    ├─> action (enum: 30+ valores)                               │
│    ├─> userId + user relation                                   │
│    ├─> entityId + entityType (polymorphic)                      │
│    ├─> oldValue (jsonb) - estado anterior                       │
│    ├─> newValue (jsonb) - estado nuevo                          │
│    ├─> metadata (jsonb) - ip, userAgent, endpoint, etc.         │
│    ├─> description (text)                                       │
│    ├─> createdAt (timestamp)                                    │
│    └─> Índices:                                                 │
│         • module + createdAt                                    │
│         • userId + createdAt                                    │
│         • action + createdAt                                    │
│         • entityType + entityId                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 📊 Enums Disponibles

### AuditModule (13 módulos)
```
AUTH, USERS, ROLES, PERMISSIONS, CAMERAS, STREAMS, MEDIAMTX,
DETECTIONS, VEHICLES, VISITS, FAMILIES, NOTIFICATIONS, DIGITAL_CONCIERGE
```

### AuditAction (30+ acciones)
```typescript
// Auth
LOGIN, LOGIN_FAILED, LOGOUT, PASSWORD_RESET, PASSWORD_CHANGED

// CRUD
CREATE, READ, UPDATE, DELETE

// Status
ENABLE, DISABLE, ACTIVATE, DEACTIVATE

// Permissions
PERMISSION_GRANT, PERMISSION_REVOKE

// Cameras
LPR_ENABLE, LPR_DISABLE, CAMERA_REGISTER

// Visits
APPROVE, REJECT, CHECK_IN, CHECK_OUT, QR_VALIDATE, QR_GENERATE

// Vehicles
VEHICLE_DETECTED, PLATE_RECOGNIZED

// Generic
EXPORT, IMPORT, SYNC
```

## 🎯 Casos de Uso

### 1. Auditoría Automática (Decorator)
```typescript
@Post('login')
@Auditable({
  module: AuditModule.AUTH,
  action: AuditAction.LOGIN,
  description: 'Usuario inició sesión'
})
async login(@Body() dto: LoginDto) {
  return await this.authService.login(dto);
}
```

**Genera**:
```json
{
  "module": "AUTH",
  "action": "LOGIN",
  "userId": "uuid-del-usuario",
  "description": "Usuario inició sesión",
  "metadata": {
    "ip": "192.168.1.100",
    "userAgent": "Mozilla/5.0...",
    "endpoint": "/auth/login",
    "method": "POST",
    "statusCode": 200,
    "duration": 245
  },
  "createdAt": "2025-01-15T10:30:00Z"
}
```

### 2. Captura de Cambios (UPDATE)
```typescript
@Patch(':id')
@Auditable({
  module: AuditModule.USERS,
  action: AuditAction.UPDATE,
  entityType: 'User',
  captureOldValue: true,  // ⚠️ Importante
  captureResponse: true
})
async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
  return await this.usersService.update(id, dto);
}
```

**Genera**:
```json
{
  "module": "USERS",
  "action": "UPDATE",
  "entityId": "user-uuid",
  "entityType": "User",
  "oldValue": {
    "name": "Juan Pérez",
    "role": "Residente"
  },
  "newValue": {
    "name": "Juan Pérez Silva",
    "role": "Administrador"
  },
  "description": "Usuario actualizado"
}
```

### 3. Auditoría Manual (lógica compleja)
```typescript
constructor(private readonly auditService: AuditService) {}

async approveVisit(visitId: string, userId: string) {
  const visit = await this.repo.findOne(visitId);
  
  // Lógica de negocio compleja...
  const result = await this.performApproval(visit);
  
  // Log manual
  await this.auditService.log({
    module: AuditModule.VISITS,
    action: AuditAction.APPROVE,
    userId,
    entityId: visitId,
    entityType: 'Visit',
    oldValue: { status: 'pending' },
    newValue: { status: 'approved' },
    description: 'Visita aprobada por administrador',
    metadata: {
      approvalReason: 'Verificación manual completada',
      visitType: visit.type
    }
  });
  
  return result;
}
```

### 4. Consultas Frontend
```typescript
// Filtrar por módulo y acción
const { data } = await getAuditLogs({
  module: AuditModule.AUTH,
  action: AuditAction.LOGIN_FAILED,
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  page: 1,
  limit: 20
});

// Estadísticas
const stats = await getAuditStats('2025-01-01', '2025-01-31');
// Retorna: { totalLogs, byAction, byModule, activeUsers }

// Historial de entidad
const history = await getEntityHistory('User', 'user-uuid');
// Retorna todos los cambios históricos del usuario
```

## 🔒 Seguridad y Sanitización

### Automática (Interceptor)
```typescript
// Input:
{ email: 'user@example.com', password: 'secret123' }

// Logged:
{ email: 'user@example.com', password: '[REDACTED]' }
```

Campos sanitizados automáticamente:
- `password`
- `newPassword`
- `currentPassword`
- `token`
- `accessToken`
- `refreshToken`

### Permisos
Frontend: `audit.read` requerido para acceder a `/settings/audit`
Backend: Todos los endpoints protegidos con `@RequirePermissions('audit.read')`

## 📈 Performance

### Optimizaciones Implementadas:
1. **Logging Asíncrono**: No bloquea responses HTTP
2. **Índices DB**: 4 índices compuestos para queries rápidas
3. **Paginación**: Frontend y backend con límite 20/página
4. **Retención automática**: `RetentionService` (`backend/src/privacy/`) borra por lotes los `audit_logs` más antiguos que `RETENTION_AUDIT_DAYS` (365 por defecto, máximo 3650). Corre en un cron diario a las 03:30 hora de Chile (`America/Santiago`); `RETENTION_DRY_RUN=true` solo cuenta sin borrar y `RETENTION_ENABLED=false` la desactiva. Runbook: `backend/src/privacy/README.md`. El antiguo `AuditService.cleanup(90)` se eliminó.

### Métricas Esperadas:
- Overhead por request: ~5-15ms
- Query typical: <100ms (con índices)
- Impacto en throughput: <2%

## 🎨 Frontend Features

### AuditLogsView (`/settings/audit`)
- ✅ Dashboard de estadísticas (4 cards)
- ✅ Búsqueda por texto libre
- ✅ Filtros: módulo, acción, tipo de entidad
- ✅ Tabla paginada responsive
- ✅ Badges coloridos por acción
- ✅ Metadata visible (IP, fecha, usuario)
- ⏳ Exportación CSV/Excel
- ⏳ Modal de detalle expandido
- ⏳ Timeline view para historial de entidad

## 📁 Estructura de Archivos

```
backend/src/audit/
├── entities/
│   └── audit-log.entity.ts          # Entity + Enums + Índices
├── dto/
│   ├── create-audit-log.dto.ts      # DTO con validaciones
│   └── query-audit-logs.dto.ts      # Filtros + paginación
├── decorators/
│   └── auditable.decorator.ts       # @Auditable decorator
├── interceptors/
│   └── audit.interceptor.ts         # Interceptor global
├── audit.controller.ts              # REST endpoints
├── audit.service.ts                 # Business logic
├── audit.module.ts                  # Module config
├── USAGE_EXAMPLES.md                # Ejemplos de uso
└── IMPLEMENTATION_GUIDE.md          # Guía de aplicación

frontend/src/
├── api/
│   └── AuditAPI.ts                  # HTTP client
├── types/
│   └── audit.ts                     # TypeScript types
├── hooks/
│   └── useAuditLogs.ts              # Custom hook
└── views/
    └── AuditLogsView.tsx            # Vista principal
```

## ✅ Checklist de Implementación

### Backend
- [x] Entity con índices
- [x] DTOs con validaciones
- [x] Decorator @Auditable
- [x] Interceptor global
- [x] Service (6 métodos)
- [x] Controller (4 endpoints)
- [x] Module registrado
- [x] Documentación completa

### Frontend
- [x] Types TypeScript
- [x] API client
- [x] Custom hook
- [x] Vista principal con stats
- [x] Filtros y búsqueda
- [x] Paginación
- [x] Ruta protegida
- [x] Link en SettingsView
- [x] Retención automática de `audit_logs` (`RetentionService`, ver "Retención automática" arriba)

### Pendiente
- [ ] Aplicar decoradores en controladores existentes
- [ ] Exportación CSV/Excel
- [ ] Modal de detalle expandido
- [ ] Tests unitarios y e2e
- [ ] Timeline view para historial

## 🚀 Próximos Pasos

### 1. Aplicar Decoradores (Fase 1)
```bash
# Prioridad ALTA
- AuthController (login, registro, password)
- UsersController (CRUD completo)
- RolesController (permisos)
```

### 2. Verificación
```sql
-- Verificar logs generados
SELECT 
  module, 
  action, 
  COUNT(*) as total 
FROM audit_logs 
GROUP BY module, action 
ORDER BY total DESC;

-- Verificar sanitización
SELECT * FROM audit_logs 
WHERE old_value::text LIKE '%password%' 
   OR new_value::text LIKE '%password%';
-- Debe retornar 0 o solo [REDACTED]
```

### 3. Monitoreo
- Dashboard frontend: `/settings/audit`
- Revisar estadísticas semanalmente
- Ajustar política de retención según uso
- Evaluar performance con tráfico real

## 📞 Soporte

Para más información:
- **Ejemplos de uso**: `USAGE_EXAMPLES.md`
- **Guía de implementación**: `IMPLEMENTATION_GUIDE.md`
- **Código fuente**: `backend/src/audit/`
- **Frontend**: `frontend/src/views/AuditLogsView.tsx`

## Condominio y redacción (Fase 4 · P5)

- **`organizationId`:** cada registro lleva el condominio del
  `tenantContext` de la request (o la membresía del usuario). El
  Administrador lee solo los de su condominio (`GET /audit` y la actividad
  reciente del dashboard); las filas sin condominio (`LOGIN_FAILED`, acciones
  del super-admin) las lee solo el super-admin.
- **Redacción recursiva:** `newValue` (respuesta) y `oldValue` pasan por
  `redactSensitiveData` (`interceptors/audit.interceptor.ts`), que reemplaza
  por `[REDACTED]` en TODOS los niveles (objetos anidados y arrays) las claves
  `password`, `token`, `refreshToken`, `secret`, `apiKey`, `hubSecret`,
  `secretHash`, `sourceUrl` (credencial RTSP) y `qrCode` (credencial de acceso
  de una visita), y cualquier clave que contenga password/secret/token/api-key.
- **Alcance por familia:** los registros de auditoría no se acotan por
  familia (los lee quien tiene `audit.read`, hoy el Administrador de su
  condominio).
