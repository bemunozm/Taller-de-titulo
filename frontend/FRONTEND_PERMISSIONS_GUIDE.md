# Guía de Protección de Frontend por Permisos

## 📋 Componentes Creados

### 1. **usePermissions Hook** (`hooks/usePermissions.ts`)
Hook personalizado que proporciona funciones para verificar permisos y roles del usuario autenticado.

**Funciones disponibles:**
- `hasPermission(permission: string)` - Verifica un permiso específico
- `hasAnyPermission(...permissions)` - Verifica si tiene AL MENOS UNO
- `hasAllPermissions(...permissions)` - Verifica si tiene TODOS
- `hasRole(roleName: string)` - Verifica un rol específico
- `hasAnyRole(...roleNames)` - Verifica si tiene AL MENOS UN rol
- `userPermissions` - Array con todos los permisos del usuario
- `user` - Datos completos del usuario

### 2. **Protected Component** (`components/auth/Protected.tsx`)
Componente para proteger elementos individuales de la UI (botones, secciones, etc.)

### 3. **ProtectedRoute Component** (`components/auth/ProtectedRoute.tsx`)
Componente para proteger rutas completas en el router

---

## 🚀 Ejemplos de Uso

### Uso Básico del Hook

```tsx
import { usePermissions } from '@/hooks/usePermissions'

function MyComponent() {
  const { hasPermission, hasRole, userPermissions } = usePermissions()
  
  // Verificar un permiso
  if (hasPermission('users.create')) {
    // Mostrar botón de crear
  }
  
  // Verificar múltiples permisos
  const canEdit = hasPermission('users.update')
  const canDelete = hasPermission('users.delete')
  
  // Verificar rol
  if (hasRole('Administrador')) {
    // Mostrar panel de admin
  }
  
  // Obtener todos los permisos
  console.log('Permisos del usuario:', userPermissions)
}
```

---

### Proteger Elementos de UI

#### Ejemplo 1: Proteger un botón

```tsx
import { Protected } from '@/components/auth/Protected'
import { Button } from '@/components/ui/Button'

function UsersView() {
  return (
    <div>
      <h1>Usuarios</h1>
      
      {/* Solo mostrar si tiene permiso users.create */}
      <Protected permission="users.create">
        <Button onClick={handleCreate}>
          Crear Usuario
        </Button>
      </Protected>
    </div>
  )
}
```

#### Ejemplo 2: Proteger sección completa

```tsx
import { Protected } from '@/components/auth/Protected'

function DashboardView() {
  return (
    <div>
      <h1>Dashboard</h1>
      
      {/* Solo mostrar estadísticas si tiene permiso admin.dashboard */}
      <Protected permission="admin.dashboard">
        <div className="stats">
          <StatCard title="Usuarios" value={100} />
          <StatCard title="Visitas" value={50} />
        </div>
      </Protected>
    </div>
  )
}
```

#### Ejemplo 3: Proteger con múltiples permisos (OR)

```tsx
import { Protected } from '@/components/auth/Protected'

function VisitsView() {
  return (
    <div>
      {/* Mostrar si tiene users.update O users.delete */}
      <Protected anyPermission={['users.update', 'users.delete']}>
        <ActionMenu />
      </Protected>
    </div>
  )
}
```

#### Ejemplo 4: Proteger con múltiples permisos (AND)

```tsx
import { Protected } from '@/components/auth/Protected'

function AdminPanel() {
  return (
    <div>
      {/* Mostrar solo si tiene TODOS estos permisos */}
      <Protected allPermissions={['admin.dashboard', 'admin.settings', 'admin.logs']}>
        <SuperAdminFeatures />
      </Protected>
    </div>
  )
}
```

#### Ejemplo 5: Proteger por rol

```tsx
import { Protected } from '@/components/auth/Protected'

function SettingsView() {
  return (
    <div>
      {/* Solo administradores pueden ver esto */}
      <Protected role="Administrador">
        <AdvancedSettings />
      </Protected>
      
      {/* Conserjes o Seguridad pueden ver esto */}
      <Protected anyRole={['Conserje', 'Seguridad']}>
        <AccessControlPanel />
      </Protected>
    </div>
  )
}
```

#### Ejemplo 6: Con fallback personalizado

