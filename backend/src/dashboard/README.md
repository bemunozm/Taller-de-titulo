# Dashboard Module - Backend

## 📊 Descripción

Módulo completo de Dashboard que proporciona métricas analíticas en tiempo real del sistema de Conserje Digital. Integra datos de múltiples módulos para ofrecer una vista consolidada de seguridad, salud del sistema, actividad de usuarios y rendimiento.

## 🏗️ Arquitectura

### Estructura de Archivos

```
dashboard/
├── dashboard.module.ts          # Módulo principal con todas las dependencias
├── dashboard.controller.ts      # 8 endpoints REST con autenticación y permisos
├── dashboard.service.ts         # Lógica de negocio y queries complejas
├── dto/
│   └── dashboard-query.dto.ts   # DTOs con validación para queries
└── entities/
    └── dashboard-stats.entity.ts # Interfaces TypeScript para respuestas
```

### Dependencias

El módulo integra con 8 entidades diferentes:

- **PlateDetection**: Detecciones de placas por LPR
- **Visit**: Visitas vehiculares y peatonales
- **Camera**: Cámaras del sistema
- **User**: Usuarios del sistema
- **Family**: Familias residentes
- **AuditLog**: Logs de auditoría
- **SystemLog**: Logs del sistema y servicios
- **Vehicle**: Vehículos registrados

## 🔐 Autenticación y Permisos

Todos los endpoints requieren:
- **AuthGuard**: JWT válido
- **AuthorizationGuard**: Permisos específicos
- **Permiso requerido**: `dashboard.read`

## 📡 Endpoints

### 1. GET /dashboard/summary

**Resumen completo del dashboard** con 3 categorías principales de métricas.

**Query Parameters:**
```typescript
{
  period?: 'today' | 'week' | 'month' | 'custom';  // default: 'today'
  startDate?: string;  // Solo para period='custom'
  endDate?: string;    // Solo para period='custom'
}
```

**Response:**
```typescript
{
  security: SecurityStats;
  systemHealth: SystemHealthStats;
  userActivity: UserActivityStats;
  lastUpdated: Date;
}
```

**SecurityStats:**
- `detectionsToday`: Detecciones hoy
- `detectionsWeek`: Detecciones última semana
- `detectionsMonth`: Detecciones último mes
- `activeVisits`: Visitas activas
- `pendingVisits`: Visitas pendientes
- `completedVisitsToday`: Visitas completadas hoy
- `unauthorizedVehicles`: Vehículos no autorizados
- `alertsPending`: Alertas pendientes
- `avgVisitDuration`: Duración promedio en minutos

**SystemHealthStats:**
- `camerasActive`: Cámaras activas
- `camerasTotal`: Total de cámaras
- `camerasInactive`: Cámaras inactivas
- `errorRateLast24h`: % de errores en últimas 24h
- `avgResponseTime`: Tiempo promedio de respuesta (ms)
- `totalLogsToday`: Total de logs hoy
- `criticalErrorsToday`: Errores críticos hoy
- `services`: Array de ServiceHealth (status, uptime, lastCheck)

**UserActivityStats:**
- `activeFamilies`: Familias activas
- `totalFamilies`: Total de familias
- `totalUsers`: Total de usuarios
- `activeUsersToday`: Usuarios activos hoy
- `activeUsersWeek`: Usuarios activos esta semana
- `newUsersThisWeek`: Usuarios nuevos esta semana
- `topAuditActions`: Top 5 acciones de auditoría
- `notificationsSentToday`: Notificaciones enviadas
- `conciergeSessionsToday`: Sesiones del conserje

**Ejemplo:**
```bash
GET /dashboard/summary?period=week
```

---

### 2. GET /dashboard/visits/trend

**Tendencia de visitas** con métricas agregadas por día.

**Query Parameters:**
```typescript
{
  days?: number;  // 1-90, default: 7
}
```

**Response:**
```typescript
PerformanceTrendData[] = [
  {
    date: string;            // 'YYYY-MM-DD'
    visits: number;          // Total de visitas
    vehicular: number;       // Visitas vehiculares
    pedestrian: number;      // Visitas peatonales
    detections: number;      // Detecciones LPR
    avgResponseTime: number; // Tiempo promedio de respuesta (ms)
  }
]
```

**Ejemplo:**
```bash
GET /dashboard/visits/trend?days=30
```

**Uso:** Ideal para gráficos de líneas mostrando evolución temporal.

---

