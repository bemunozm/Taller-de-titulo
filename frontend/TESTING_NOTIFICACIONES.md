# 🧪 Guía de Pruebas - Sistema de Notificaciones

## Requisitos previos

1. Backend corriendo en `http://localhost:3000`
2. Frontend corriendo en modo desarrollo
3. Usuario autenticado en el sistema

## Pasos para probar

### 1. Iniciar los servidores

**Backend:**
```powershell
cd "c:\PROYECTOS\Taller de Titulo\backend"
npm run start:dev
```

**Frontend:**
```powershell
cd "c:\PROYECTOS\Taller de Titulo\frontend"
npm run dev
```

### 2. Iniciar sesión

1. Abrir `http://localhost:5173` (o el puerto que Vite asigne)
2. Ir a `/auth/login`
3. Iniciar sesión con un usuario existente

### 3. Verificar la conexión WebSocket

Una vez autenticado:

1. **Verificar en DevTools** (F12 → Network → WS): hay **un solo** socket a
   `VITE_WS_URL` (namespace `/`), abierto con la cookie de sesión. El cliente
   no envía `register` ni `join_room`: las salas las asigna el servidor. El
   frontend no escribe logs de WebSocket en consola (`no-console`).

2. **Verificar el indicador visual**:
   - En el Navbar, buscar el ícono de campana 🔔
   - Debe mostrar un punto verde en la esquina (conectado)
   - Si muestra punto rojo, revisar la conexión

### 4. Habilitar notificaciones del navegador

1. Click en la campana de notificaciones
2. Si aparece el banner amarillo "Habilita las notificaciones..."
3. Click en "Habilitar notificaciones"
4. Aceptar en el diálogo del navegador

**Alternativa:**
- Ir a `/notifications-test`
- Click en "Habilitar Notificaciones del Navegador"

### 5. Generar notificaciones de prueba

#### Opción A: Usar la vista de prueba

1. Navegar a `/notifications-test`
2. Click en "Probar Notificación del Navegador" (solo prueba notificación del navegador, no del backend)

#### Opción B: Generar notificaciones reales desde el backend

**Método 1: Crear una visita y hacer check-in**

1. Crear una visita usando Postman/Thunder Client:
   ```http
   POST http://localhost:3000/api/v1/visits
   Content-Type: application/json
   Authorization: Bearer <your-jwt-token>

   {
     "visitType": "VEHICULAR",
     "startDate": "2024-11-04T10:00:00Z",
     "endDate": "2024-11-04T18:00:00Z",
     "familyId": "<family-id>",
     "vehicleId": "<vehicle-id>"
   }
   ```

2. Hacer check-in de la visita:
   ```http
   PATCH http://localhost:3000/api/v1/visits/<visit-id>/check-in
   Authorization: Bearer <your-jwt-token>
   ```

3. **Resultado esperado:**
   - Notificación en el frontend: "Visita registrada"
   - Notificación del navegador (si está habilitada)
   - Badge rojo con contador en la campana

**Método 2: Simular detección de vehículo**

1. Crear una detección que coincida con una visita:
   ```http
   POST http://localhost:3000/api/v1/detections
   Content-Type: application/json

   {
     "plate": "ABC123",
     "confidence": 0.95,
     "cameraId": "<camera-id>",
     "imageUrl": "http://example.com/image.jpg"
   }
   ```

2. **Resultado esperado:**
   - Si la patente tiene visita PENDING → check-in automático + notificación
   - Si la patente tiene visita ACTIVE → check-out automático + notificación
   - Si no hay visita → notificación de acceso denegado

**Método 3: Usar el script de prueba del backend**

Si existe un script de prueba en el backend:
```powershell
cd "c:\PROYECTOS\Taller de Titulo\backend"
npm run test:notifications
```

### 6. Verificar las notificaciones

#### En el frontend:

1. **Badge en la campana**: debe mostrar el número de notificaciones no leídas
2. **Click en la campana**: abre el dropdown con las notificaciones
3. **Notificación del navegador**: debe aparecer si está habilitada

#### En la vista de prueba (`/notifications-test`):

- **Estado de conexión**: debe mostrar "🟢 Conectado"
- **Permisos del navegador**: debe mostrar "✅ Habilitado"
- **Historial**: debe mostrar todas las notificaciones recibidas

### 7. Probar acciones

#### Marcar como leída:
1. Click en una notificación en el dropdown
2. Verificar que cambia de color (más opaca)
3. El contador debe disminuir

#### Marcar todas como leídas:
1. Click en "Marcar todas como leídas"
2. Todas deben cambiar de estado
3. Contador debe llegar a 0

#### Limpiar todas:
1. Click en "Limpiar todo"
2. El dropdown debe quedar vacío
3. Mensaje "No tienes notificaciones"

### 8. Probar reconexión automática

1. Detener el backend (`Ctrl+C`)
2. El indicador cambia a rojo (estado `reconnecting`)
3. Reiniciar el backend
4. socket.io reintenta solo (de 2 s hasta 30 s entre intentos); al volver,
   el handshake revalida la cookie
5. El indicador cambia a verde

## Casos de prueba específicos

### Caso 1: Usuario nuevo (sin notificaciones)

**Esperado:**
- ✅ Conexión exitosa
- ✅ Campana sin badge
- ✅ Dropdown vacío con mensaje "No tienes notificaciones"