```tsx
import { Protected } from '@/components/auth/Protected'
import { Alert } from '@/components/ui/Alert'

function UsersView() {
  return (
    <div>
      <Protected 
        permission="users.delete"
        fallback={
          <Alert variant="warning">
            No tienes permisos para eliminar usuarios
          </Alert>
        }
      >
        <DeleteUserButton />
      </Protected>
    </div>
  )
}
```

---

### Proteger Rutas Completas

#### Modificar `router.tsx`

```tsx
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rutas protegidas por permiso */}
        <Route 
          path="/users" 
          element={
            <ProtectedRoute permission="users.read">
              <UsersView />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/roles" 
          element={
            <ProtectedRoute permission="roles.read">
              <RolesView />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/families" 
          element={
            <ProtectedRoute permission="families.read">
              <FamiliesView />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/vehicles" 
          element={
            <ProtectedRoute permission="vehicles.read">
              <VehiclesView />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/visits" 
          element={
            <ProtectedRoute permission="visits.read">
              <VisitsView />
            </ProtectedRoute>
          } 
        />
        
        {/* Rutas protegidas por rol */}
        <Route 
          path="/settings" 
          element={
            <ProtectedRoute anyRole={['Administrador', 'Super Administrador']}>
              <SettingsView />
            </ProtectedRoute>
          } 
        />
        
        {/* Rutas protegidas con múltiples permisos */}
        <Route 
          path="/traceability" 
          element={
            <ProtectedRoute anyPermission={['detections.read', 'admin.reports']}>
              <TraceabilityView />
            </ProtectedRoute>
          } 
        />
        
        {/* Ruta específica para conserjes */}
        <Route 
          path="/digital-concierge" 
          element={
            <ProtectedRoute permission="digital-concierge.access">
              <DigitalConciergeView />
            </ProtectedRoute>
          } 
        />
        
        {/* Con redirección personalizada */}
        <Route 
          path="/admin" 
          element={
            <ProtectedRoute 
              role="Administrador"
              redirectTo="/auth/login"
            >
              <AdminPanel />
            </ProtectedRoute>
          } 
        />
      </Routes>
    </BrowserRouter>
  )
}
```

---

### Proteger Navegación (Sidebar/Navbar)

```tsx
import { Protected } from '@/components/auth/Protected'
import { SidebarItem } from '@/components/ui/Sidebar'

function AppSidebar() {
  return (
    <Sidebar>
      <SidebarBody>
        <SidebarSection>
          {/* Siempre visible */}
          <SidebarItem href="/">Inicio</SidebarItem>
          
          {/* Solo si tiene permiso */}
          <Protected permission="families.read">
            <SidebarItem href="/families">Familias</SidebarItem>
          </Protected>
          
          <Protected permission="vehicles.read">
            <SidebarItem href="/vehicles">Vehículos</SidebarItem>
          </Protected>
          
          <Protected permission="visits.read">
            <SidebarItem href="/visits">Visitas</SidebarItem>
          </Protected>
          
          <Protected permission="users.read">
            <SidebarItem href="/users">Usuarios</SidebarItem>
          </Protected>
          
          <Protected permission="roles.read">
            <SidebarItem href="/roles">Roles</SidebarItem>
          </Protected>
          
          <Protected permission="visits.validate-qr">
            <SidebarItem href="/qr-scanner">Escanear QR</SidebarItem>
          </Protected>
          
          <Protected permission="digital-concierge.access">
            <SidebarItem href="/digital-concierge">Conserje Digital</SidebarItem>
          </Protected>
          
          <Protected anyPermission={['cameras.read', 'streams.read']}>
            <SidebarItem href="/conserje">Cámaras - Conserje</SidebarItem>
          </Protected>
          
          <Protected permission="detections.read">
            <SidebarItem href="/traceability">Trazabilidad</SidebarItem>
          </Protected>
          
          <Protected anyRole={['Administrador', 'Super Administrador']}>
            <SidebarItem href="/settings">Configuraciones</SidebarItem>
          </Protected>
        </SidebarSection>
      </SidebarBody>
    </Sidebar>
  )
}
```

---

### Proteger Acciones en Tablas

