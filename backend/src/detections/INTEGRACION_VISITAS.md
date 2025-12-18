# Integración Detecciones - Visitas

## 📋 Resumen de Cambios

Se ha modificado el módulo de **Detections** para integrarlo con el módulo de **Visits**, permitiendo que el sistema de IA valide automáticamente visitas vehiculares temporales.

## 🔄 Flujo de Validación Mejorado

### Antes (Sistema Original)
```
IA detecta patente → Busca vehículo → Si existe Y está activo → PERMITIDO
                                    → Si NO existe O inactivo → DENEGADO
```

**Problema:** No consideraba visitas temporales programadas.

### Ahora (Sistema Mejorado)
```
IA detecta patente
    ↓
1. Busca vehículo registrado
    ↓
    ├─ Si es RESIDENTE (vehicleType='residente' o accessLevel='permanente')
    │   └─ PERMITIDO - "Vehículo residente registrado y activo"
    │
    ├─ Si es VISITANTE (vehicleType='visitante' o accessLevel='temporal')
    │   └─ Busca visita activa para esta patente
    │       ├─ Si visita válida → PERMITIDO - "Visita autorizada - [Nombre]"
    │       │   └─ Auto check-in si está PENDING
    │       └─ Si NO válida → DENEGADO - "Visita no válida o expirada"
    │
    └─ Si NO existe vehículo registrado
        └─ Busca visita activa para esta patente
            ├─ Si visita válida → PERMITIDO - "Visita autorizada - [Nombre]"
            │   └─ Auto check-in si está PENDING
            └─ Si NO válida → DENEGADO - "Vehículo no registrado y sin visita"
```

## 🎯 Casos de Uso Soportados

### Caso 1: Vehículo Residente
```typescript
// Vehículo registrado con acceso permanente
{
  plate: "ABC123",
  vehicleType: "residente",
  accessLevel: "permanente",
  owner: { id: "user-123", name: "Juan Pérez" },
  active: true
}
```
**Resultado:** ✅ PERMITIDO - "Vehículo residente registrado y activo"

---

### Caso 2: Visita Vehicular Programada (CON vehículo registrado)
```typescript
// 1. Vehículo temporal creado por el sistema de visitas
{
  plate: "XYZ789",
  vehicleType: "visitante",
  accessLevel: "temporal",
  owner: null,
  active: true
}

// 2. Visita activa asociada
{
  type: "vehicular",
  status: "pending",
  visitorName: "María González",
  validFrom: "2025-11-04T10:00:00Z",
  validUntil: "2025-11-04T22:00:00Z",
  vehicle: { plate: "XYZ789" },
  host: { name: "Juan Pérez" }
}
```
**Resultado:** ✅ PERMITIDO - "Visita autorizada - María González"
**Acción Automática:** La visita cambia de PENDING → ACTIVE (check-in)

---

### Caso 3: Visita Vehicular Programada (SIN vehículo registrado)
```typescript
// Solo existe la visita, NO hay vehículo en la tabla vehicles
{
  type: "vehicular",
  status: "pending",
  visitorName: "Pedro Silva",
  validFrom: "2025-11-04T14:00:00Z",
  validUntil: "2025-11-04T18:00:00Z",
  vehicle: { plate: "LMN456" },
  host: { name: "Ana Torres" }
}
```
**Resultado:** ✅ PERMITIDO - "Visita autorizada - Pedro Silva"
**Nota:** Este caso ocurre cuando se crea una visita pero el vehículo aún no se ha registrado automáticamente.

---

### Caso 4: Vehículo Visitante SIN Visita Válida
```typescript
// Vehículo temporal pero sin visita activa
{
  plate: "DEF456",
  vehicleType: "visitante",
  accessLevel: "temporal",
  active: true
}
// NO existe visita en período válido
```
**Resultado:** ❌ DENEGADO - "Visita no válida o expirada"

---

### Caso 5: Vehículo No Registrado y Sin Visita
```typescript
// IA detecta patente "RST789"
// NO existe en tabla vehicles
// NO existe visita activa con esa patente
```
**Resultado:** ❌ DENEGADO - "Vehículo no registrado y sin visita autorizada"

---

### Caso 6: Visita Expirada
```typescript
// Visita que expiró sin ingresar
{
  type: "vehicular",
  status: "expired",
  validUntil: "2025-11-03T22:00:00Z", // Ya pasó
  vehicle: { plate: "OLD123" }
}
```
**Resultado:** ❌ DENEGADO - "Visita expirada"

## 🔧 Cambios Técnicos Implementados

### 1. DetectionsService (`detections.service.ts`)

**Cambios:**
- ✅ Inyección del `VisitsService` usando `forwardRef` (evita dependencia circular)
- ✅ Nuevo algoritmo de validación en `createDetection()`
- ✅ Llamada a `visitsService.validateAccess()` para visitas
- ✅ Auto check-in cuando se detecta ingreso de visita pending
- ✅ Mensajes de `reason` más descriptivos

**Código clave:**
```typescript
// Verificar si hay una visita válida
const visitValidation = await this.visitsService.validateAccess(dto.plate, 'plate');

if (visitValidation.valid) {
  decision = 'Permitido';
  reason = `Visita autorizada - ${visitValidation.visit.visitorName}`;
  residente = visitValidation.visit.host;
  
  // Auto check-in si está pendiente
  if (visitValidation.visit.status === 'pending') {
    await this.visitsService.checkIn(visitValidation.visit.id);
  }
}
```

### 2. DetectionsModule (`detections.module.ts`)

**Cambios:**
- ✅ Importación de `VisitsModule` con `forwardRef`
- ✅ Provider personalizado para `VisitsService`
- ✅ Manejo de dependencia circular

