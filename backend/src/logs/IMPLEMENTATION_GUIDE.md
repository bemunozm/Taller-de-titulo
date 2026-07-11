# 📋 Sistema de Logs - Guía de Implementación

## 🎯 Objetivo

Sistema centralizado para registrar toda la comunicación entre servicios, APIs externas y eventos del sistema. A diferencia del módulo de **Auditoría** (que registra acciones de usuarios), este módulo registra **eventos técnicos del sistema**.

---

## 📊 Diferencias: Auditoría vs Logs

| Característica | **Auditoría** | **Logs del Sistema** |
|----------------|---------------|----------------------|
| **Propósito** | Rastrear acciones de usuarios | Rastrear eventos técnicos |
| **Alcance** | CRUD, autenticación, permisos | HTTP requests, APIs, errores |
| **Usuario** | Siempre tiene userId | No requiere usuario |
| **Retención** | 90 días | 30 días |
| **Enfoque** | Seguridad y compliance | Debugging y monitoreo |
| **Ejemplos** | Login, crear usuario, eliminar visita | Llamada a MediaMTX, error de conexión |

---

## 🏗️ Arquitectura

### Entidad Principal: `SystemLog`

```typescript
{
  id: uuid,
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL',
  type: 'HTTP_REQUEST' | 'MEDIAMTX_API' | 'WORKER_API' | ...,
  service: 'BACKEND' | 'MEDIAMTX' | 'WORKER_PYTHON' | ...,
  message: string,
  
  // HTTP específico
  method?: 'GET' | 'POST' | ...,
  url?: string,
  statusCode?: number,
  responseTime?: number (ms),
  
  // Datos
  requestData?: any,
  responseData?: any,
  
  // Errores
  errorMessage?: string,
  stackTrace?: string,
  
  // Rastreo
  correlationId?: string,
  
  createdAt: timestamp
}
```

### Índices para Performance

```sql
CREATE INDEX idx_logs_level_created ON system_logs(level, created_at);
CREATE INDEX idx_logs_type_created ON system_logs(type, created_at);
CREATE INDEX idx_logs_service_created ON system_logs(service, created_at);
CREATE INDEX idx_logs_status_code ON system_logs(status_code);
CREATE INDEX idx_logs_correlation_id ON system_logs(correlation_id);
```

---

## 🚀 Fase 1: Configuración Inicial

### 1.1 Importar LogsModule en AppModule

```typescript
// backend/src/app.module.ts
import { LogsModule } from './logs/logs.module';

@Module({
  imports: [
    // ... otros módulos
    LogsModule, // Agregar aquí
  ],
})
export class AppModule {}
```

### 1.2 Agregar Permiso en data-initialization.service.ts

```typescript
const permissions = [
  // ... permisos existentes
  { name: 'logs.read', description: 'Ver logs del sistema' },
];

// Asignar a rol Admin
adminRole.permissions = await this.permissionRepository.find({
  where: { 
    name: In([
      // ... permisos existentes
      'logs.read',
    ]) 
  },
});
```

### 1.3 Habilitar Interceptor Global (OPCIONAL)

Si deseas loguear TODAS las peticiones HTTP automáticamente:

```typescript
// backend/src/main.ts
import { HttpLoggingInterceptor } from './logs/interceptors/http-logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Habilitar logging global (OPCIONAL - puede generar muchos logs)
  const logsService = app.get(LogsService);
  app.useGlobalInterceptors(new HttpLoggingInterceptor(logsService));
  
  await app.listen(3000);
}
```

⚠️ **Nota**: El interceptor global puede generar MUCHOS logs. Se recomienda usarlo solo en desarrollo o aplicar filtros (ej: no loguear rutas de health check).

---

## 📝 Fase 2: Uso Manual en Servicios

### 2.1 Inyectar LogsService

```typescript
import { LogsService } from '../logs/logs.service';

@Injectable()
export class MediaMTXService {
  constructor(private readonly logsService: LogsService) {}
}
```

### 2.2 Loguear Llamadas a MediaMTX API

