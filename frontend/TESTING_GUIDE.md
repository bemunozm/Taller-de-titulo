# 🧪 Guía de Testing - Módulos Families y Vehicles

## 🚀 Cómo Probar los Módulos

### 1. Iniciar el Frontend
```powershell
cd "c:\PROYECTOS\Taller de Titulo\frontend"
npm run dev
```

### 2. Iniciar el Backend
```powershell
cd "c:\PROYECTOS\Taller de Titulo\backend"
npm run start:dev
```

### 3. Navegar a las Vistas

#### Familias
- URL: `http://localhost:5173/families`
- Navbar: Click en "Familias"
- Sidebar: Click en "Familias" (mobile)

#### Vehículos
- URL: `http://localhost:5173/vehicles`
- Navbar: Click en "Vehículos"
- Sidebar: Click en "Vehículos" (mobile)

## ✅ Checklist de Testing

### Módulo Families

#### Visualización
- [ ] La vista carga correctamente
- [ ] Se muestran 3 cards de estadísticas (Total, Activas, Miembros)
- [ ] La tabla muestra las familias existentes
- [ ] Input de búsqueda está visible
- [ ] Contador de resultados se muestra

#### Búsqueda y Filtrado
- [ ] Buscar por nombre funciona
- [ ] Buscar por departamento funciona
- [ ] Contador actualiza con los resultados filtrados
- [ ] Tabla se actualiza con los resultados

#### Ordenamiento
- [ ] Click en "Nombre" ordena alfabéticamente
- [ ] Click nuevamente invierte el orden (desc → asc)
- [ ] Icono de flecha aparece en el header activo
- [ ] Click en "Departamento" ordena por departamento
- [ ] Click en "Estado" ordena por activo/inactivo
- [ ] Click en "Miembros" ordena por cantidad

#### Paginación
- [ ] Muestra máximo 10 familias por página
- [ ] Botón "Siguiente" funciona
- [ ] Botón "Anterior" funciona
- [ ] Botones se deshabilitan cuando no hay más páginas
- [ ] Contador de página se actualiza (Página X de Y)

#### Crear Familia
- [ ] Click en "Nueva Familia" abre el dialog
- [ ] Formulario se muestra vacío
- [ ] Validación funciona (nombre requerido)
- [ ] Submit crea la familia
- [ ] Toast de éxito aparece
- [ ] Dialog se cierra
- [ ] Tabla se actualiza automáticamente
- [ ] Estadísticas se actualizan

#### Editar Familia
- [ ] Click en ícono de editar abre el dialog
- [ ] Formulario se rellena con datos actuales
- [ ] Modificar datos funciona
- [ ] Submit actualiza la familia
- [ ] Toast de éxito aparece
- [ ] Dialog se cierra
- [ ] Tabla muestra los cambios
- [ ] Estadísticas se actualizan si es necesario

#### Eliminar Familia
- [ ] Click en ícono de eliminar muestra confirmación
- [ ] "Cancelar" cierra la confirmación sin eliminar
- [ ] "Aceptar" elimina la familia
- [ ] Toast de éxito aparece
- [ ] Tabla se actualiza
- [ ] Estadísticas se actualizan

#### Estados Visuales
- [ ] Badge "Activa" es verde
- [ ] Badge "Inactiva" es gris
- [ ] Cantidad de miembros se muestra correctamente
- [ ] "-" aparece en campos vacíos

### Módulo Vehicles

#### Visualización
- [ ] La vista carga correctamente
- [ ] Se muestran 3 cards de estadísticas (Total, Activos, Inactivos)
- [ ] La tabla muestra los vehículos existentes
- [ ] Input de búsqueda está visible
- [ ] Contador de resultados se muestra

#### Búsqueda y Filtrado
- [ ] Buscar por patente funciona
- [ ] Buscar por marca funciona
- [ ] Buscar por modelo funciona
- [ ] Contador actualiza con los resultados filtrados
- [ ] Tabla se actualiza con los resultados

#### Ordenamiento
- [ ] Click en "Patente" ordena alfabéticamente
- [ ] Click en "Marca" ordena por marca
- [ ] Click en "Modelo" ordena por modelo
- [ ] Click en "Color" ordena por color
- [ ] Click en "Año" ordena numéricamente
- [ ] Click en "Tipo" ordena por tipo
- [ ] Click en "Estado" ordena por activo/inactivo
- [ ] Iconos de flecha aparecen correctamente

#### Paginación
- [ ] Muestra máximo 10 vehículos por página
- [ ] Navegación entre páginas funciona
- [ ] Botones disabled cuando corresponde
- [ ] Contador de página correcto

#### Crear Vehículo
- [ ] Click en "Nuevo Vehículo" abre el dialog
- [ ] Campo "Patente" está en mayúsculas
- [ ] Select "Propietario" muestra usuarios
- [ ] Select "Tipo de Vehículo" tiene opciones
- [ ] Select "Nivel de Acceso" tiene opciones
- [ ] Switch "Activo" funciona
- [ ] Validación funciona (patente requerida)
- [ ] Submit crea el vehículo
- [ ] Toast de éxito aparece
- [ ] Dialog se cierra
- [ ] Tabla se actualiza
- [ ] Estadísticas se actualizan

#### Editar Vehículo
- [ ] Click en editar abre el dialog
- [ ] Todos los campos se rellenan correctamente
- [ ] Propietario actual está seleccionado
- [ ] Modificar datos funciona
- [ ] Submit actualiza el vehículo
- [ ] Tabla muestra los cambios

