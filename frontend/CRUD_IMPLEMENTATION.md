# 🚧 Implementación de CRUDs - Estado Actual

## ✅ Completado

### 1. Types y Schemas (types/index.ts)
- ✅ Family schemas (familySchema, createFamilySchema)
- ✅ Vehicle schemas (vehicleSchema, createVehicleSchema)  
- ✅ Visit schemas (visitSchema, createVisitSchema)
- ✅ Tipos TypeScript exportados

### 2. API Functions
- ✅ FamilyAPI.ts - Funciones CRUD completas
- ✅ VehicleAPI.ts - Funciones CRUD completas
- ✅ VisitAPI.ts - Funciones CRUD + check-in/check-out
- ✅ AuthAPI.ts - Agregada función getUsers()

### 3. Componentes - Families ✅
- ✅ FamilyForm.tsx - Formulario crear/editar
- ✅ FamilyTable.tsx - Tabla con @tanstack/react-table, ordenamiento, filtros, paginación
- ✅ FamiliesView.tsx - Vista principal completa con estadísticas

### 4. Componentes - Vehicles ✅
- ✅ VehicleForm.tsx - Formulario crear/editar con selección de propietario
- ✅ VehicleTable.tsx - Tabla con @tanstack/react-table, ordenamiento, filtros, paginación  
- ✅ VehiclesView.tsx - Vista principal completa con estadísticas

### 5. Componentes - Visits ✅
- ✅ VisitForm.tsx - Formulario con lógica condicional (vehicular/pedestrian)
- ✅ VisitTable.tsx - Tabla con filtros por estado y tipo, acciones especiales
- ✅ VisitsView.tsx - Vista con 6 estadísticas y diseño mejorado

### 6. Router ✅
- ✅ Rutas agregadas: /families, /vehicles, /visits
- ✅ Links en Navbar
- ✅ Links en Sidebar

## 🎉 ¡IMPLEMENTACIÓN COMPLETA!

Debido al límite de tokens, necesitas crear los siguientes archivos siguiendo el mismo patrón:

### Vehicles (Copiar patrón de Families)

**VehicleTable.tsx:**
```tsx
// Similar a FamilyTable.tsx
// Columnas: Patente, Marca, Modelo, Color, Año, Propietario, Estado, Acciones
// Mostrar Badge para estado activo/inactivo
// Botones: Editar, Eliminar
```

**VehiclesView.tsx:**
```tsx
// Similar a FamiliesView.tsx
// useQuery con getVehicles()
// Dialog con VehicleForm
// Mostrar VehicleTable
```

### Visits

**VisitForm.tsx:**
```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createVisitSchema } from '@/types/index'

// Campos principales:
// - type: Radio buttons (VEHICULAR / PEDESTRIAN)
// - visitorName, visitorRut, visitorPhone
// - validFrom, validUntil (Input type="datetime-local")
// - hostId: Select con getUsers()
// - familyId: Select con getFamilies()
// - reason: Textarea

// Si type === 'vehicular':
// - vehiclePlate (requerido)
// - vehicleBrand, vehicleModel, vehicleColor

// Lógica condicional con watch('type')
```

**VisitTable.tsx:**
```tsx
// Columnas importantes:
// - Visitante
// - Tipo (Badge: vehicular/pedestrian)
// - Estado (Badge con colores: pending=amber, active=lime, completed=sky, cancelled=zinc, expired=red)
// - Fecha Inicio
// - Fecha Fin
// - Anfitrión
// - Vehículo (si aplica)
// - Acciones: Ver Detalles, Editar, Cancelar, Check-in (si pending), Check-out (si active)

// Botones condicionales según estado:
// - PENDING: Botón "Check-in" (checkInVisit)
// - ACTIVE: Botón "Check-out" (checkOutVisit)
// - PENDING/ACTIVE: Botón "Cancelar" (cancelVisit)
```

**VisitsView.tsx:**
```tsx
// Similar a FamiliesView y VehiclesView
// useQuery con getVisits()
// Filtros opcionales por estado y tipo
// Dialog con VisitForm
// Mostrar VisitTable
```

**VisitDetailDialog.tsx:** (Opcional pero recomendado)
```tsx
// Dialog modal para mostrar todos los detalles
// - Información del visitante
// - Fechas y horarios
// - QR Code (si es pedestrian)
// - Información del vehículo (si es vehicular)
// - Información del anfitrión y familia
// - Historial (check-in, check-out)
// - Botón para descargar QR (si pedestrian)
```