**Antes (sin logs):**
```typescript
async addPath(cameraId: string, streamUrl: string) {
  try {
    const response = await this.httpService.post(url, body).toPromise();
    return response.data;
  } catch (error) {
    throw error;
  }
}
```

**Después (con logs):**
```typescript
async addPath(cameraId: string, streamUrl: string) {
  const correlationId = uuidv4();
  const startTime = Date.now();
  
  try {
    const response = await this.httpService.post(url, body).toPromise();
    
    await this.logsService.logMediaMTX({
      action: 'add_path',
      success: true,
      details: { cameraId, statusCode: response.status },
      correlationId,
    });
    
    return response.data;
  } catch (error) {
    await this.logsService.logMediaMTX({
      action: 'add_path',
      success: false,
      error,
      correlationId,
    });
    
    throw error;
  }
}
```

### 2.3 Loguear Llamadas a Worker Python

```typescript
// backend/src/workers/worker-notifier.service.ts
import { LogsService } from '../logs/logs.service';

async registerCamera(camera: Camera) {
  const correlationId = uuidv4();
  
  try {
    await axios.post(`${this.baseUrl}/register-camera`, {
      cameraId: camera.id,
      streamUrl: camera.streamUrl,
    });
    
    await this.logsService.logWorkerAPI({
      action: 'register_camera',
      cameraId: camera.id,
      success: true,
      correlationId,
    });
  } catch (error) {
    await this.logsService.logWorkerAPI({
      action: 'register_camera',
      cameraId: camera.id,
      success: false,
      error,
      correlationId,
    });
    
    throw error;
  }
}
```

### 2.4 Loguear Detecciones

```typescript
// backend/src/detections/detections.service.ts
async processDetection(detectionData: any) {
  await this.logsService.logDetection({
    cameraId: detectionData.camera_id,
    licensePlate: detectionData.license_plate,
    confidence: detectionData.confidence,
    processingTime: detectionData.processing_time,
    metadata: {
      imageUrl: detectionData.image_url,
      detectedAt: detectionData.detected_at,
    },
  });
  
  // ... resto de la lógica
}
```

---

## 🔍 Fase 3: Consulta de Logs

### 3.1 API Endpoints

**Obtener logs filtrados:**
```
GET /logs?level=ERROR&service=MEDIAMTX&page=1&limit=50
```

**Obtener estadísticas:**
```
GET /logs/stats?startDate=2024-12-01&endDate=2024-12-31
```

### 3.2 Ejemplos de Filtros

```typescript
// Todos los errores de MediaMTX en las últimas 24h
GET /logs?service=MEDIAMTX&level=ERROR&startDate=2024-12-01T00:00:00Z

// Buscar logs por correlation ID (rastrear una petición completa)
GET /logs?correlationId=123e4567-e89b-12d3-a456-426614174000

// Logs de Worker Python con código 500
GET /logs?service=WORKER_PYTHON&statusCode=500

// Buscar texto en mensaje o URL
GET /logs?search=timeout
```

---

## 📊 Fase 4: Frontend (Sistema de Logs View)

### 4.1 Crear Tipos TypeScript

```typescript
// frontend/src/types/logs.ts
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  FATAL = 'FATAL',
}

export enum LogType {
  HTTP_REQUEST = 'HTTP_REQUEST',
  HTTP_RESPONSE = 'HTTP_RESPONSE',
  MEDIAMTX_API = 'MEDIAMTX_API',
  WORKER_API = 'WORKER_API',
  // ... etc
}

export interface SystemLog {
  id: string;
  level: LogLevel;
  type: LogType;
  service: string;
  message: string;
  statusCode?: number;
  responseTime?: number;
  errorMessage?: string;
  correlationId?: string;
  createdAt: string;
}
```

### 4.2 Crear API Client

```typescript
// frontend/src/api/LogsAPI.ts
import api from '@/lib/axios';
import type { SystemLog } from '@/types/logs';

export async function getSystemLogs(query: any) {
  const { data } = await api.get('/logs', { params: query });
  return data;
}

export async function getLogStats(startDate?: string, endDate?: string) {
  const { data } = await api.get('/logs/stats', { 
    params: { startDate, endDate } 
  });
  return data;
}
```