### Caso 2: Recibir notificación de check-in

**Pasos:**
1. Tener frontend abierto y autenticado
2. Hacer check-in de una visita desde Postman

**Esperado:**
- ✅ Badge aparece con "1"
- ✅ Notificación del navegador (si está habilitada)
- ✅ Campana cambia a amarillo (BellAlertIcon)
- ✅ Aparece en el dropdown con badge verde
- ✅ Título: "Visita registrada"

### Caso 3: Recibir notificación de check-out

**Pasos:**
1. Tener frontend abierto
2. Hacer check-out de una visita activa

**Esperado:**
- ✅ Badge incrementa
- ✅ Notificación del navegador
- ✅ Aparece en el dropdown con badge azul
- ✅ Título: "Visita finalizada"

### Caso 4: Acceso denegado

**Pasos:**
1. Crear detección de patente sin visita

**Esperado:**
- ✅ Badge incrementa
- ✅ Notificación del navegador
- ✅ Aparece en el dropdown con badge rojo
- ✅ Título: "Acceso denegado"

### Caso 5: Múltiples dispositivos

**Pasos:**
1. Abrir frontend en 2 navegadores diferentes
2. Iniciar sesión con el mismo usuario en ambos
3. Generar una notificación

**Esperado:**
- ✅ Ambos navegadores reciben la notificación
- ✅ Marcar como leída en uno NO afecta al otro (estado local)

### Caso 6: Logout y reconexión

**Pasos:**
1. Cerrar sesión
2. Verificar en Network → WS que el socket se cerró
3. Iniciar sesión nuevamente (sin recargar la página)
4. Verificar que se abre un socket nuevo

**Esperado:**
- ✅ Desconexión limpia al hacer logout (`useAuth().logout()` cierra el socket)
- ✅ Reconexión automática al hacer login (`RealtimeConnection`)
- ✅ Las notificaciones siguen llegando tras el nuevo login
- ✅ Las notificaciones anteriores se conservan (se persisten en el servidor)

### Caso 7: Sesión terminada desde el servidor

**Pasos:**
1. Con la sesión abierta, revocarla o cerrarla desde otra pestaña
2. El servidor envía `session:ended { reason }` y corta el socket

**Esperado:**
- ✅ El cliente revalida la sesión (`GET /auth/user`) y, como ya no vale,
  no reintenta (sin bucle de reconexión)
- ✅ La app redirige al login; tras iniciar sesión se abre un socket nuevo

### Caso 8: Avisos de seguridad (Guardián Visual)

**Esperado:**
- ✅ Solo Conserje/Administrador (`detections.read` + `condominium.view-all`)
  reciben `security:anomaly_highlight`; nunca el super-admin ni un residente
- ✅ El aviso abre un diálogo y la foto llega por `GET /anomalies/:id`
- ✅ Si la foto falla, el aviso se muestra igual

## Troubleshooting

### Problema: "No se conecta el WebSocket"

**Soluciones:**
1. Verificar que backend esté corriendo
2. Verificar variable `VITE_WS_URL` en `.env`
3. Revisar CORS en el backend
4. Ver logs en consola del navegador

### Problema: "No aparecen las notificaciones del navegador"

**Soluciones:**
1. Verificar permisos en el navegador (Configuración → Sitios)
2. No funciona en modo incógnito
3. Algunos navegadores bloquean notificaciones por defecto
4. Verificar que `hasPermission` sea `true`

### Problema: "Las notificaciones desaparecen al refrescar"

**Esperado:** no deberían: se persisten en el servidor (`GET /notifications`).
Si pasa, revisar que la sesión siga vigente.

### Problema: "Indicador siempre en rojo"

**Soluciones:**
1. Revisar `webSocketService.getStatus()`: `session-ended` = el servidor
   cerró la sesión (iniciar sesión de nuevo); `reconnecting` = corte de red o
   reintento en curso
2. Verificar en Network → WS si el handshake responde `unauthorized` (cookie
   ausente o vencida)
3. Revisar CORS del backend: origen del frontend con `credentials`

## Estados y señales

### Frontend

El frontend no escribe logs de WebSocket en consola (`no-console`). El estado
del socket se lee con `webSocketService.getStatus()` (`idle`, `connecting`,
`connected`, `reconnecting`, `session-ended`) y el tráfico, en Network → WS.

### Backend

El gateway autentica el handshake con la cookie, asigna las salas
(`user:<id>`, `session:<id>`, `org:<id>:security`) y, al terminar una sesión,
emite `session:ended { reason }` antes de cortar el socket.

## Métricas de éxito

- ✅ Conexión WebSocket establecida en < 2 segundos
- ✅ Notificaciones recibidas en < 500ms desde el evento
- ✅ Reconexión automática funciona en < 5 segundos
- ✅ UI responde sin lag con < 100 notificaciones
- ✅ Notificaciones del navegador aparecen inmediatamente

## Próximos pasos

Una vez verificado que todo funciona:

1. [ ] Implementar persistencia de notificaciones en BD
2. [ ] Crear endpoint GET /notifications para historial
3. [ ] Agregar filtros por tipo de notificación
4. [ ] Implementar paginación para notificaciones antiguas
5. [ ] Agregar configuración de preferencias de usuario
6. [ ] Implementar notificaciones con sonido
7. [ ] Agregar acciones rápidas en las notificaciones