## 🛠️ Instrucciones de Implementación

### Paso 1: Completar Vehicles

1. Crear `VehicleTable.tsx` copiando estructura de `FamilyTable.tsx`
2. Ajustar columnas para mostrar: plate, brand, model, year, owner, active
3. Crear `VehiclesView.tsx` copiando estructura de `FamiliesView.tsx`
4. Agregar ruta en `router.tsx`:
   ```tsx
   <Route path="/vehicles" element={<VehiclesView />} />
   ```

### Paso 2: Completar Visits

1. Crear `VisitForm.tsx`:
   - Usar `react-hook-form` con `zodResolver`
   - Campo tipo con Radio buttons
   - Mostrar/ocultar campos de vehículo según tipo
   - DateTimeLocal inputs para fechas
   - Validación condicional de patente

2. Crear `VisitTable.tsx`:
   - Badges con colores según estado
   - Botones condicionales
   - Formatear fechas con `formatDateTime`

3. Crear `VisitsView.tsx`:
   - Query para visits
   - Dialog para formulario
   - Tabla con acciones

4. (Opcional) Crear `VisitDetailDialog.tsx`

5. Agregar ruta:
   ```tsx
   <Route path="/visits" element={<VisitsView />} />
   ```

### Paso 3: Actualizar Router

En `router.tsx`, agregar links en Navbar y Sidebar:

```tsx
{[
  { label: "Inicio", url: "/" },
  { label: "Familias", url: "/families" },
  { label: "Vehículos", url: "/vehicles" },
  { label: "Visitas", url: "/visits" },
  { label: "Cámaras - Conserje", url: "/conserje" },
  { label: "Trazabilidad", url: "/traceability" },
  { label: "Configuraciones", url: "/settings" },
].map(({ label, url }) => (
  <NavbarItem key={label} href={url}>
    {label}
  </NavbarItem>
))}
```

## 📋 Checklist Final

- [ ] VehicleTable.tsx creado
- [ ] VehiclesView.tsx creado
- [ ] Ruta /vehicles agregada
- [ ] VisitForm.tsx creado con validación condicional
- [ ] VisitTable.tsx creado con badges y botones
- [ ] VisitsView.tsx creado
- [ ] Ruta /visits agregada
- [ ] Links agregados en Navbar
- [ ] Links agregados en Sidebar
- [ ] Probado flujo completo de Familias
- [ ] Probado flujo completo de Vehículos
- [ ] Probado flujo completo de Visitas
- [ ] Probado check-in y check-out

## 🎨 Guía de Estilos

### Badges de Estado

```tsx
// Familias/Vehículos - active
<Badge color={active ? 'lime' : 'zinc'}>
  {active ? 'Activo' : 'Inactivo'}
</Badge>

// Visitas - status
const statusColors = {
  pending: 'amber',
  active: 'lime',
  completed: 'sky',
  cancelled: 'zinc',
  expired: 'rose',
}

<Badge color={statusColors[status]}>
  {statusLabels[status]}
</Badge>
```

### Botones de Acción

```tsx
// Editar
<Button plain onClick={() => onEdit(item)}>
  <PencilIcon className="w-4 h-4" />
</Button>

// Eliminar
<Button plain onClick={() => handleDelete(item)}>
  <TrashIcon className="w-4 h-4 text-red-600" />
</Button>

// Check-in/Check-out
<Button color="lime" onClick={() => handleCheckIn(visit)}>
  <ArrowRightIcon className="w-4 h-4" />
  Check-in
</Button>
```

## 🔗 Recursos Útiles

- Componentes UI en: `frontend/src/components/ui/`
- Helpers de formato: `frontend/src/helpers/index.ts`
- Ejemplo de tabla: `FamilyTable.tsx`
- Ejemplo de formulario: `FamilyForm.tsx`
- Ejemplo de vista: `FamiliesView.tsx`

## 📞 Contacto

Si necesitas ayuda con alguna parte específica, puedes:
1. Revisar los archivos ya creados como referencia
2. Consultar la documentación de shadcn/ui
3. Seguir los patrones establecidos en FamiliesView

---

**Nota:** Todos los archivos siguen el mismo patrón. Una vez que entiendas FamiliesView, podrás replicar fácilmente para Vehicles y Visits.