```tsx
import { Protected } from '@/components/auth/Protected'
import { usePermissions } from '@/hooks/usePermissions'

function UsersTable({ users }: { users: User[] }) {
  const { hasPermission } = usePermissions()
  
  // Calcular si mostrar columna de acciones
  const showActions = hasPermission('users.update') || hasPermission('users.delete')
  
  return (
    <table>
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Email</th>
          {showActions && <th>Acciones</th>}
        </tr>
      </thead>
      <tbody>
        {users.map(user => (
          <tr key={user.id}>
            <td>{user.name}</td>
            <td>{user.email}</td>
            {showActions && (
              <td>
                <Protected permission="users.update">
                  <button onClick={() => handleEdit(user)}>
                    Editar
                  </button>
                </Protected>
                
                <Protected permission="users.delete">
                  <button onClick={() => handleDelete(user)}>
                    Eliminar
                  </button>
                </Protected>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

---

## 📝 Mapeo de Permisos por Vista

### Rutas Principales (✅ IMPLEMENTADAS)

| Ruta | Permiso Requerido | Descripción | Estado |
|------|------------------|-------------|---------|
| `/` | - | Dashboard (acceso general) | ✅ Acceso libre |
| `/families` | `families.read` | Ver familias | ✅ Protegida |
| `/vehicles` | `vehicles.read` | Ver vehículos | ✅ Protegida |
| `/visits` | `visits.read` | Ver visitas | ✅ Protegida |
| `/users` | `users.read` | Ver usuarios | ✅ Protegida |
| `/roles` | `roles.read` | Ver roles | ✅ Protegida |
| `/roles/create` | `roles.create` | Crear rol | ✅ Protegida |
| `/roles/edit/:id` | `roles.update` | Editar rol | ✅ Protegida |
| `/qr-scanner` | `visits.validate-qr` | Escanear QR de visitas | ✅ Protegida |
| `/digital-concierge` | `digital-concierge.access` | Conserje digital | ✅ Protegida |
| `/conserje` | `cameras.read` o `streams.read` | Ver cámaras | ✅ Protegida |
| `/traceability` | `detections.read` | Ver detecciones | ✅ Protegida |
| `/traceability/:id` | `detections.read` | Detalle de detección | ✅ Protegida |
| `/settings` | Rol: `Administrador` o `Super Administrador` | Configuraciones | ✅ Protegida |
| `/403` | - | Acceso prohibido | ✅ Pública |
| `/*` | - | Página no encontrada | ✅ Pública |

### Acciones Comunes

| Acción | Permiso | Vista |
|--------|---------|-------|
| Crear usuario | `users.create` | UsersView |
| Editar usuario | `users.update` | UsersView |
| Eliminar usuario | `users.delete` | UsersView |
| Crear rol | `roles.create` | RolesView |
| Asignar permisos | `roles.assign-permissions` | EditRoleView |
| Crear familia | `families.create` | FamiliesView |
| Agregar miembro | `families.add-member` | FamiliesView |
| Registrar vehículo | `vehicles.create` | VehiclesView |
| Crear visita | `visits.create` | VisitsView |
| Aprobar visita | `visits.approve` | VisitsView |
| Check-in visita | `visits.check-in` | QRScannerView |
| Habilitar LPR | `cameras.enable-ia` | CamerasPanel |

---

## 🎯 Mejores Prácticas

### 1. **Proteger Rutas Primero**
Siempre protege las rutas completas antes de los elementos individuales.

### 2. **Usar Permisos Específicos**
Preferir `permission="users.create"` sobre `role="Administrador"` para mayor granularidad.

### 3. **Combinar Estrategias**
Proteger rutas con `ProtectedRoute` Y elementos con `Protected` para doble seguridad.

### 4. **Ocultar Navegación**
Si el usuario no tiene acceso a una ruta, ocultar el link de navegación.

### 5. **UX Clara**
Usar `fallback` para informar al usuario por qué no ve algo.

### 6. **Validación Backend**
**IMPORTANTE**: La protección del frontend es para UX. El backend SIEMPRE debe validar permisos.

---

## ⚠️ Consideraciones de Seguridad

1. **Frontend NO es seguro**: La protección del frontend es solo para mejorar UX. Un usuario técnico puede saltársela.

2. **Backend es la fuente de verdad**: SIEMPRE valida permisos en el backend con guards y decorators.

3. **Doble validación**: Frontend oculta UI + Backend rechaza requests = Seguridad completa

4. **No confiar en localStorage**: Los permisos vienen del backend via API, no del token guardado localmente.

---

## 🔄 Actualización Automática

Los permisos se actualizan automáticamente cuando:
- El usuario hace login (nuevo JWT)
- Se recarga la página (nueva consulta a `/auth/user`)
- Se invalida el query `['user']` manualmente

Para forzar actualización:
```tsx
import { useQueryClient } from '@tanstack/react-query'

const queryClient = useQueryClient()
queryClient.invalidateQueries({ queryKey: ['user'] })
```

---

## ✅ Estado de Implementación

### ✅ Completado

- [x] **Hook usePermissions** - Lógica de validación de permisos
- [x] **Componente Protected** - Protección de elementos UI
- [x] **Componente ProtectedRoute** - Protección de rutas
- [x] **Rutas protegidas** - Todas las rutas del router con permisos
- [x] **Navegación protegida** - Navbar y Sidebar con permisos
- [x] **Vistas de error** - 403 (Forbidden) y 404 (Not Found)
- [x] **Redirección automática** - A `/403` cuando no tiene permisos

### 📋 Implementación en Router

**Rutas protegidas implementadas:**
```tsx
// Familias
<Route path="/families" element={
  <ProtectedRoute permission="families.read">
    <FamiliesView />
  </ProtectedRoute>
} />

// Usuarios
<Route path="/users" element={
  <ProtectedRoute permission="users.read">
    <UsersView />
  </ProtectedRoute>
} />

// Roles - CRUD completo
<Route path="/roles" element={
  <ProtectedRoute permission="roles.read">
    <RolesView />
  </ProtectedRoute>
} />
<Route path="/roles/create" element={
  <ProtectedRoute permission="roles.create">
    <CreateRoleView />
  </ProtectedRoute>
} />
<Route path="/roles/edit/:id" element={
  <ProtectedRoute permission="roles.update">
    <EditRoleView />
  </ProtectedRoute>
} />

// Configuraciones - Por rol
<Route path="/settings" element={
  <ProtectedRoute anyRole={['Administrador', 'Super Administrador']}>
    <SettingsView />
  </ProtectedRoute>
} />

// Conserje - Múltiples permisos (OR)
<Route path="/conserje" element={
  <ProtectedRoute anyPermission={['cameras.read', 'streams.read']}>
    <ConserjeView />
  </ProtectedRoute>
} />
```

**Navegación protegida implementada:**
```tsx
// Sidebar y Navbar
<Protected permission="families.read">
  <SidebarItem href="/families">Familias</SidebarItem>
</Protected>

<Protected permission="users.read">
  <NavbarItem href="/users">Usuarios</NavbarItem>
</Protected>

<Protected anyRole={['Administrador', 'Super Administrador']}>
  <SidebarItem href="/settings">Configuraciones</SidebarItem>
</Protected>
```

### 🎯 Próximos Pasos

1. **Proteger botones de acción** - En tablas y formularios
   - Botones "Crear", "Editar", "Eliminar"
   - Acciones contextuales en dropdowns
   - Tabs y secciones condicionales

2. **Mensajes de estado** - Feedback al usuario
   - Loading states mientras se cargan permisos
   - Mensajes cuando no tiene acceso a acciones específicas

3. **Testing** - Validar con diferentes roles
   - Probar flujos con rol Residente
   - Probar flujos con rol Conserje
   - Probar flujos con rol Administrador

---

## 🧪 Cómo Probar

### 1. Probar con diferentes roles

Crear usuarios de prueba con diferentes roles y verificar:
- Qué links aparecen en navegación
- Qué rutas son accesibles
- Qué acciones están disponibles

### 2. Verificar redirecciones

- Intentar acceder a `/users` sin permiso `users.read` → debe redirigir a `/403`
- Intentar acceder a ruta inexistente → debe mostrar página 404
- Acceder a ruta permitida → debe funcionar normalmente

### 3. Probar componente de debug

```tsx
import { PermissionsDebug } from '@/components/debug/PermissionsDebug'

// En cualquier vista
<PermissionsDebug />
```

Esto mostrará:
- Usuario actual
- Roles asignados
- Todos los permisos
- Pruebas de permisos específicos