#### Eliminar Vehículo
- [ ] Confirmación muestra la patente del vehículo
- [ ] Cancelar no elimina
- [ ] Aceptar elimina correctamente
- [ ] Tabla y estadísticas se actualizan

#### Estados Visuales
- [ ] Patente se muestra en fuente monospace y bold
- [ ] Badge "Tipo" es azul (sky)
- [ ] Badge "Activo" es verde (lime)
- [ ] Badge "Inactivo" es gris (zinc)
- [ ] Propietario muestra el nombre del usuario
- [ ] "-" aparece en campos opcionales vacíos

## 🎨 Testing Visual

### Responsividad
- [ ] Desktop (> 1024px): Todo visible en navbar
- [ ] Tablet (768px - 1024px): Sidebar funciona
- [ ] Mobile (< 768px): Sidebar y burger menu funcionan
- [ ] Tablas son scrollables en móvil

### Dark Mode
- [ ] Cards de estadísticas se ven bien
- [ ] Tablas tienen contraste correcto
- [ ] Badges son legibles
- [ ] Dialog se ve correctamente
- [ ] Borders son visibles

### Animaciones
- [ ] Dialog abre con animación suave
- [ ] Hover en botones muestra feedback
- [ ] Hover en filas de tabla resalta la fila
- [ ] Transiciones suaves en badges

## 🐛 Casos de Error a Probar

### Families
- [ ] Backend desconectado: Muestra error
- [ ] Familia sin nombre: Validación impide submit
- [ ] Familia duplicada: Backend rechaza y muestra error
- [ ] Network error: Toast de error aparece

### Vehicles
- [ ] Patente inválida (formato): Validación muestra error
- [ ] Patente duplicada: Backend rechaza
- [ ] Sin propietario: Permite (es opcional)
- [ ] Año inválido: Validación impide
- [ ] Network error: Toast de error

## 📊 Testing de Performance

### Tabla con Muchos Registros
- [ ] 100+ familias: Paginación funciona bien
- [ ] 100+ vehículos: Sin lag en búsqueda
- [ ] Ordenamiento es rápido
- [ ] Scroll suave

### Búsqueda en Tiempo Real
- [ ] Sin delay perceptible
- [ ] No causa re-renders innecesarios
- [ ] Resultados actualizan instantáneamente

## 🔄 Testing de Flujos Completos

### Flujo 1: Crear Familia Completa
1. [ ] Click "Nueva Familia"
2. [ ] Completar nombre: "Familia González"
3. [ ] Completar departamento: "101"
4. [ ] Completar descripción: "Familia de 4 personas"
5. [ ] Activar switch "Activo"
6. [ ] Submit
7. [ ] Verificar toast
8. [ ] Verificar que aparece en tabla
9. [ ] Verificar estadísticas actualizadas

### Flujo 2: Crear Vehículo con Propietario
1. [ ] Click "Nuevo Vehículo"
2. [ ] Ingresar patente: "ABC123"
3. [ ] Ingresar marca: "Toyota"
4. [ ] Ingresar modelo: "Corolla"
5. [ ] Seleccionar propietario
6. [ ] Ingresar color: "Blanco"
7. [ ] Ingresar año: 2020
8. [ ] Seleccionar tipo: "Auto"
9. [ ] Submit
10. [ ] Verificar en tabla

### Flujo 3: Editar y Buscar
1. [ ] Buscar "Toyota" en vehículos
2. [ ] Editar resultado encontrado
3. [ ] Cambiar marca a "Honda"
4. [ ] Submit
5. [ ] Buscar "Honda"
6. [ ] Verificar que ahora aparece

### Flujo 4: Ordenar y Paginar
1. [ ] Ir a familias
2. [ ] Click en "Nombre" para ordenar
3. [ ] Verificar orden alfabético
4. [ ] Click "Siguiente" hasta última página
5. [ ] Click "Anterior" para volver
6. [ ] Verificar que el orden se mantiene

## 📸 Screenshots Sugeridos

Para documentación:
- [ ] Vista completa de FamiliesView
- [ ] Vista completa de VehiclesView
- [ ] Dialog de crear familia
- [ ] Dialog de crear vehículo
- [ ] Tabla ordenada
- [ ] Resultados de búsqueda
- [ ] Vista mobile con sidebar
- [ ] Dark mode

## 🎯 Métricas de Éxito

### Performance
- [ ] Tiempo de carga < 1 segundo
- [ ] Búsqueda responde < 100ms
- [ ] Ordenamiento < 100ms
- [ ] Paginación instantánea

### UX
- [ ] 0 clicks para buscar (auto-focus)
- [ ] 2 clicks para crear (botón + submit)
- [ ] 2 clicks para editar (ícono + submit)
- [ ] 2 clicks para eliminar (ícono + confirmar)

### Bugs
- [ ] 0 errores de TypeScript
- [ ] 0 warnings de React
- [ ] 0 memory leaks
- [ ] 0 errores de consola

## 🔍 Testing con DevTools

### React DevTools
- [ ] Componentes se montan correctamente
- [ ] No re-renders innecesarios
- [ ] Props correctos en cada nivel

### Network Tab
- [ ] GET /api/families al cargar
- [ ] POST /api/families al crear
- [ ] PATCH /api/families/:id al editar
- [ ] DELETE /api/families/:id al eliminar
- [ ] Mismos endpoints para vehicles

### Console
- [ ] Sin errores
- [ ] Sin warnings
- [ ] Logs de TanStack Query (modo dev)

---

**Tip:** Usa `?debug=true` en la URL para ver logs de TanStack Query en consola.

**Ejemplo:** `http://localhost:5173/vehicles?debug=true`
