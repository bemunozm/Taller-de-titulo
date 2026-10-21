# Privacidad: runbook de retención y derechos (Fase 4 · P7.R)

Diseño y plazos: `docs/modulos/privacidad-ley-21719.md` §3 (retención) y §4 (derechos). Este archivo explica solo cómo operarlo.

## 1. Retención automática (`RetentionService`)

- Corre todos los días a las **3:30, hora de Chile**, por lotes de 500 filas, con un tope por categoría. Lo que sobra sigue la noche siguiente.
- Es idempotente y **nunca toca registros vigentes**: visitas no terminales, sesiones ACTIVE ni detecciones esperando al conserje.
- Las visitas ACTIVE sin salida se cierran como EXPIRED pasadas `VISIT_ACTIVE_GRACE_HOURS` desde `validUntil` (`ExpirationService`). Las sesiones del conserje abandonadas pasan a TIMEOUT después de 1 hora, con `endTime` = inicio + 1 h (también `ExpirationService`; su solicitud AWAITING la expira el TTL de `VISIT_APPROVAL_TTL_MINUTES`). Recién entonces entran a la retención.
- El resumen de cada corrida, solo con conteos, queda en el log y en la auditoría: módulo `PRIVACY`, acción `RETENTION_SWEEP`. Lo lee el super-admin.

| Categoría | Acción | Plazo |
|---|---|---|
| `detectionImages`, `anomalyImages` | Borra la imagen; la fila sigue. El frame de nuestro Cloudinary también se borra. | `RETENTION_IMAGES_DAYS`, o de inmediato si la detección ya está anonimizada |
| `visits`, `conciergeSessions` | Anonimiza. La visita suelta su vehículo (`vehicleId = NULL`). | `RETENTION_VISITS_DAYS` desde el cierre: `COALESCE(exitTime, LEAST(validUntil, updatedAt))` |
| `visitorVehicles` | Borra los vehículos de visita sin dueño que ninguna visita usa. | `RETENTION_VISITS_DAYS` desde `updatedAt` |
| `detections` | Anonimiza la patente, el residente y el motivo de sus intentos. | `RETENTION_ACCESS_LOG_DAYS` |
| `anomalies`, `notifications`, `pendingActions` (todas), `auditLogs` | Borra. | Su `RETENTION_*_DAYS` |
| `disabledUsers` | Anonimiza la cuenta, borra sus vehículos y la foto de Cloudinary. | `RETENTION_DISABLED_USERS_DAYS` desde la baja |
| `systemLogs`, `authSessions`, `authVerifications`, `authRateLimits` | Borra (limpieza técnica). | `RETENTION_SYSTEM_LOGS_DAYS`, vencimiento propio y 1 día |

- `RETENTION_ENABLED=false` apaga **solo** las categorías de datos personales. La limpieza técnica corre siempre.
- `RETENTION_DRY_RUN=true` solo cuenta, en todas las categorías.

**Imágenes fuera de nuestro Cloudinary o de su carpeta:** solo se borra una imagen de nuestro cloud (`CLOUDINARY_CLOUD_NAME`) que esté en la carpeta de su categoría: `lpr-frames/` para los frames del LPR y `profile-pictures/` para las fotos de perfil. Si la URL es de otro cloud, de otro host o de otra carpeta, no se borra nada: la referencia se conserva y el log avisa. Hay que revisarlas a mano; corresponden a los conteos `imagesForeign` del resumen.

**Requisito del LPR:** si sube frames a Cloudinary (`CLOUDINARY_UPLOAD=true` en `lpr/.env`), tiene que usar **el mismo `CLOUDINARY_CLOUD_NAME` que el backend**. Si no, todos sus frames quedan como foráneos y nunca se borran. Desde la P7 los sube a la carpeta `lpr-frames/` (`lpr/storage/fs_storage.py`); los frames subidos antes, sin carpeta, también quedan como foráneos.

### Disparo manual

Desde `backend/`, con la misma `.env` del backend:

```bash
node scripts/retention-run.js            # dry-run: imprime cuánto haría por categoría
node scripts/retention-run.js --apply    # aplica (borra y anonimiza)
```

- Comparte el lock con el cron. Si el backend está barriendo, responde `already-running`.
- En producción, sin ts-node, usa `dist/`: corre `npm run build` antes.
- Levanta el contexto completo de la app (sin HTTP), así que corren los mismos hooks de arranque que en el backend.
- **Antes del primer `--apply` en el piloto, revisa el dry-run.**

## 2. Derechos de los titulares

### Acceso y portabilidad: `GET /api/v1/auth/me/data-export`

El residente descarga sus datos desde su perfil. Es un JSON adjunto (`vigilia-mis-datos-<YYYY-MM-DD>.json`), con un límite de 5 por hora. De los visitantes solo sale el nombre.

### Supresión u oposición: `POST /api/v1/privacy/erasure`

La usa la administración, con el permiso `privacy.manage`. Límite: 20 por hora. El cuerpo lleva **exactamente uno** de `rut`, `plate` o `userId`. El super-admin agrega `organizationId` cuando usa `rut` o `plate`.

```bash
API=https://vigilia.example.cl
# 1) Iniciar sesión (cookie de better-auth)
curl -c cookies.txt -H "Content-Type: application/json" -H "Origin: $FRONTEND_URL" \
  -d '{"email":"admin@condominio.cl","password":"..."}' \
  "$API/api/auth/sign-in/email"
# 2) Suprimir por RUT (o {"plate":"BBCD12"}, o {"userId":"<uuid>"})
curl -b cookies.txt -H "Content-Type: application/json" -H "Origin: $FRONTEND_URL" \
  -d '{"rut":"12.345.678-5"}' \
  "$API/api/v1/privacy/erasure"
```

**Respuesta:**

```json
{ "criterion": "rut", "organizationId": "<uuid>",
  "anonymized": { "visits": 2, "conciergeSessions": 1, "detections": 0, "accessAttempts": 0, "users": 0 },
  "deleted": { "notifications": 3, "pendingActions": 1, "visitorVehicles": 0 },
  "skipped": { "visits": 1, "conciergeSessions": 0, "detections": 0, "visitorVehicles": 0 },
  "imagesPendingDeletion": 0, "complete": true }
```

- **`skipped`**: registros vigentes que coinciden, por ejemplo una visita en curso. No se tocan. Hay que repetir el pedido cuando terminen.
- **`complete: false`**: se procesó un lote de 500 filas por categoría. Repite el mismo pedido: es idempotente.
- **`imagesPendingDeletion`**: imágenes de Cloudinary que borrará la próxima corrida de retención. Si se necesita ya, usa `node scripts/retention-run.js --apply`.
- **Por `userId`**: la cuenta debe estar **deshabilitada** antes (`PATCH /users/:id/disable`); si no, responde 409. Una cuenta de personal (Conserje, Seguridad, Administrador) solo la anonimiza el super-admin; para los demás responde 403. La respuesta trae `id` = `userId`, que la auditoría registra como `entityId`.
- **Auditoría**: queda como `PRIVACY / DATA_ERASURE`, solo con los conteos. Nunca se guarda el RUT ni la patente en claro.
- **Plazo legal**: 30 días corridos para responder al titular, prorrogables una vez por 30 días más.

## 3. Riesgos residuales conocidos

- **B2, el nombre en `access_attempts.reason`:** el motivo de un intento de acceso puede llevar el nombre del residente (p. ej. "Residente X autorizado"). Se limpia solo en dos casos: al anonimizar la detección, a los `RETENTION_ACCESS_LOG_DAYS` (90 días), o con una supresión **por patente**. Una supresión por RUT o por usuario no lo toca, porque el intento no guarda el RUT. Para borrarlo antes, hay que pedir además la supresión por las patentes de la persona.
- **Vehículos de residentes:** se borran al anonimizar la cuenta. La supresión por patente solo borra los vehículos **de visita** (sin dueño).
