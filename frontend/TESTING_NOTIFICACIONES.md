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

1. **Verificar en la consola del navegador** (F12 → Console):
   ```
   [WebSocket] Conectando al servidor...
   [WebSocket] Conectado exitosamente
   [WebSocket] Registrando usuario: <user-id>
   ```

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
2. Observar en consola: `[WebSocket] Desconectado`
3. El indicador cambia a rojo
4. Reiniciar el backend
5. Después de 3 segundos: `[WebSocket] Conectado exitosamente`
6. El indicador cambia a verde

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
2. Verificar consola: `[WebSocket] Desconectando...`
3. Iniciar sesión nuevamente
4. Verificar consola: `[WebSocket] Conectado exitosamente`

**Esperado:**
- ✅ Desconexión limpia al hacer logout
- ✅ Reconexión automática al hacer login
- ✅ Notificaciones anteriores se pierden (no hay persistencia)

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

**Esperado:** Las notificaciones NO se persisten, se almacenan solo en memoria.

**Solución:** Implementar persistencia en el backend (futuro enhancement).

### Problema: "Indicador siempre en rojo"

**Soluciones:**
1. Esperar 1 segundo (el estado tarda en actualizarse)
2. Verificar logs en consola
3. Revisar que el token JWT sea válido
4. Verificar que el usuario esté registrado en el backend

## Logs importantes

### Frontend (Consola del navegador)

```
[WebSocket] Conectando al servidor...           ← Inicio de conexión
[WebSocket] Conectado exitosamente              ← Conexión establecida
[WebSocket] Registrando usuario: abc-123        ← Usuario registrado
[WebSocket] Notificación recibida: {...}        ← Notificación recibida
[WebSocket] Desconectado: io server disconnect  ← Desconexión
[WebSocket] Intentando reconectar...            ← Reintento
```

### Backend (Terminal)

```
[NotificationsGateway] Cliente conectado: xyz-456        ← Nuevo cliente
[NotificationsGateway] Usuario registrado: abc-123       ← Usuario registrado
[NotificationsService] Enviando notificación a: abc-123  ← Notificación enviada
[NotificationsGateway] Cliente desconectado: xyz-456     ← Cliente desconectado
```

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
