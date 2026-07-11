# 🔧 Ejemplo de Integración: MediaMTX Service

Este documento muestra cómo integrar el sistema de logs en el servicio MediaMTX existente.

## 📋 Antes y Después

### ❌ ANTES (Sin logs)

```typescript
// backend/src/mediamtx/mediamtx.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class MediaMTXService {
  private readonly logger = new Logger(MediaMTXService.name);
  
  constructor(private readonly httpService: HttpService) {}

  async addPath(cameraId: string, streamUrl: string, streamKey: string) {
    try {
      const url = `${this.mediamtxUrl}/v3/paths/add`;
      const body = {
        name: streamKey,
        source: streamUrl,
        sourceOnDemand: false,
      };

      const observable = this.httpService.post(url, body, { timeout: 5000 });
      const resp = await lastValueFrom(observable);

      this.logger.log(`Added path for camera ${cameraId}`);
      return resp.data;
    } catch (error) {
      this.logger.error(`Failed to add path for camera ${cameraId}: ${error.message}`);
      throw new InternalServerErrorException('Error al registrar el stream en MediaMTX');
    }
  }
}
```

**Problemas:**
- Solo logs en consola
- No persiste en BD
- No hay rastreo de correlación
- No se captura tiempo de respuesta
- No se guardan detalles de error para análisis

---

### ✅ DESPUÉS (Con logs estructurados)

```typescript
// backend/src/mediamtx/mediamtx.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { LogsService } from '../logs/logs.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MediaMTXService {
  private readonly logger = new Logger(MediaMTXService.name);
  
  constructor(
    private readonly httpService: HttpService,
    private readonly logsService: LogsService, // 👈 Inyectar LogsService
  ) {}

  async addPath(cameraId: string, streamUrl: string, streamKey: string) {
    const correlationId = uuidv4(); // 👈 ID único para rastreo
    const startTime = Date.now();

    try {
      const url = `${this.mediamtxUrl}/v3/paths/add`;
      const body = {
        name: streamKey,
        source: streamUrl,
        sourceOnDemand: false,
      };

      const observable = this.httpService.post(url, body, { timeout: 5000 });
      const resp = await lastValueFrom(observable);

      const responseTime = Date.now() - startTime;

      // 👇 Log estructurado de éxito
      await this.logsService.logMediaMTX({
        action: 'add_path',
        success: true,
        details: {
          cameraId,
          streamKey,
          statusCode: resp.status,
          responseTime,
        },
        correlationId,
      });

      this.logger.log(`Added path for camera ${cameraId} (${responseTime}ms) [${correlationId}]`);
      return resp.data;

    } catch (error) {
      const responseTime = Date.now() - startTime;

      // 👇 Log estructurado de error
      await this.logsService.logMediaMTX({
        action: 'add_path',
        success: false,
        details: {
          cameraId,
          streamKey,
          streamUrl,
          responseTime,
        },
        error,
        correlationId,
      });

      this.logger.error(
        `Failed to add path for camera ${cameraId}: ${error.message} [${correlationId}]`
      );
      
      throw new InternalServerErrorException('Error al registrar el stream en MediaMTX');
    }
  }

  async deletePath(streamKey: string, cameraId: string) {
    const correlationId = uuidv4();
    const startTime = Date.now();

    try {
      const url = `${this.mediamtxUrl}/v3/paths/delete`;
      const observable = this.httpService.delete(url, { timeout: 5000 });
      const resp = await lastValueFrom(observable);

      const responseTime = Date.now() - startTime;

      await this.logsService.logMediaMTX({
        action: 'delete_path',
        success: true,
        details: { cameraId, streamKey, statusCode: resp.status, responseTime },
        correlationId,
      });

      return resp.data;

    } catch (error) {
      const responseTime = Date.now() - startTime;

      await this.logsService.logMediaMTX({
        action: 'delete_path',
        success: false,
        details: { cameraId, streamKey, responseTime },
        error,
        correlationId,
      });

      throw new InternalServerErrorException('Error al eliminar el stream de MediaMTX');
    }
  }

  async getPathInfo(streamKey: string) {
    const correlationId = uuidv4();
    const startTime = Date.now();

    try {
      const url = `${this.mediamtxUrl}/v3/paths/get/${streamKey}`;
      const observable = this.httpService.get(url, { timeout: 5000 });
      const resp = await lastValueFrom(observable);

      const responseTime = Date.now() - startTime;

      await this.logsService.logMediaMTX({
        action: 'get_path_info',
        success: true,
        details: { streamKey, responseTime },
        correlationId,
      });

      return resp.data;

    } catch (error) {
      const responseTime = Date.now() - startTime;

      await this.logsService.logMediaMTX({
        action: 'get_path_info',
        success: false,
        details: { streamKey, responseTime },
        error,
        correlationId,
      });

      return null; // Retornar null si no existe
    }
  }
}
```

**Mejoras:**
- ✅ Logs persistentes en BD
- ✅ Correlation ID para rastreo
- ✅ Métricas de performance (responseTime)
- ✅ Detalles estructurados para análisis
- ✅ Stack traces de errores
- ✅ Filtrable y consultable desde frontend

---

## 🔍 Consultas Útiles

### Ver todos los errores de MediaMTX
```
GET /logs?service=MEDIAMTX&level=ERROR
```

### Rastrear una petición específica
```
GET /logs?correlationId=123e4567-e89b-12d3-a456-426614174000
```

### Ver operaciones lentas (>1000ms)
```sql
SELECT * FROM system_logs 
WHERE service = 'MEDIAMTX' 
  AND response_time > 1000 
ORDER BY created_at DESC;
```

### Estadísticas de MediaMTX
```
GET /logs/stats?service=MEDIAMTX
```

---

## 📊 Dashboard de Análisis

Con estos logs puedes crear dashboards para:

1. **Reliability**: % de éxito vs errores
2. **Performance**: Tiempo promedio de respuesta
3. **Availability**: Uptime de MediaMTX
4. **Error Trends**: Picos de errores en el tiempo
5. **Most Failed Operations**: Operaciones con más fallos

---

## 🚨 Alertas Automáticas (Futuro)

```typescript
// Ejemplo: Enviar alerta si >10 errores en 5 minutos
@Cron('*/5 * * * *') // Cada 5 minutos
async checkMediaMTXHealth() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  
  const errorCount = await this.logsService.getErrorCount({
    service: ServiceName.MEDIAMTX,
    startDate: fiveMinutesAgo.toISOString(),
  });

  if (errorCount > 10) {
    await this.notificationsService.sendAdminAlert({
      title: '⚠️ MediaMTX Health Alert',
      message: `${errorCount} errors in the last 5 minutes`,
      severity: 'HIGH',
    });
  }
}
```