### 3. GET /dashboard/activity/recent

**Actividad reciente** del sistema con eventos de múltiples fuentes.

**Query Parameters:**
```typescript
{
  limit?: number;  // 1-50, default: 10
  type?: 'detection' | 'visit' | 'audit' | 'error' | 'notification';
}
```

**Response:**
```typescript
RecentActivityItem[] = [
  {
    id: string;
    type: 'detection' | 'visit' | 'audit' | 'error' | 'notification';
    message: string;
    timestamp: Date;
    severity: 'info' | 'warning' | 'error' | 'success';
    metadata: {
      // Campos específicos según tipo
    };
  }
]
```

**Ejemplo:**
```bash
GET /dashboard/activity/recent?limit=20&type=detection
```

**Uso:** Feed de actividad en tiempo real, notificaciones, alertas.

---

### 4. GET /dashboard/detections/latest

**Últimas detecciones** de placas con detalles.

**Query Parameters:**
```typescript
{
  limit?: number;      // 1-100, default: 10
  matchedOnly?: boolean; // default: false (deprecated)
}
```

**Response:**
```typescript
PlateDetection[] = [
  {
    id: string;
    cameraId: string;
    plate: string;
    det_confidence: number;
    ocr_confidence: number;
    createdAt: Date;
    // ... más campos de PlateDetection
  }
]
```

**Ejemplo:**
```bash
GET /dashboard/detections/latest?limit=50
```

**Uso:** Tabla de últimas detecciones, panel de monitoreo.

---

### 5. GET /dashboard/detections/hourly

**Distribución horaria** de detecciones del día actual.

**Query Parameters:** Ninguno

**Response:**
```typescript
DetectionHourlyData[] = [
  {
    hour: number;  // 0-23
    count: number; // Cantidad de detecciones
  }
]
```

**Ejemplo:**
```bash
GET /dashboard/detections/hourly
```

**Uso:** Gráfico de barras mostrando patrones horarios, identificar horarios pico.

---

### 6. GET /dashboard/cameras/activity

**Actividad de detecciones por cámara** (solo hoy).

**Query Parameters:** Ninguno

**Response:**
```typescript
CameraActivityData[] = [
  {
    cameraId: string;
    cameraName: string;
    location: string;
    detectionsToday: number;
    isActive: boolean;
  }
]
```

**Ejemplo:**
```bash
GET /dashboard/cameras/activity
```

**Uso:** Identificar cámaras más activas, detectar cámaras sin actividad, mapa de calor.

---

### 7. GET /dashboard/visits/distribution

**Distribución de tipos de visitas** del mes actual.

**Query Parameters:** Ninguno

**Response:**
```typescript
{
  vehicular: number;
  pedestrian: number;
  total: number;
  vehicularPercent: number;
  pedestrianPercent: number;
}
```

**Ejemplo:**
```bash
GET /dashboard/visits/distribution
```

**Uso:** Gráfico de pie/dona, análisis de tipos de visitas.

---

### 8. GET /dashboard/errors/trends

**Tendencias de errores por servicio** (24h vs 48h previas).

**Query Parameters:** Ninguno

**Response:**
```typescript
ErrorTrendData[] = [
  {
    service: string;
    errorCount: number;
    trend: 'increasing' | 'stable' | 'decreasing';
    lastError: Date;
  }
]
```

**Ejemplo:**
```bash
GET /dashboard/errors/trends
```

**Uso:** Monitoreo de salud del sistema, alertas automáticas, detección de degradación.

**Lógica de trends:**
- `increasing`: errorCount24h > errorCount48h * 1.2
- `decreasing`: errorCount24h < errorCount48h * 0.8
- `stable`: resto de casos

---

## 🔧 Métodos Auxiliares Privados

### `getDateRange(period, startDateStr?, endDateStr?)`
Calcula el rango de fechas según el período solicitado.

### `calculateAvgVisitDuration(startDate, endDate)`
Calcula duración promedio de visitas en minutos usando `exit_time - entry_time`.

### `calculateAvgResponseTime(since)`
Calcula tiempo promedio de respuesta de los logs desde una fecha.

### `getActiveUsersCount(startDate, endDate)`
Cuenta usuarios únicos que tienen al menos 1 registro en audit_logs.

### `getTopAuditActions(limit)`
Obtiene las acciones de auditoría más frecuentes agrupadas por módulo y acción.

### `getServicesHealth()`
Analiza los logs de los últimos 5 minutos para determinar el estado de cada servicio.