**Código:**
```typescript
imports: [
  TypeOrmModule.forFeature([PlateDetection, AccessAttempt]), 
  VehiclesModule,
  forwardRef(() => VisitsModule), // Evita circular dependency
],
providers: [
  DetectionsService,
  {
    provide: 'VisitsService',
    useExisting: forwardRef(() => VisitsService),
  },
],
```

## 📊 Trazabilidad y Auditoría

Cada detección genera un `AccessAttempt` con:

```typescript
{
  method: "Patente",
  decision: "Permitido" | "Denegado",
  reason: string, // Descripción detallada
  residente: User | null, // Propietario o anfitrión de la visita
  detection: PlateDetection,
  createdAt: Date
}
```

### Ejemplos de Registros:

**Residente:**
```json
{
  "decision": "Permitido",
  "reason": "Vehículo residente registrado y activo",
  "residente": {
    "id": "user-123",
    "name": "Juan Pérez"
  }
}
```

**Visita:**
```json
{
  "decision": "Permitido",
  "reason": "Visita autorizada - María González",
  "residente": {
    "id": "user-456",
    "name": "Ana Torres" // El anfitrión
  }
}
```

**Denegado:**
```json
{
  "decision": "Denegado",
  "reason": "Vehículo no registrado y sin visita autorizada",
  "residente": null
}
```

## 🚀 Flujo Completo: De Visita a Detección

### 1. Residente Programa Visita
```bash
POST /visits
{
  "type": "vehicular",
  "visitorName": "Carlos Rojas",
  "vehiclePlate": "ABC999",
  "validFrom": "2025-11-05T10:00:00Z",
  "validUntil": "2025-11-05T20:00:00Z",
  "hostId": "resident-uuid"
}
```

**Sistema crea:**
- ✅ Visita en estado PENDING
- ✅ Vehículo temporal (si no existe) con vehicleType="visitante"

### 2. Visitante Llega al Condominio (10:30 AM)

**IA detecta patente "ABC999" y envía:**
```bash
POST /detections
{
  "plate": "ABC999",
  "cameraId": "camera-1",
  "det_confidence": 0.95,
  "ocr_confidence": 0.92
}
```

**Sistema valida:**
1. ✅ Busca vehículo "ABC999" → Existe, tipo "visitante"
2. ✅ Busca visita activa → Existe, status=PENDING, dentro del período
3. ✅ **Valida acceso exitosamente**
4. ✅ **Auto check-in**: Cambia visita a ACTIVE, registra entryTime

**Respuesta:**
```json
{
  "detection": { "id": "det-123", "plate": "ABC999" },
  "attempt": {
    "decision": "Permitido",
    "reason": "Visita autorizada - Carlos Rojas",
    "residente": { "name": "Juan Pérez" },
    "method": "Patente"
  }
}
```

### 3. Visitante Sale del Condominio (18:00 PM)

**IA detecta patente "ABC999" nuevamente:**
```bash
POST /detections
{
  "plate": "ABC999",
  "cameraId": "camera-exit",
  "det_confidence": 0.93
}
```

**Sistema valida:**
1. ✅ Visita ahora está ACTIVE
2. ✅ Aún dentro del período válido
3. ✅ **Permite salida**
4. ⚠️ **No hace check-out automático** (se requiere llamada explícita)

**Nota:** Para registrar salida automáticamente, necesitarías un endpoint adicional o lógica que distinga entrada/salida por cámara.

## ⚙️ Configuración Recomendada de Vehículos

### Para Residentes:
```typescript
{
  vehicleType: "residente",
  accessLevel: "permanente",
  active: true,
  owner: User // Siempre debe tener propietario
}
```

### Para Visitas (Creado automáticamente por VisitsService):
```typescript
{
  vehicleType: "visitante",
  accessLevel: "temporal",
  active: true,
  owner: null // Sin propietario directo
}
```

## 🔍 Debugging y Logs

Para verificar el flujo, puedes agregar logs en `DetectionsService`:

```typescript
console.log(`[Detection] Validando patente: ${dto.plate}`);
console.log(`[Detection] Vehículo encontrado:`, vehicle);
console.log(`[Detection] Validación visita:`, visitValidation);
console.log(`[Detection] Decisión: ${decision} - ${reason}`);
```

## 🎯 Ventajas del Nuevo Sistema

1. ✅ **Acceso automático para visitas programadas**
2. ✅ **Check-in automático al detectar ingreso**
3. ✅ **Validación de períodos de tiempo**
4. ✅ **Trazabilidad completa** (quién, cuándo, por qué)
5. ✅ **Mensajes descriptivos** para el conserje
6. ✅ **Sin duplicación de lógica** (usa el sistema de visitas)
7. ✅ **Flexible** (soporta visitas con/sin vehículo registrado)

## 🚨 Consideraciones Importantes

1. **Dependencia Circular:** Se resolvió usando `forwardRef()` en ambos módulos
2. **Auto Check-in:** Solo se hace si la visita está en estado PENDING
3. **Salida:** Actualmente no se hace check-out automático (mejora futura)
4. **Caché:** Considera agregar caché para consultas frecuentes de visitas
5. **Performance:** Cada detección hace 1-2 queries adicionales (evaluar si es aceptable)

## 📈 Próximas Mejoras

- [ ] Check-out automático al detectar salida
- [ ] Distinguir cámaras de entrada/salida
- [ ] Notificaciones al residente cuando su visita llega
- [ ] Cache de visitas activas para mejor performance
- [ ] Dashboard en tiempo real de visitas dentro del condominio
- [ ] Alertas si una visita no sale dentro del período