### 4.3 Vista de Logs (similar a AuditLogsView)

```typescript
// frontend/src/views/SystemLogsView.tsx
export default function SystemLogsView() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['systemLogs'],
    queryFn: () => getSystemLogs({}),
    select: (data) => data.data,
  });

  const { data: stats } = useQuery({
    queryKey: ['logStats'],
    queryFn: () => getLogStats(),
  });

  // Similar a AuditLogsView pero con badges diferentes
}
```

---

## 🎨 Sugerencias de UI

### Stats Cards:
- **Total de Logs** (azul) - Icono: DocumentTextIcon
- **Errores** (rojo) - Icono: ExclamationTriangleIcon
- **Tiempo Promedio** (verde) - Icono: ClockIcon  
- **Servicios Activos** (púrpura) - Icono: ServerIcon

### Badges de Color por Nivel:
- DEBUG: zinc
- INFO: blue
- WARN: amber
- ERROR: red
- FATAL: rose

### Badges de Servicio:
- BACKEND: indigo
- MEDIAMTX: purple
- WORKER_PYTHON: emerald
- OPENAI: sky

---

## 🧹 Mantenimiento Automático

El sistema incluye limpieza automática:

```typescript
// Se ejecuta diariamente a las 3 AM
@Cron(CronExpression.EVERY_DAY_AT_3AM)
async cleanupOldLogs() {
  // Elimina logs con más de 30 días
}
```

**Configurar retención:**
```typescript
// logs/logs.service.ts
private readonly retentionDays = 30; // Cambiar según necesidad
```

---

## 🔐 Seguridad

### Sanitización Automática

El sistema sanitiza automáticamente datos sensibles:

```typescript
// Campos que se ocultan:
- password, currentPassword, newPassword
- token, accessToken, refreshToken
- apiKey, secret, authorization

// Antes: { password: '123456' }
// Después: { password: '[REDACTED]' }
```

### Permisos

Solo usuarios con permiso `logs.read` pueden ver logs.

---

## 📈 Casos de Uso

### 1. Debugging de Errores de MediaMTX

```
GET /logs?service=MEDIAMTX&level=ERROR&limit=20
```

### 2. Monitoreo de Performance

```
GET /logs/stats → Ver averageResponseTime
GET /logs?type=HTTP_RESPONSE&search=slow
```

### 3. Rastreo de Request Completo

```
1. GET /logs?correlationId=xxx
2. Ver toda la cadena de llamadas:
   - HTTP Request a /cameras/register
   - MediaMTX API call
   - Worker API call
   - HTTP Response
```

### 4. Análisis de Detecciones

```
GET /logs?type=DETECTION&startDate=2024-12-01
→ Ver todas las detecciones del día
```

---

## ✅ Checklist de Implementación

- [ ] Fase 1: Importar LogsModule
- [ ] Fase 1: Agregar permiso logs.read
- [ ] Fase 2: Loguear MediaMTX calls
- [ ] Fase 2: Loguear Worker API calls
- [ ] Fase 2: Loguear detecciones
- [ ] Fase 3: Probar endpoints de consulta
- [ ] Fase 4: Crear vista frontend
- [ ] Fase 4: Crear tabla con filtros
- [ ] Verificar cleanup automático funciona

---

## 🚨 Recomendaciones

1. **No sobre-loguear**: Evita loguear cada pequeña operación
2. **Usar correlationId**: Facilita rastreo de peticiones complejas
3. **Sanitizar datos**: NUNCA loguear passwords o tokens completos
4. **Monitorear tamaño**: Revisar crecimiento de tabla system_logs
5. **Ajustar retención**: 30 días es razonable, ajustar según necesidad

---

## 📚 Próximos Pasos

Después de implementar este módulo:

1. Integrar con servicio de monitoreo externo (opcional)
2. Configurar alertas automáticas para errores críticos
3. Dashboard de métricas en tiempo real
4. Exportación de logs a CSV/JSON