**Estados:**
- `healthy`: errorRate ≤ 10%
- `degraded`: errorRate > 10% y ≤ 50%
- `down`: errorRate > 50%

---

## 📊 Queries SQL Complejas

### Visitas por Tipo (con CASE)
```sql
SELECT 
  TO_CHAR(created_at, 'YYYY-MM-DD') as date,
  COUNT(*) as visits,
  SUM(CASE WHEN type = 'vehicular' THEN 1 ELSE 0 END) as vehicular,
  SUM(CASE WHEN type = 'pedestrian' THEN 1 ELSE 0 END) as pedestrian
FROM visits
WHERE created_at >= ? AND created_at <= ?
GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
ORDER BY date ASC;
```

### Errores por Servicio (con subconsultas)
```sql
SELECT 
  service,
  COUNT(*) as count
FROM system_logs
WHERE level = 'ERROR' AND created_at >= ?
GROUP BY service;
```

### Duración Promedio de Visitas
```sql
SELECT 
  AVG(EXTRACT(EPOCH FROM (exit_time - entry_time)) / 60) as avgDuration
FROM visits
WHERE entry_time IS NOT NULL 
  AND exit_time IS NOT NULL
  AND entry_time >= ? 
  AND exit_time <= ?;
```

---

## 🚀 Performance

### Índices Recomendados

**PlateDetection:**
```sql
CREATE INDEX idx_plate_detection_created_at ON plate_detections(created_at DESC);
CREATE INDEX idx_plate_detection_camera_created ON plate_detections(cameraId, created_at DESC);
```

**Visit:**
```sql
CREATE INDEX idx_visit_status ON visits(status);
CREATE INDEX idx_visit_type_created ON visits(type, created_at DESC);
CREATE INDEX idx_visit_entry_exit ON visits(entry_time, exit_time);
```

**SystemLog:**
```sql
CREATE INDEX idx_system_log_level_created ON system_logs(level, created_at DESC);
CREATE INDEX idx_system_log_service_created ON system_logs(service, created_at DESC);
```

**AuditLog:**
```sql
CREATE INDEX idx_audit_user_created ON audit_logs(userId, createdAt DESC);
CREATE INDEX idx_audit_module_action ON audit_logs(module, action);
```

### Optimizaciones Implementadas

1. **Queries Paralelos**: Usa `Promise.all()` para ejecutar múltiples queries independientes simultáneamente
2. **Selects Específicos**: Solo selecciona columnas necesarias (ej: `select: ['id', 'name', 'location', 'active']`)
3. **Agregaciones en DB**: Usa `COUNT()`, `AVG()`, `SUM()` directamente en PostgreSQL
4. **Agrupación Eficiente**: `GROUP BY` con `TO_CHAR()` para agrupar por fecha sin joins innecesarios
5. **Límites Apropiados**: Todos los endpoints con límites configurables

---

## 🧪 Testing

### Pruebas Manuales con cURL

```bash
# 1. Obtener token JWT
TOKEN="your-jwt-token-here"

# 2. Summary general
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/dashboard/summary?period=week

# 3. Tendencia 30 días
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/dashboard/visits/trend?days=30

# 4. Actividad reciente (solo errores)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/dashboard/activity/recent?limit=20&type=error

# 5. Última detección
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/dashboard/detections/latest?limit=1

# 6. Detecciones por hora
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/dashboard/detections/hourly

# 7. Actividad por cámara
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/dashboard/cameras/activity

# 8. Distribución visitas
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/dashboard/visits/distribution

# 9. Tendencias de errores
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/dashboard/errors/trends
```

### Pruebas con Datos Reales

Para generar datos de prueba:

1. **Detecciones**: Ejecutar worker Python de LPR con cámaras activas
2. **Visitas**: Crear visitas desde el frontend
3. **Logs**: Usar servicios (MediaMTX, Workers, OpenAI) que generan logs automáticamente
4. **Auditoría**: Realizar acciones CRUD desde el frontend

---

## 📈 KPIs Monitoreados

### Seguridad
- **Detection Success Rate**: `(detectionsToday / camerasActive) * 100` > 85%
- **Visit Approval Time**: `avgVisitDuration` < 5 min
- **Unauthorized Vehicles Alert**: `unauthorizedVehicles` < 5

