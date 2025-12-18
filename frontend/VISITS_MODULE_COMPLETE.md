# ✅ Módulo de Visitas - Completado

## 🎯 Decisión de Diseño: Vista Única Adaptativa

Se implementó **una sola vista** que sirve tanto para administradores como residentes, siguiendo las mejores prácticas UX/UI:

### ¿Por qué una sola vista?
✅ **DRY (Don't Repeat Yourself):** Sin código duplicado  
✅ **Mantenimiento simplificado:** Un solo lugar para cambios  
✅ **UX consistente:** Misma experiencia para todos  
✅ **Filtros adaptables:** Backend maneja permisos por rol  

### Diferencias por Rol (Manejadas en Backend)
- **Administrador:** Ve TODAS las visitas, puede crear para cualquier residente
- **Residente:** Solo ve visitas donde es `host`, solo crea para sí mismo

## 📦 Archivos Creados

### 1. VisitForm.tsx ⭐ **Formulario Inteligente**
**Ubicación:** `frontend/src/components/visits/VisitForm.tsx`

**Características Principales:**
- ✅ **Radio Buttons** para seleccionar tipo (Peatonal/Vehicular)
- ✅ **Formulario Condicional:** 
  - Si tipo = `pedestrian`: No muestra campos de vehículo
  - Si tipo = `vehicular`: Muestra 4 campos de vehículo (patente*, marca, modelo, color)
- ✅ **Validación Inteligente:** Patente requerida solo si es vehicular
- ✅ **Organización en Secciones:**
  1. Tipo de Visita (Radio)
  2. Información del Visitante (nombre*, rut, teléfono, motivo)
  3. Información del Vehículo (solo si vehicular)
  4. Período de Validez (desde*, hasta*)
  5. Información del Anfitrión (host*, familia opcional)

**Campos del Formulario:**
```tsx
// Tipo
- type: 'pedestrian' | 'vehicular' (Radio buttons)

// Visitante
- visitorName* (Input)
- visitorRut (Input con formato)
- visitorPhone (Input)
- reason (Input)

// Vehículo (solo si vehicular)
- vehiclePlate* (Input uppercase)
- vehicleBrand (Input)
- vehicleModel (Input)
- vehicleColor (Input)

// Fechas
- validFrom* (datetime-local)
- validUntil* (datetime-local)

// Anfitrión
- hostId* (Select con usuarios)
- familyId (Select con familias)
```

**Layout Responsive:**
- Grid 2 columnas en desktop
- 1 columna en mobile
- Secciones con `<legend>` descriptivos

### 2. VisitTable.tsx ⭐ **Tabla Avanzada**
**Ubicación:** `frontend/src/components/visits/VisitTable.tsx`

**Características Únicas:**
- ✅ **3 Filtros Simultáneos:**
  1. Búsqueda global (nombre, RUT, patente)
  2. Filtro por estado (Select dropdown)
  3. Filtro por tipo (Select dropdown)
- ✅ **Badges con Colores Semánticos:**
  - Estado: `pending`=amber, `active`=lime, `completed`=sky, `cancelled`=zinc, `expired`=rose
  - Tipo: `vehicular`=purple, `pedestrian`=blue
- ✅ **Acciones Condicionales:**
  - **Check-in** (verde): Solo si status = `pending`
  - **Check-out** (azul): Solo si status = `active`
  - **Cancelar** (amarillo): Si status = `pending` OR `active`
  - **Editar** (gris): Siempre disponible
  - **Eliminar** (rojo): Siempre disponible
  - **Ver Detalles** (opcional): Preparado para modal de detalles

**Columnas de la Tabla:**
```tsx
1. Visitante (nombre + RUT en subtitle)
2. Tipo (Badge: vehicular/pedestrian)
3. Estado (Badge con 5 colores)
4. Válido Desde (formato datetime)
5. Válido Hasta (formato datetime)
6. Anfitrión (nombre del user)
7. Vehículo (patente en mono + marca/modelo)
8. Acciones (hasta 6 botones condicionales)
```

**Ejemplo de Fila:**
```
┌───────────────┬─────────┬──────────┬─────────────────┬─────────────────┬────────────┬────────────┬─────────────┐
│ Juan Pérez    │ 🚗      │ 🟢 Activa│ 04/11 10:00    │ 04/11 22:00    │ Pedro Gómez│ ABC123     │ 👁️ ↗️ ↙️ ✏️ 🗑️│
│ 12.345.678-9  │Vehicular│          │                │                │            │ Toyota     │             │
└───────────────┴─────────┴──────────┴─────────────────┴─────────────────┴────────────┴────────────┴─────────────┘
```

**Iconografía de Acciones:**
- 👁️ Ojo: Ver detalles
- ↗️ Flecha entrada: Check-in
- ↙️ Flecha salida: Check-out
- ❌ X: Cancelar
- ✏️ Lápiz: Editar
- 🗑️ Basura: Eliminar

### 3. VisitsView.tsx ⭐ **Vista Dashboard**
**Ubicación:** `frontend/src/views/VisitsView.tsx`

**Características Premium:**
- ✅ **6 Cards de Estadísticas:**
  1. **Total:** Todas las visitas
  2. **Pendientes:** Status=pending + subtitle "Esperando ingreso"
  3. **Activas:** Status=active + subtitle "Dentro del condominio"
  4. **Completadas:** Status=completed + subtitle "Finalizadas"
  5. **Vehiculares:** Type=vehicular + emoji 🚗
  6. **Peatonales:** Type=pedestrian + emoji 🚶

**Layout de Estadísticas:**
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Total: 45    │ Pendientes:8 │ Activas: 3   │ Completadas: │
│              │ Esperando... │ Dentro del...│ 34           │
└──────────────┴──────────────┴──────────────┴──────────────┘
┌────────────────────────────┬────────────────────────────┐
│ 🚗 Vehiculares: 28         │ 🚶 Peatonales: 17          │
│ (Card color púrpura)       │ (Card color azul)          │
└────────────────────────────┴────────────────────────────┘
```

**Colores de Cards:**
- Total: Blanco/zinc (neutro)
- Pendientes: Fondo amber (amarillo)
- Activas: Fondo lime (verde)
- Completadas: Fondo sky (azul cielo)
- Vehiculares: Fondo purple-50 con border purple-200
- Peatonales: Fondo blue-50 con border blue-200

**Dialog Size:**
- Usa `size="4xl"` para el formulario (más grande por tener muchos campos)

## 🎨 UX/UI Patterns Implementados

### 1. Progressive Disclosure (Revelación Progresiva)
```tsx
// Usuario elige tipo
<Radio value="pedestrian" /> Peatonal
<Radio value="vehicular" /> Vehicular

// Solo si vehicular, se revelan campos de vehículo
{visitType === 'vehicular' && (
  <FieldGroup>
    <legend>Información del Vehículo</legend>
    {/* Campos de vehículo */}
  </FieldGroup>
)}
```

### 2. Visual Hierarchy (Jerarquía Visual)
```tsx
// Secciones con legends
<legend className="text-base font-semibold">
  Información del Visitante
</legend>

// Subtexts en stats
<div className="text-xs text-zinc-500">
  Esperando ingreso
</div>
```

### 3. Contextual Actions (Acciones Contextuales)
```tsx
// Botones solo aparecen cuando tienen sentido
const canCheckIn = visit.status === 'pending'
const canCheckOut = visit.status === 'active'
const canCancel = visit.status === 'pending' || visit.status === 'active'

{canCheckIn && <Button>Check-in</Button>}
{canCheckOut && <Button>Check-out</Button>}
{canCancel && <Button>Cancelar</Button>}
```

### 4. Color-Coded States (Estados por Color)
```tsx
const statusColors = {
  pending: 'amber',    // ⏳ Esperando
  active: 'lime',      // ✅ En curso
  completed: 'sky',    // 📋 Finalizada
  cancelled: 'zinc',   // ❌ Cancelada
  expired: 'rose',     // ⏰ Expirada
}
```

### 5. Inline Feedback (Retroalimentación Inmediata)
```tsx
// Toast notifications
toast.success('Check-in registrado exitosamente')
toast.error('Error al registrar check-in')

// Confirmaciones nativas
window.confirm('¿Registrar entrada de "Juan Pérez"?')
```

## 📊 Flujos de Usuario Implementados

### Flujo 1: Crear Visita Peatonal
1. Click "Nueva Visita"
2. Seleccionar "Peatonal" (Radio)
3. Llenar: Nombre, RUT (opcional), Teléfono
4. Seleccionar fechas válido desde/hasta
5. Seleccionar anfitrión (residente)
6. Seleccionar familia (opcional)
7. Submit
8. ✅ Backend genera QR automáticamente
9. Toast de éxito
10. Tabla se actualiza
11. Stats se actualizan

### Flujo 2: Crear Visita Vehicular
1. Click "Nueva Visita"
2. Seleccionar "Vehicular" (Radio)
3. ➡️ Campos de vehículo aparecen
4. Llenar: Nombre, Patente* (mayúsculas auto), Marca, Modelo
5. Seleccionar fechas y anfitrión
6. Submit
7. Toast de éxito
8. Aparece en tabla con badge purple "Vehicular"

### Flujo 3: Check-in de Visita
1. Buscar visita con status "Pendiente" (Badge amber)
2. Click botón verde ↗️ (Check-in)
3. Confirmar en dialog nativo
4. ✅ Backend cambia status a `active` y registra `entryTime`
5. Toast: "Check-in registrado"
6. Badge cambia a lime "Activa"
7. Botón Check-in desaparece
8. Botón Check-out aparece
9. Stats se actualizan (Pendientes -1, Activas +1)

### Flujo 4: Check-out de Visita
1. Ver visita "Activa" (Badge lime)
2. Click botón azul ↙️ (Check-out)
3. Confirmar
4. Backend cambia status a `completed` y registra `exitTime`
5. Badge cambia a sky "Completada"
6. Botones Check-in/Check-out desaparecen
7. Solo quedan: Ver, Editar, Eliminar

### Flujo 5: Cancelar Visita
1. Visita puede estar "Pendiente" O "Activa"
2. Click botón amarillo ❌ (Cancelar)
3. Confirmar cancelación
4. Backend cambia status a `cancelled`
5. Badge cambia a zinc "Cancelada"
6. Todas las acciones especiales desaparecen

### Flujo 6: Filtrar y Buscar
1. **Búsqueda global:** Escribir "Juan" → Filtra por nombre
2. **Filtro estado:** Select "Activas" → Solo muestra activas
3. **Filtro tipo:** Select "Vehicular" → Solo vehiculares
4. **Combinados:** Se pueden usar los 3 filtros a la vez
5. Contador actualiza: "5 visitas" (encontradas)
6. Tabla se actualiza en tiempo real

## 🔄 Estado Machine de Visitas

```
        CREATE
          ↓
      ┌─────────┐
      │ PENDING │ ←─── Estado inicial
      └─────────┘
          │
          │ check-in()
          ↓
      ┌────────┐
      │ ACTIVE │
      └────────┘
          │
          │ check-out()
          ↓
      ┌───────────┐
      │ COMPLETED │ ←─── Estado final
      └───────────┘

Transiciones especiales:
- PENDING → CANCELLED (cancel())
- ACTIVE → CANCELLED (cancel())
- PENDING → EXPIRED (por backend si pasa validUntil)
```

## 📈 Estadísticas Calculadas

```tsx
const stats = {
  total: visits.length,
  pending: visits.filter(v => v.status === 'pending').length,
  active: visits.filter(v => v.status === 'active').length,
  completed: visits.filter(v => v.status === 'completed').length,
  vehicular: visits.filter(v => v.type === 'vehicular').length,
  pedestrian: visits.filter(v => v.type === 'pedestrian').length,
}
```

**Ejemplo de Output:**
```json
{
  "total": 45,
  "pending": 8,
  "active": 3,
  "completed": 34,
  "vehicular": 28,
  "pedestrian": 17
}
```

## 🎯 Accesibilidad (a11y)

✅ **Labels descriptivos** en todos los inputs  
✅ **aria-label** en todos los botones de acción  
✅ **title** tooltips en iconos  
✅ **invalid** prop en inputs con error  
✅ **Mensajes de error** específicos bajo cada campo  
✅ **Keyboard navigation** habilitada  
✅ **Focus management** en modals  

## 📱 Responsive Design

### Mobile (< 768px)
- Filtros en columna
- Tabla con scroll horizontal
- Cards de stats en grid 1 columna
- Dialog a full width

### Tablet (768px - 1024px)
- Filtros en 2 columnas
- Grid de stats 2x2
- Tabla legible

### Desktop (> 1024px)
- Todo en una vista sin scroll
- Grid de stats 4 columnas top + 2 columnas bottom
- Tabla con todas las columnas visibles

## 🔗 Integración Backend

### Endpoints Utilizados

```typescript
// GET /visits
getVisits() → Visit[]

// GET /visits/:id
getVisitById(id) → Visit

// POST /visits
createVisit(data) → Visit
// Si pedestrian → Backend genera qrCode

// PATCH /visits/:id
updateVisit({ id, formData }) → Visit

// POST /visits/:id/check-in
checkInVisit(id) → Visit
// Cambia status a 'active' y registra entryTime

// POST /visits/:id/check-out
checkOutVisit(id) → Visit
// Cambia status a 'completed' y registra exitTime

// POST /visits/:id/cancel
cancelVisit(id) → Visit
// Cambia status a 'cancelled'

// DELETE /visits/:id
deleteVisit(id) → void
```

### Data Flow

```
Frontend                    Backend
   │                          │
   ├─── POST /visits ────────→│ VisitsController
   │                          │    ↓
   │                          │ VisitsService.create()
   │                          │    ↓
   │                          │ Si pedestrian:
   │                          │   - Genera UUID para qrCode
   │                          │   - Guarda en DB
   │                          │    ↓
   │←────── Visit + qrCode ───┤ return visit
   │                          │
   │ ✅ invalidateQueries     │
   │ 🎉 toast.success         │
   │ 🔄 tabla actualiza       │
```

## ✅ Checklist de Completitud

- [x] VisitForm.tsx creado con lógica condicional
- [x] VisitTable.tsx creado con filtros múltiples
- [x] VisitsView.tsx creado con 6 estadísticas
- [x] Radio buttons para tipo visita
- [x] Validación condicional de patente
- [x] Campos de vehículo aparecen/desaparecen
- [x] Selects para host y familia con queries
- [x] Datetime inputs para fechas
- [x] Badges con 5 colores para estados
- [x] Badges con 2 colores para tipos
- [x] Check-in button (condicional)
- [x] Check-out button (condicional)
- [x] Cancel button (condicional)
- [x] Filtro por estado (Select)
- [x] Filtro por tipo (Select)
- [x] Búsqueda global
- [x] Ordenamiento en columnas
- [x] Paginación (10/página)
- [x] Contador de resultados
- [x] Estadísticas calculadas
- [x] Cards de stats con colores
- [x] Emojis en cards tipo
- [x] Ruta /visits agregada
- [x] Link en Navbar
- [x] Link en Sidebar
- [x] TypeScript sin errores
- [x] Responsive design
- [x] Toast notifications
- [x] Confirmaciones de acciones

## 🚀 Cómo Usar

### Probar el Módulo

```powershell
# Terminal 1 - Backend
cd "c:\PROYECTOS\Taller de Titulo\backend"
npm run start:dev

# Terminal 2 - Frontend
cd "c:\PROYECTOS\Taller de Titulo\frontend"
npm run dev
```

Navegar a: http://localhost:5173/visits

### Crear una Visita de Prueba

1. Click "Nueva Visita"
2. Seleccionar "Peatonal"
3. Nombre: "Juan Pérez"
4. RUT: "12.345.678-9"
5. Fecha desde: Hoy 10:00
6. Fecha hasta: Hoy 22:00
7. Anfitrión: Seleccionar un residente
8. Submit
9. ✅ Ver en tabla con QR generado

## 📚 Comparación con Otros Módulos

| Feature | Families | Vehicles | Visits |
|---------|----------|----------|--------|
| Formulario | Simple | Con owner select | **Condicional** ⭐ |
| Tabla | 6 columnas | 8 columnas | **8 columnas** |
| Filtros | Búsqueda | Búsqueda | **Búsqueda + 2 Selects** ⭐ |
| Estadísticas | 3 cards | 3 cards | **6 cards** ⭐ |
| Acciones | Edit, Delete | Edit, Delete | **Edit, Delete, Check-in, Check-out, Cancel, View** ⭐ |
| Badges | 1 tipo | 3 tipos | **5 estados + 2 tipos** ⭐ |
| Complejidad | Baja | Media | **Alta** ⭐ |

## 🎓 Lecciones Aprendidas

### 1. Formularios Condicionales con react-hook-form
```tsx
const visitType = watch('type')

{visitType === 'vehicular' && (
  <FieldGroup>{/* campos */}</FieldGroup>
)}
```

### 2. Validación Condicional con Zod
```tsx
// En types/index.ts
.refine(
  (data) => {
    if (data.type === 'vehicular') {
      return !!data.vehiclePlate
    }
    return true
  },
  { message: 'Patente requerida', path: ['vehiclePlate'] }
)
```

### 3. Acciones Condicionales en Tablas
```tsx
const canCheckIn = visit.status === 'pending'
const canCheckOut = visit.status === 'active'

{canCheckIn && <Button>Check-in</Button>}
{canCheckOut && <Button>Check-out</Button>}
```

### 4. Múltiples Filtros Combinados
```tsx
// Filtro custom antes de tanstack-table
const filteredVisits = useMemo(() => {
  let filtered = visits
  if (statusFilter !== 'all') {
    filtered = filtered.filter(v => v.status === statusFilter)
  }
  if (typeFilter !== 'all') {
    filtered = filtered.filter(v => v.type === typeFilter)
  }
  return filtered
}, [visits, statusFilter, typeFilter])
```

### 5. Dialog Sizes Dinámicos
```tsx
// Para formularios grandes
<Dialog size="4xl">

// Para formularios pequeños
<Dialog size="2xl">
```

---

**Status:** ✅ **100% Completo**  
**Autor:** GitHub Copilot  
**Fecha:** 4 de noviembre de 2025  
**Complejidad:** ⭐⭐⭐⭐⭐ (5/5)
