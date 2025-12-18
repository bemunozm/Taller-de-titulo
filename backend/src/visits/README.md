# Módulo de Visitas

Este módulo gestiona el sistema de visitas del Conserje Digital, permitiendo la programación y control de acceso tanto para visitas vehiculares como peatonales.

## Características

### Tipos de Visitas

#### 1. Visitas Vehiculares
- Registro de vehículos temporales con acceso por patente
- Creación automática de vehículos visitantes
- Validación de acceso por patente en tiempo real
- Información completa del vehículo (marca, modelo, color)

#### 2. Visitas Peatonales
- Generación automática de código QR único
- Validación de acceso por escaneo QR
- Control de acceso temporal sin vehículo

### Estados de Visitas

- **PENDING**: Visita programada, aún no ha ingresado
- **ACTIVE**: Visita en curso, ya ingresó al condominio
- **COMPLETED**: Visita finalizada con registro de salida
- **CANCELLED**: Visita cancelada antes de ingresar
- **EXPIRED**: Visita que expiró sin haber ingresado

## API Endpoints

### Crear Visita
```
POST /visits
```

**Body (Visita Vehicular):**
```json
{
  "type": "vehicular",
  "visitorName": "Juan Pérez",
  "visitorRut": "12345678-9",
  "visitorPhone": "+56912345678",
  "reason": "Entrega de paquete",
  "validFrom": "2025-11-04T10:00:00Z",
  "validUntil": "2025-11-04T22:00:00Z",
  "hostId": "uuid-del-residente",
  "familyId": "uuid-de-la-familia",
  "vehiclePlate": "ABC123",
  "vehicleBrand": "Toyota",
  "vehicleModel": "Corolla",
  "vehicleColor": "Blanco"
}
```

**Body (Visita Peatonal):**
```json
{
  "type": "pedestrian",
  "visitorName": "María González",
  "visitorRut": "98765432-1",
  "visitorPhone": "+56987654321",
  "reason": "Visita familiar",
  "validFrom": "2025-11-04T15:00:00Z",
  "validUntil": "2025-11-04T20:00:00Z",
  "hostId": "uuid-del-residente",
  "familyId": "uuid-de-la-familia"
}
```

**Respuesta:** Devuelve la visita creada con código QR (para peatonales) o vehículo asociado (para vehiculares).

### Listar Visitas
```
GET /visits?status=pending&type=vehicular&hostId=uuid&familyId=uuid
```

Parámetros query opcionales:
- `status`: Filtrar por estado (pending, active, completed, cancelled, expired)
- `type`: Filtrar por tipo (vehicular, pedestrian)
- `hostId`: Filtrar por anfitrión
- `familyId`: Filtrar por familia

### Visitas Activas
```
GET /visits/active
```
Retorna todas las visitas que están actualmente en curso.

### Visitas Pendientes
```
GET /visits/pending
```
Retorna todas las visitas programadas para hoy o futuro.

### Buscar por Código QR
```
GET /visits/qr/:qrCode
```
Busca una visita peatonal por su código QR.

### Buscar por Patente
```
GET /visits/plate/:plate
```
Busca una visita vehicular activa por patente.

### Validar Acceso
```
POST /visits/validate
```

**Body:**
```json
{
  "identifier": "ABC123",
  "type": "plate"
}
```
o
```json
{
  "identifier": "a1b2c3d4e5f6...",
  "type": "qr"
}
```

**Respuesta:**
```json
{
  "valid": true,
  "visit": { /* datos de la visita */ },
  "message": "Acceso autorizado"
}
```

### Registrar Entrada
```
POST /visits/:id/check-in
```
Registra el ingreso de una visita al condominio. Cambia el estado de PENDING a ACTIVE.

### Registrar Salida
```
POST /visits/:id/check-out
```
Registra la salida de una visita. Cambia el estado de ACTIVE a COMPLETED.

### Cancelar Visita
```
POST /visits/:id/cancel
```
Cancela una visita programada.

### Actualizar Visita
```
PATCH /visits/:id
```

**Body:**
```json
{
  "status": "active",
  "entryTime": "2025-11-04T10:30:00Z",
  "exitTime": "2025-11-04T20:30:00Z"
}
```

### Obtener Visita por ID
```
GET /visits/:id
```

### Eliminar Visita
```
DELETE /visits/:id
```

## Funcionalidades Automáticas

### Expiración Automática de Visitas
El sistema ejecuta una tarea programada cada hora que:
- Revisa todas las visitas pendientes
- Marca como EXPIRED aquellas que superaron su fecha de validez sin haber ingresado
- Registra en consola cuántas visitas fueron expiradas

### Validación de Fechas
El sistema valida automáticamente:
- La fecha de inicio debe ser anterior a la fecha de fin
- El período de validez no puede ser en el pasado
- Las visitas solo pueden registrar entrada dentro de su período válido

### Creación de Vehículos Temporales
Para visitas vehiculares:
- Si la patente ya existe, se asocia ese vehículo
- Si no existe, se crea automáticamente con tipo "visitante" y acceso "temporal"
- El vehículo queda registrado para futuras visitas

## Relaciones de Base de Datos

- **Visit → User (host)**: Relación ManyToOne - Usuario residente que autoriza la visita
- **Visit → Family**: Relación ManyToOne opcional - Familia que recibe la visita
- **Visit → Vehicle**: Relación ManyToOne opcional - Vehículo para visitas vehiculares

## Casos de Uso

### Caso 1: Programar Visita de Familiar con Auto
1. Residente crea visita vehicular con datos del visitante y patente
2. Sistema valida fechas y genera registro
3. Sistema crea o asocia vehículo temporal
4. Al llegar, IA detecta patente y busca visita activa
5. Sistema valida acceso y permite entrada
6. Se registra check-in automático o manual
7. Al salir, se registra check-out

### Caso 2: Delivery o Servicio Técnico a Pie
1. Residente programa visita peatonal
2. Sistema genera código QR único
3. Residente comparte QR con visitante (WhatsApp, email, etc.)
4. Al llegar, conserje escanea QR
5. Sistema valida acceso y permite entrada
6. Se registra check-in
7. Al salir, se registra check-out

### Caso 3: Visita Expirada
1. Residente programa visita para mañana
2. Visitante no llega
3. Tarea automática marca visita como EXPIRED después del período
4. Visita ya no es válida para acceso

## Consideraciones de Seguridad

- Todos los endpoints requieren autenticación (AuthGuard)
- Los códigos QR son únicos y no predecibles (SHA-256)
- Las visitas tienen ventanas de tiempo limitadas
- El sistema registra entrada y salida para auditoría
- Las visitas expiradas no permiten acceso

## Próximas Mejoras

- [ ] Notificaciones al residente cuando su visita ingresa/sale
- [ ] Envío automático de QR por SMS o email
- [ ] Límite de usos por código QR
- [ ] Dashboard de estadísticas de visitas
- [ ] Integración con sistema de control de acceso físico
- [ ] Foto captura al momento de entrada/salida