### Sistema
- **System Uptime**: `(services.filter(s => s.status === 'healthy').length / services.length) * 100` > 99%
- **Camera Availability**: `(camerasActive / camerasTotal) * 100` > 95%
- **Error Rate**: `errorRateLast24h` < 2%
- **Response Time**: `avgResponseTime` < 300ms

### Usuarios
- **User Engagement**: `(activeUsersToday / totalUsers) * 100` > 20%
- **Family Activity**: `(activeFamilies / totalFamilies) * 100` > 70%

---

## 🔄 Integración con Frontend

### TanStack Query Hooks Sugeridos

```typescript
// hooks/useDashboard.ts
export const useDashboardSummary = (period = 'today') => {
  return useQuery({
    queryKey: ['dashboard', 'summary', period],
    queryFn: () => DashboardAPI.getSummary({ period }),
    refetchInterval: 30000, // Auto-refresh cada 30s
  });
};

export const useVisitsTrend = (days = 7) => {
  return useQuery({
    queryKey: ['dashboard', 'visits-trend', days],
    queryFn: () => DashboardAPI.getVisitsTrend({ days }),
    staleTime: 60000,
  });
};

export const useRecentActivity = (limit = 10, type?: string) => {
  return useQuery({
    queryKey: ['dashboard', 'activity', limit, type],
    queryFn: () => DashboardAPI.getRecentActivity({ limit, type }),
    refetchInterval: 10000, // Refresh cada 10s para actividad
  });
};
```

### WebSocket Real-Time (Futuro)

```typescript
// Emitir eventos desde backend cuando ocurran acciones
socket.emit('dashboard:detection', { plate, cameraId, timestamp });
socket.emit('dashboard:visit', { visitorName, status, timestamp });
socket.emit('dashboard:alert', { severity, message, timestamp });

// Frontend escucha y actualiza estado
useEffect(() => {
  socket.on('dashboard:detection', (data) => {
    queryClient.invalidateQueries(['dashboard', 'summary']);
    showToast(`Nueva detección: ${data.plate}`);
  });
}, []);
```

---

## 📝 Notas de Implementación

### Cambios vs Propuesta Inicial

1. **Entity**: Usamos `PlateDetection` en lugar de `Detection` (entity real del proyecto)
2. **Campos**: Adaptados a esquema real (`createdAt` en lugar de `detectedAt`, `cameraId` string en lugar de relación)
3. **Audit timestamps**: Usa `createdAt` en lugar de `timestamp`
4. **Enums**: Importados desde entities originales (VisitStatus, VisitType, LogLevel)
5. **Queries SQL**: Ajustados a nombres de columnas reales (snake_case en DB, camelCase en TypeORM)

### Próximos Pasos Sugeridos

1. **Crear permiso `dashboard.read`** en tabla permissions:
```sql
INSERT INTO permissions (name, description, module, createdAt, updatedAt)
VALUES ('dashboard.read', 'Ver dashboard con métricas del sistema', 'dashboard', NOW(), NOW());
```

2. **Asignar permiso a roles apropiados** (Admin, Manager)

3. **Implementar frontend** siguiendo la guía en `/frontend/DASHBOARD_FRONTEND_GUIDE.md`

4. **Configurar auto-refresh** en frontend (30s para summary, 10s para actividad reciente)

5. **Agregar Swagger documentation** completa con ejemplos

---

## 🐛 Troubleshooting

### Error: "No se puede resolver PlateDetection"
**Solución**: Verificar que `PlateDetection` esté en `TypeOrmModule.forFeature()` en `dashboard.module.ts`

### Error: "Cannot read property 'status' of undefined"
**Solución**: Agregar validación `where: { status: VisitStatus.ACTIVE }` en lugar de string literal

### Performance lenta en queries
**Solución**: Verificar índices en tablas, especialmente en columnas `created_at`, `status`, `type`

### Datos inconsistentes
**Solución**: Verificar zonas horarias en queries, usar `DATE_TRUNC()` o `TO_CHAR()` apropiadamente

---

## 📚 Referencias

- [NestJS Query Builder](https://typeorm.io/select-query-builder)
- [PostgreSQL Aggregate Functions](https://www.postgresql.org/docs/current/functions-aggregate.html)
- [TanStack Query](https://tanstack.com/query/latest)
- [Recharts Documentation](https://recharts.org/)

---

**Autor**: GitHub Copilot  
**Versión**: 1.0.0  
**Fecha**: Diciembre 2025  
**Estado**: ✅ **IMPLEMENTADO Y FUNCIONAL**
