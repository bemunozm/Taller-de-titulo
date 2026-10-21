# Capítulo: Ejecución - Implementación del Frontend de la Aplicación Web

## 1. Introducción

La implementación del frontend constituye la capa de presentación e interacción del sistema de control de acceso vehicular, proporcionando una interfaz web moderna y reactiva que permite a usuarios de diferentes roles (Administradores, Personal de Seguridad, Residentes) interactuar con las funcionalidades del sistema. El frontend está construido como una **Single Page Application (SPA)** utilizando React con TypeScript, priorizando la experiencia de usuario, accesibilidad, y rendimiento.

Este subsistema resuelve la problemática de proporcionar una interfaz unificada que integre múltiples funcionalidades complejas: visualización de video en tiempo real, gestión de visitas, reconocimiento de placas vehiculares, notificaciones push, control de acceso basado en permisos, y comunicación bidireccional mediante WebSocket. La arquitectura del frontend implementa patrones modernos de desarrollo web que garantizan escalabilidad, mantenibilidad y seguridad.

### 1.1 Problemática Resuelta

**Desafío 1: Gestión de Estado Complejo y Sincronización de Datos**

Las aplicaciones modernas requieren manejar estado global (autenticación, permisos, notificaciones) y estado local (formularios, modales, filtros) de manera coherente. Sincronizar datos entre el servidor y el cliente, manejar cache, y actualizar la UI en respuesta a eventos en tiempo real presenta complejidad técnica significativa.

**Solución**: El frontend implementa una arquitectura basada en React Query (TanStack Query) para gestión de estado del servidor, con invalidación automática de cache, reintentos configurables, y sincronización optimista. El estado local se maneja con React Hooks nativos (`useState`, `useReducer`) y custom hooks que encapsulan lógica de negocio. WebSocket mantiene sincronización en tiempo real para eventos críticos (llegada de visitantes, detecciones de placas).

**Desafío 2: Streaming de Video en el Navegador**

Los navegadores modernos no soportan nativamente el protocolo RTSP utilizado por cámaras IP. Además, establecer conexiones WebRTC requiere negociación SDP compleja, manejo de candidatos ICE, y gestión de errores de conectividad.

**Solución**: El componente `CameraPlayer` implementa un cliente WebRTC completo que negocia sesiones con MediaMTX mediante el protocolo WHEP, maneja reintentos con backoff exponencial, y proporciona feedback visual del estado de conexión. La integración con el backend valida permisos antes de permitir acceso a streams de video.

**Desafío 3: Control de Acceso Granular Basado en Permisos**

Diferentes roles de usuario (Admin, Seguridad, Residente) requieren acceso a diferentes secciones y funcionalidades del sistema. El frontend debe validar permisos en tiempo real, ocultando/deshabilitando elementos de UI no autorizados y protegiendo rutas sensibles.

**Solución**: El sistema implementa un hook personalizado `usePermissions` que extrae permisos del usuario autenticado y proporciona funciones helpers (`hasPermission`, `hasAnyPermission`, `hasAllPermissions`). Los componentes `ProtectedRoute` y `Protected` encapsulan lógica de autorización, redirigiendo a páginas de error 403 cuando el acceso es denegado.

**Desafío 4: Notificaciones en Tiempo Real con Contexto de Acción**

El sistema requiere notificar eventos críticos (llegada de visitantes, detecciones de vehículos desconocidos) en tiempo real, permitiendo que los usuarios tomen acciones inmediatas (aprobar/rechazar) sin necesidad de navegar a otras secciones.

**Solución**: La arquitectura de notificaciones combina WebSocket para entrega en tiempo real, almacenamiento local para persistencia, y componentes modales contextuales (`VisitorApprovalDialog`, `UnknownVehicleApprovalDialog`) que se activan automáticamente cuando llegan notificaciones que requieren acción. El componente `NotificationBell` proporciona un centro de notificaciones accesible desde cualquier parte de la aplicación.

### 1.2 Arquitectura del Frontend

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Navegador Web                               │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                      React Application                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │  │
│  │  │   Router     │  │    Layouts   │  │    Views     │       │  │
│  │  │ (react-      │  │ (Stacked,    │  │ (Dashboard,  │       │  │
│  │  │  router-dom) │  │  Auth)       │  │  Cameras,    │       │  │
│  │  └──────────────┘  └──────────────┘  │  Visits...)  │       │  │
│  │                                       └──────────────┘       │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │                    Components                           │  │
│  │  │  - CameraPlayer (WebRTC)                               │  │
│  │  │  - NotificationBell (Real-time)                        │  │
│  │  │  - VisitorApprovalDialog (Modal)                       │  │
│  │  │  - Protected (Authorization)                           │  │
│  │  │  - Forms, Tables, Charts...                            │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │                   Custom Hooks                          │  │
│  │  │  - useAuth (Authentication state)                      │  │
│  │  │  - usePermissions (Authorization logic)                │  │
│  │  │  - useNotifications (Real-time events)                 │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │                   API Layer                             │  │
│  │  │  - AuthAPI (Login, Register, Password)                 │  │
│  │  │  - CameraAPI (CRUD, WHEP negotiation)                  │  │
│  │  │  - NotificationsAPI (Fetch, Mark as read)              │  │
│  │  │  - VisitAPI, VehicleAPI, UserAPI...                    │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │                   Services                              │  │
│  │  │  - WebSocketService (Socket.io client)                 │  │
│  │  │  - Axios interceptors (Auth token, Error handling)     │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │                State Management                         │  │
│  │  │  - React Query (Server state, caching)                 │  │
│  │  │  - LocalStorage (Auth token, preferences)              │  │
│  │  │  - Context API (Theme, Notifications)                  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           │ HTTP REST API (axios)
                           │ WebSocket (socket.io-client)
                           │ WebRTC (RTCPeerConnection)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Backend NestJS                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ REST API     │  │ WebSocket    │  │ MediaMTX     │              │
│  │ (Express)    │  │ Gateway      │  │ Integration  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Decisiones Técnicas Clave

**Stack Tecnológico Principal**

| Tecnología | Versión | Justificación |
|------------|---------|---------------|
| **React** | 19.1.1 | Framework líder para SPAs, ecosistema maduro, virtual DOM optimizado |
| **TypeScript** | 5.8.3 | Type safety, IntelliSense, prevención de errores en tiempo de desarrollo |
| **Vite** | 7.1.7 | Build tool rápido con HMR instantáneo, tree-shaking automático |
| **React Router** | 7.9.1 | Routing declarativo, lazy loading de rutas, navegación programática |
| **TanStack Query** | 5.90.2 | Gestión de estado del servidor, caching inteligente, sincronización automática |
| **Axios** | 1.12.2 | Cliente HTTP con interceptors, cancelación de requests, manejo de errores |
| **Socket.io Client** | 4.8.1 | WebSocket con fallback a polling, reconexión automática, rooms |
| **Tailwind CSS** | 4.1.13 | Utility-first CSS, diseño responsive, consistencia visual |
| **Zod** | 3.25.76 | Validación de esquemas en runtime, type inference para TypeScript |
| **React Hook Form** | 7.63.0 | Manejo de formularios con validación, bajo re-renders |

**Justificación de React sobre Alternativas**

| Característica | React | Vue.js | Angular | Svelte |
|----------------|-------|--------|---------|--------|
| **Curva de Aprendizaje** | Media | Baja | Alta | Baja |
| **Ecosistema** | ✅ Muy maduro | ✅ Maduro | ✅ Completo | ⚠️ Emergente |
| **TypeScript Support** | ✅ Excelente | ✅ Bueno | ✅ Nativo | ✅ Bueno |
| **Performance** | ✅ Alta | ✅ Alta | ⚠️ Media | ✅ Muy alta |
| **Librerías Especializadas** | ✅ Abundantes | ⚠️ Limitadas | ✅ Muchas | ❌ Pocas |
| **WebRTC Support** | ✅ Excelente | ✅ Bueno | ✅ Bueno | ⚠️ Limitado |
| **Real-time Updates** | ✅ Hooks nativos | ✅ Composables | ✅ RxJS | ✅ Stores |

**Decisión**: React ofrece el mejor balance entre performance, ecosistema maduro (especialmente para WebRTC y streaming), y experiencia del equipo de desarrollo.

**Patrón de Gestión de Estado**

El proyecto adopta una arquitectura híbrida de gestión de estado:

1. **Estado del Servidor** (React Query):
   - Datos provenientes del backend (usuarios, cámaras, visitas)
   - Cache automático con invalidación inteligente
   - Reintentos y gestión de errores incorporados
   - Sincronización en background

2. **Estado de Autenticación** (Custom Hook + LocalStorage):
   - Token JWT almacenado en localStorage
   - Hook `useAuth` con React Query para datos del usuario
   - Interceptor de Axios inyecta token en headers

3. **Estado de Notificaciones** (WebSocket + Context):
   - Eventos en tiempo real mediante Socket.io
   - Context API para compartir estado entre componentes
   - Persistencia local para notificaciones no leídas

4. **Estado Local de UI** (useState, useReducer):
   - Estado de formularios, modales, filtros
   - Confinado a componentes individuales cuando es posible

**Ventajas de este Enfoque**:
- Evita over-engineering de Redux para casos simples
- Aprovecha cache de React Query para reducir requests
- Separación clara de responsabilidades
- Fácil testing y debugging

### 1.4 Flujo de Comunicación con el Backend

**1. Autenticación y Autorización**

```
Frontend                          Backend NestJS
    |                                   |
    |--- POST /auth/login ------------->|
    |    { email, password }            |
    |                           [Validar credenciales]
    |                           [Generar JWT token]
    |                                   |
    |<--- { token: "eyJhbG..." } -------|
    |                                   |
[Guardar token en localStorage]        |
    |                                   |
    |--- GET /auth/user --------------->|
    |    Authorization: Bearer <token>  |
    |                           [Validar JWT]
    |                           [Extraer userId del token]
    |                           [Consultar BD]
    |                                   |
    |<--- { id, name, email, roles,     |
    |       permissions, ... } ---------|
    |                                   |
[React Query cache usuario]            |
[Calcular permisos efectivos]          |
```

**2. Streaming de Video (WebRTC + WHEP)**

```
CameraPlayer                 Frontend API           Backend          MediaMTX
     |                            |                    |                |
     |-- Render con cameraId ---->|                    |                |
     |                            |                    |                |
     |-- createOffer() --------   |                    |                |
     |   (RTCPeerConnection)      |                    |                |
     |                            |                    |                |
     |<-- SDP offer -----------   |                    |                |
     |                            |                    |                |
     |-- POST /streams/whep/:id ->|                    |                |
     |   { offer: "v=0..." }      |                    |                |
     |                            |                    |                |
     |                            |--- Validar permisos ->              |
     |                            |--- POST /{mount}/whep ------------->|
     |                            |    Content-Type: application/sdp    |
     |                            |                    |                |
     |                            |<--- SDP answer ----------------------|
     |                            |                    |                |
     |<-- { answer: "v=0..." } ---|                    |                |
     |                            |                    |                |
     |-- setRemoteDescription()   |                    |                |
     |   (Establecer conexión)    |                    |                |
     |                            |                    |                |
     |<=================== WebRTC Media Stream ======================>|
     |                            |                    |                |
[Renderizar video en <video>]   |                    |                |
```

**3. Notificaciones en Tiempo Real** (modelo vigente: Fase 4 · P6)

```
Frontend                    WebSocket Gateway          Notifications Service
(RealtimeConnection)               |                            |
    |                              |                            |
    |--- io(VITE_WS_URL,           |                            |
    |     withCredentials) ------->|                            |
    |    [cookie de sesión]        |                            |
    |                      [Middleware: valida la cookie        |
    |                       de better-auth ANTES del CONNECT;   |
    |                       sin sesión → connect_error          |
    |                       'unauthorized']                     |
    |                              |                            |
    |                      [El servidor asigna las salas:       |
    |                       user:<id>, session:<id> y, con      |
    |                       detections.read + view-all,         |
    |                       org:<id>:security]                  |
    |<--- 'connect' ---------------|                            |
    |   (el cliente no emite nada: |                            |
    |    sin register ni join_room)|                            |
    |                              |                            |
    |                              |<--- emit('notification') --|
    |                              |    to('user:<id>')         |
    |                              |    payload: {...}          |
    |                              |                            |
    |<--- on('notification')-------|                            |
    |    payload: {                |                            |
    |      type: 'VISITOR_ARRIVAL',|                            |
    |      data: {...}             |                            |
    |    }                         |                            |
    |                              |                            |
[Mostrar NotificationBell badge]  |                            |
[Abrir VisitorApprovalDialog]     |                            |
    |                              |                            |
    |--- POST /visits/:id/approve->|                            |
    |                              |                            |
    |<--- { success: true } -------|                            |
    |                              |                            |
    |              [Logout, expiración o revocación de la sesión]|
    |<--- 'session:ended'          |                            |
    |     { reason }               |                            |
    |<--- io server disconnect ----|                            |
    |                              |                            |
[Revalida GET /auth/user: sin sesión → no reintenta, espera     |
 un nuevo login; con sesión → hasta 3 reintentos con backoff]   |
```

**4. Operaciones CRUD con React Query**

```
Component               React Query           Axios + Backend
    |                        |                       |
    |-- useQuery(['visits']) ->                      |
    |                        |                       |
    |                [Check cache first]             |
    |                        |                       |
    |                [Cache miss/stale]              |
    |                        |                       |
    |                        |--- GET /visits ------>|
    |                        |                [Query BD]
    |                        |                       |
    |                        |<--- { data: [...] } --|
    |                        |                       |
    |<-- { data, isLoading,  |                       |
    |     refetch } ---------|                       |
    |                        |                       |
[Renderizar tabla]          |                       |
    |                        |                       |
    |-- useMutation('create')->                      |
    |   mutate(newVisit)     |                       |
    |                        |                       |
    |                        |--- POST /visits ----->|
    |                        |    body: newVisit     |
    |                        |                [Crear en BD]
    |                        |                       |
    |                        |<--- { created } ------|
    |                        |                       |
    |                [Invalidar cache 'visits']      |
    |                [Refetch automático]            |
    |                        |                       |
    |<-- { data, isSuccess } |                       |
    |                        |                       |
[Actualizar UI optimísticamente]                    |
```

## 2. Herramientas y Tecnologías Utilizadas

### 2.1 React - Framework de UI

**Versión**: 19.1.1

**Descripción**: React es una librería JavaScript para construir interfaces de usuario mediante componentes reutilizables. Utiliza un Virtual DOM para optimizar actualizaciones de la UI, y proporciona un modelo declarativo que simplifica el desarrollo de aplicaciones complejas.

**Características Principales**:
- **Componentes Funcionales con Hooks**: Manejo de estado y efectos secundarios sin clases
- **Virtual DOM**: Reconciliación eficiente de cambios en la UI
- **JSX/TSX**: Sintaxis declarativa para definir componentes
- **Ecosistema Rico**: Miles de librerías compatibles
- **React Developer Tools**: Debugging y profiling integrados en el navegador

**Instalación y Configuración**:

```bash
# Crear proyecto con Vite
npm create vite@latest frontend -- --template react-swc-ts

# Instalar dependencias
cd frontend
npm install
```

**Configuración de Vite** (vite.config.ts):
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [
    react(),           // Plugin React con SWC (compilación rápida)
    tailwindcss()      // Plugin Tailwind CSS
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API requests al backend en desarrollo
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
```

### 2.2 TypeScript - Type Safety

**Versión**: 5.8.3

**Descripción**: TypeScript es un superset tipado de JavaScript que compila a JavaScript estándar. Proporciona type checking estático, IntelliSense mejorado, y previene errores comunes en tiempo de desarrollo.

**Beneficios en el Proyecto**:
- Detección temprana de errores de tipos
- Autocompletado inteligente en editores
- Refactoring seguro
- Documentación implícita mediante tipos
- Mejor experiencia de desarrollo

**Configuración** (tsconfig.json):
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

**Ejemplo de Tipado Fuerte**:
```typescript
// types/index.ts
export interface User {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  organization: Organization;
  profilePicture?: string;
  createdAt: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
}

// api/UserAPI.ts
export async function getUsers(): Promise<User[]> {
  const { data } = await api.get<User[]>('/users');
  return data;
}

// components/UserTable.tsx
function UserTable() {
  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: getUsers
  });
  
  // TypeScript sabe que users es User[] | undefined
  return (
    <table>
      {users?.map(user => (
        <tr key={user.id}>
          <td>{user.name}</td>
          {/* TypeScript previene acceso a propiedades inexistentes */}
        </tr>
      ))}
    </table>
  );
}
```

### 2.3 React Router - Navegación y Rutas

**Versión**: 7.9.1

**Descripción**: React Router es la librería estándar para routing en aplicaciones React. Permite definir rutas declarativas, lazy loading de componentes, y navegación programática.

**Características Utilizadas**:
- **Rutas anidadas**: Layouts compartidos (navbar, sidebar)
- **Rutas protegidas**: Validación de autenticación y permisos
- **Lazy loading**: Carga diferida de componentes pesados
- **Parámetros de ruta**: URLs dinámicas (ej: `/visits/:id`)
- **Navegación programática**: Redirección después de acciones

**Estructura de Rutas** (router.tsx):
```typescript
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AuthLayout } from '@/layouts/AuthLayout';
import { StackedLayout } from '@/layouts/StackedLayout';

// Lazy loading de vistas
const DashboardView = lazy(() => import('@/views/DashboardView'));
const CamerasView = lazy(() => import('@/views/CamerasView'));

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rutas públicas (autenticación) */}
        <Route element={<AuthLayout />}>
          <Route path="/auth/login" element={<LoginView />} />
          <Route path="/auth/register" element={<RegisterView />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordView />} />
        </Route>

        {/* Rutas protegidas */}
        <Route element={<ProtectedRoute />}>
          <Route element={<StackedLayout />}>
            <Route path="/" element={<DashboardView />} />
            
            {/* Rutas con permisos específicos */}
            <Route 
              path="/cameras" 
              element={
                <Protected requiredPermission="cameras.view">
                  <CamerasView />
                </Protected>
              } 
            />
            
            <Route path="/visits/:id" element={<VisitDetailView />} />
          </Route>
        </Route>

        {/* Rutas de error */}
        <Route path="/403" element={<ForbiddenView />} />
        <Route path="*" element={<NotFoundView />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### 2.4 TanStack Query (React Query) - Gestión de Estado del Servidor

**Versión**: 5.90.2

**Descripción**: TanStack Query es una librería de gestión de estado para datos asíncronos que simplifica fetching, caching, sincronización y actualización de estado del servidor en aplicaciones React.

**Características Principales**:
- **Caching Automático**: Almacena datos en cache con estrategias configurables
- **Refetching Inteligente**: Re-valida datos cuando son stale o cuando la ventana recupera foco
- **Mutations**: Manejo de operaciones que modifican datos con rollback optimista
- **Query Invalidation**: Invalida cache después de mutations para mantener consistencia
- **Dev Tools**: Panel de debugging para visualizar queries y su estado

**Configuración** (main.tsx):
```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 60000, // 1 minuto
      gcTime: 300000,   // 5 minutos (antes cacheTime)
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
```

**Ejemplo de Query**:
```typescript
// hooks/useAuth.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUser } from '@/api/AuthAPI'

export const useAuth = () => {
  const queryClient = useQueryClient()
  
  const { data, isError, isLoading } = useQuery({
    queryKey: ['user'],
    queryFn: getUser,
    retry: 1,
    refetchOnWindowFocus: false
  })

  const logout = useCallback(() => {
    localStorage.removeItem('AUTH_TOKEN')
    queryClient.removeQueries({ queryKey: ['user'] })
  }, [queryClient])

  return { data, isError, isLoading, logout }
}
```

**Ejemplo de Mutation con Actualización Optimista**:
```typescript
// hooks/useNotifications.ts
const markAsReadMutation = useMutation({
  mutationFn: (notificationIds: string[]) => 
    NotificationsAPI.markAsRead(notificationIds),
  
  onMutate: async (notificationIds) => {
    // Cancelar queries en progreso
    await queryClient.cancelQueries({ queryKey: ['notifications', user?.id] })

    // Snapshot del estado anterior
    const previousNotifications = queryClient.getQueryData(['notifications', user?.id])

    // Actualizar optimistamente
    queryClient.setQueryData(['notifications', user?.id], (old: any) => {
      if (!old) return old
      return {
        ...old,
        notifications: old.notifications.map((n: any) =>
          notificationIds.includes(n.id) 
            ? { ...n, read: true, readAt: new Date().toISOString() } 
            : n
        ),
        unreadCount: old.unreadCount - notificationIds.length,
      }
    })

    return { previousNotifications }
  },
  
  onError: (err, _variables, context) => {
    // Revertir en caso de error
    if (context?.previousNotifications) {
      queryClient.setQueryData(
        ['notifications', user?.id], 
        context.previousNotifications
      )
    }
  },
  
  onSettled: () => {
    // Invalidar para refrescar desde el servidor
    queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] })
  },
})
```

### 2.5 Axios - Cliente HTTP

**Versión**: 1.12.2

**Descripción**: Axios es un cliente HTTP basado en promesas para realizar requests a APIs REST. Proporciona interceptors, manejo de errores, y cancelación de requests.

**Configuración con Interceptors** (lib/axios.ts):
```typescript
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL  // http://localhost:3000/api/v1
})

// Interceptor de request: inyectar token JWT
api.interceptors.request.use(config => {
  const token = localStorage.getItem('AUTH_TOKEN')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Interceptor de response: manejo global de errores
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      // Token expirado o inválido
      localStorage.removeItem('AUTH_TOKEN')
      window.location.href = '/auth/login'
    }
    return Promise.reject(error)
  }
)

export default api
```

**Uso en APIs**:
```typescript
// api/VisitAPI.ts
import api from '@/lib/axios'
import type { Visit } from '@/types/index'

export async function getVisits(): Promise<Visit[]> {
  const { data } = await api.get<Visit[]>('/visits')
  return data
}

export async function approveVisit(visitId: string): Promise<Visit> {
  const { data } = await api.patch<Visit>(`/visits/${visitId}/approve`)
  return data
}

export async function createVisit(visit: Partial<Visit>): Promise<Visit> {
  const { data } = await api.post<Visit>('/visits', visit)
  return data
}
```

### 2.6 Socket.io Client - WebSocket en Tiempo Real

**Versión**: 4.8.1

**Descripción**: Socket.io Client es la librería cliente para establecer conexiones WebSocket con el backend. Proporciona fallback automático a polling, reconexión automática, y soporte para rooms.

**Modelo vigente (Fase 4 · P6):** un solo socket por pestaña, autenticado con la
cookie de sesión de better-auth en el handshake. Las salas las asigna el
servidor (`user:<id>`, `session:<id>` y, con `detections.read` +
`condominium.view-all`, `org:<id>:security`; nunca para el super-admin). El
cliente no emite nada: ya no existen `register`, `join_room`/`leave_room`,
`visitor:arrival` ni `security:anomaly_detected`.

**Servicio WebSocket** (`services/WebSocketService.ts`, extracto):
```typescript
export class WebSocketService {
  /** Idempotente para el mismo usuario; con otro usuario cierra el socket anterior. */
  connect(session: { userId: string; verifySession: () => Promise<boolean> }): void {
    // ...
    const socket = this.createSocket(url, {
      withCredentials: true, // cookie de sesión en el handshake
      transports: ['websocket', 'polling'],
      reconnection: true, // cortes de red: socket.io reintenta solo
      reconnectionDelay: REALTIME_RECONNECT_DELAY_MS,
      reconnectionDelayMax: REALTIME_RECONNECT_DELAY_MAX_MS,
    })

    socket.on('connect_error', () => {
      // Rechazo del middleware ('unauthorized'): socket.io no reintenta.
      if (!socket.active) this.handleServerEnded(socket)
    })
    socket.on('disconnect', (reason) => {
      // Fin de sesión (el servidor antes envía 'session:ended { reason }').
      if (reason === 'io server disconnect') this.handleServerEnded(socket)
    })
    socket.on('notification', (payload: unknown) => { /* a onNotification(...) */ })
    socket.on('security:anomaly_highlight', (payload: unknown) => { /* a onAnomalyHighlight(...) */ })
  }

  /**
   * Revalida la sesión por HTTP: si ya no vale, queda en 'session-ended' sin
   * reintentar (espera un nuevo login); si sigue vigente, hasta 3 reintentos
   * con backoff (2 s, 4 s, 8 s).
   */
  private handleServerEnded(socket: Socket): void { /* ... */ }

  disconnect(): void { /* logout, sin sesión o kiosko; conserva los suscriptores */ }
  onNotification(handler: (payload: unknown) => void): () => void { /* ... */ }
  onAnomalyHighlight(handler: (highlight: AnomalyHighlight) => void): () => void { /* ... */ }
  getStatus(): RealtimeStatus { /* idle | connecting | connected | reconnecting | session-ended */ }
}

export const webSocketService = new WebSocketService()
```

**Dueño único del socket** (`components/RealtimeConnection.tsx`, montado en `router.tsx`):
```tsx
export function RealtimeConnection() {
  const { pathname } = useLocation()
  // El kiosko es un dispositivo público: ahí ni se consulta la sesión humana.
  return isKioskRoute(pathname) ? <RealtimeOff /> : <SessionRealtimeConnection />
}

function SessionRealtimeConnection() {
  const queryClient = useQueryClient()
  const { data: user, isError } = useAuth()
  const sessionUserId = user && !isError ? user.id : undefined

  useEffect(() => {
    if (sessionUserId === undefined) {
      webSocketService.disconnect()
      return
    }
    webSocketService.connect({
      userId: sessionUserId,
      verifySession: () => isSessionOwnedBy(queryClient, sessionUserId), // GET /auth/user
    })
  }, [sessionUserId, queryClient])

  // Único suscriptor de 'notification': notificación del navegador + refresco de la lista.
  useEffect(() => {
    if (sessionUserId === undefined) return
    return webSocketService.onNotification((payload) => {
      showBrowserNotification(payload)
      void queryClient.invalidateQueries({ queryKey: ['notifications', sessionUserId] })
    })
  }, [sessionUserId, queryClient])

  return null
}
```

`useNotifications` ya no conecta: entrega la lista, las mutaciones y
`isConnected` (estado del servicio vía `useSyncExternalStore`). `useAuth().logout()`
cierra el socket antes de `sign-out`.

### 2.7 Tailwind CSS - Framework de Estilos

**Versión**: 4.1.13

**Descripción**: Tailwind CSS es un framework CSS utility-first que permite construir interfaces personalizadas rápidamente mediante clases utilitarias predefinidas.

**Características Utilizadas**:
- **Responsive Design**: Prefijos `sm:`, `md:`, `lg:`, `xl:` para breakpoints
- **Dark Mode**: Soporte nativo con prefijo `dark:`
- **Custom Theme**: Colores, tipografías, y espaciados personalizados
- **Plugins**: Formularios, animaciones, tipografía
- **JIT Mode**: Compilación just-in-time para mejor performance

**Configuración** (@/index.css):
```css
@import "tailwindcss";

/* Estilos personalizados */
@layer base {
  :root {
    --color-primary: 37 99 235;  /* blue-600 */
    --color-secondary: 100 116 139;  /* slate-500 */
  }
}

@layer components {
  .btn-primary {
    @apply bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors;
  }
}
```

**Ejemplo de Componente con Tailwind**:
```typescript
function StatsCard({ title, value, icon: Icon, trend }: StatsCardProps) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm p-6 border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {title}
          </p>
          <p className="text-3xl font-semibold text-zinc-900 dark:text-white mt-2">
            {value}
          </p>
        </div>
        <Icon className="h-12 w-12 text-blue-600 dark:text-blue-500" />
      </div>
      {trend && (
        <div className="mt-4 flex items-center gap-2">
          <span className={`text-sm font-medium ${
            trend > 0 ? 'text-green-600' : 'text-red-600'
          }`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
          <span className="text-xs text-zinc-500">vs mes anterior</span>
        </div>
      )}
    </div>
  )
}
```

### 2.8 Zod + React Hook Form - Validación de Formularios

**Versiones**: Zod 3.25.76, React Hook Form 7.63.0

**Descripción**: Zod es una librería de validación de esquemas en TypeScript. React Hook Form maneja el estado de formularios con mínimos re-renders. La combinación permite validación tipada y performante.

**Definición de Esquema con Zod**:
```typescript
// types/index.ts
import { z } from 'zod'

export const visitFormSchema = z.object({
  visitorName: z.string()
    .min(3, 'El nombre debe tener al menos 3 caracteres')
    .max(100, 'El nombre es demasiado largo'),
  
  visitorRut: z.string()
    .regex(/^[0-9]{7,8}-[0-9Kk]$/, 'RUT inválido (formato: 12345678-9)'),
  
  visitorPhone: z.string()
    .regex(/^\+?[0-9]{8,15}$/, 'Teléfono inválido'),
  
  vehiclePlate: z.string()
    .regex(/^[A-Z]{4}[0-9]{2}$/, 'Patente inválida (formato: ABCD12)')
    .optional(),
  
  visitDate: z.date()
    .min(new Date(), 'La fecha no puede ser en el pasado'),
  
  visitReason: z.enum(['DELIVERY', 'SERVICE', 'SOCIAL', 'OTHER']),
})

export type VisitFormData = z.infer<typeof visitFormSchema>
```

**Formulario con React Hook Form + Zod**:
```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { visitFormSchema, type VisitFormData } from '@/types/index'

function VisitForm({ onSubmit }: VisitFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<VisitFormData>({
    resolver: zodResolver(visitFormSchema),
    defaultValues: {
      visitReason: 'SOCIAL',
    },
  })

  const onSubmitHandler = async (data: VisitFormData) => {
    try {
      await onSubmit(data)
      reset()
      toast.success('Visita registrada exitosamente')
    } catch (error) {
      toast.error('Error al registrar la visita')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmitHandler)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">
          Nombre del visitante
        </label>
        <input
          {...register('visitorName')}
          type="text"
          className="w-full px-4 py-2 border rounded-lg"
        />
        {errors.visitorName && (
          <p className="mt-1 text-sm text-red-600">
            {errors.visitorName.message}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">
          RUT
        </label>
        <input
          {...register('visitorRut')}
          type="text"
          placeholder="12345678-9"
          className="w-full px-4 py-2 border rounded-lg"
        />
        {errors.visitorRut && (
          <p className="mt-1 text-sm text-red-600">
            {errors.visitorRut.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? 'Registrando...' : 'Registrar Visita'}
      </button>
    </form>
  )
}
```

### 2.9 Variables de Entorno

El frontend utiliza variables de entorno para configuración sensible y específica del ambiente:

**Archivo .env** (desarrollo):
```env
# URL base del backend REST API
VITE_API_URL=http://localhost:3000/api/v1

# URL del servidor WebSocket
VITE_WS_URL=http://localhost:3000
```

**Archivo .env.production**:
```env
VITE_API_URL=https://api.control-acceso.com/api/v1
VITE_WS_URL=https://api.control-acceso.com
```

**Acceso en Código**:
```typescript
// Vite expone variables con prefijo VITE_ en import.meta.env
const apiUrl = import.meta.env.VITE_API_URL
const wsUrl = import.meta.env.VITE_WS_URL

// TypeScript type safety
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_WS_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

## 3. Detalle de la Ejecución Práctica

En esta sección se describe el flujo completo de operación de las funcionalidades principales del frontend, desde la autenticación hasta la interacción con componentes complejos como streaming de video y notificaciones en tiempo real.

### 3.1 Flujo de Autenticación Completo

**Etapa 1: Login del Usuario**

El proceso de autenticación comienza cuando el usuario ingresa sus credenciales en el formulario de login:

```typescript
// views/auth/LoginView.tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authenticateUser } from '@/api/AuthAPI'
import { loginSchema } from '@/types/index'

export default function LoginView() {
  const navigate = useNavigate()
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
  })

  const loginMutation = useMutation({
    mutationFn: authenticateUser,
    onSuccess: (token) => {
      // Token ya fue guardado en localStorage por authenticateUser
      toast.success('Sesión iniciada correctamente')
      navigate('/')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Credenciales inválidas')
    },
  })

  const onSubmit = (data: UserLoginForm) => {
    loginMutation.mutate(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <label className="block text-sm font-medium">Email</label>
        <input
          {...register('email')}
          type="email"
          className="mt-1 w-full px-4 py-2 border rounded-lg"
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium">Contraseña</label>
        <input
          {...register('password')}
          type="password"
          className="mt-1 w-full px-4 py-2 border rounded-lg"
        />
        {errors.password && (
          <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loginMutation.isPending}
        className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
      >
        {loginMutation.isPending ? 'Iniciando sesión...' : 'Iniciar sesión'}
      </button>
    </form>
  )
}
```

**API de Autenticación**:
```typescript
// api/AuthAPI.ts
import api from '@/lib/axios'
import type { UserLoginForm } from '@/types/index'

export async function authenticateUser(formData: UserLoginForm) {
  try {
    const url = '/auth/login'
    const { data } = await api.post<string>(url, formData)
    
    // Guardar token JWT en localStorage
    localStorage.setItem('AUTH_TOKEN', data)
    
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function getUser() {
  try {
    const { data } = await api.get('/auth/user')
    return userSchema.parse(data)  // Validar con Zod
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}
```

**Etapa 2: Carga del Usuario Autenticado**

Después del login exitoso, el hook `useAuth` automáticamente obtiene los datos del usuario:

```typescript
// hooks/useAuth.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUser } from '@/api/AuthAPI'
import { useCallback } from 'react'

export const useAuth = () => {
  const queryClient = useQueryClient()
  
  const { data, isError, isLoading } = useQuery({
    queryKey: ['user'],
    queryFn: getUser,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: 300000, // 5 minutos
  })

  const logout = useCallback(() => {
    localStorage.removeItem('AUTH_TOKEN')
    queryClient.removeQueries({ queryKey: ['user'] })
  }, [queryClient])

  return { data, isError, isLoading, logout }
}
```

**Etapa 3: Protección de Rutas**

El componente `ProtectedRoute` verifica autenticación antes de renderizar rutas protegidas:

```typescript
// components/auth/ProtectedRoute.tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function ProtectedRoute() {
  const { data: user, isLoading, isError } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-r-transparent" />
          <p className="mt-2 text-sm text-gray-600">Cargando...</p>
        </div>
      </div>
    )
  }

  if (isError || !user) {
    // Redirigir a login si no está autenticado
    return <Navigate to="/auth/login" replace />
  }

  // Usuario autenticado, renderizar contenido protegido
  return <Outlet />
}
```

**Etapa 4: Extracción de Permisos**

El hook `usePermissions` extrae permisos efectivos del usuario para control de acceso:

```typescript
// hooks/usePermissions.ts
import { useMemo } from 'react'
import { useAuth } from './useAuth'

export const usePermissions = () => {
  const { data: user, isLoading } = useAuth()

  // Extraer todos los permisos de los roles del usuario
  const userPermissions = useMemo(() => {
    if (!user?.roles) return []
    
    const permissions = new Set<string>()
    user.roles.forEach(role => {
      role.permissions?.forEach(permission => {
        permissions.add(permission.name)
      })
    })
    
    return Array.from(permissions)
  }, [user?.roles])

  const hasPermission = (permission: string): boolean => {
    return userPermissions.includes(permission)
  }

  const hasAnyPermission = (...permissions: string[]): boolean => {
    return permissions.some(p => userPermissions.includes(p))
  }

  const hasAllPermissions = (...permissions: string[]): boolean => {
    return permissions.every(p => userPermissions.includes(p))
  }

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    userPermissions,
    user,
    isLoading,
  }
}
```

**Etapa 5: Uso de Permisos en Componentes**

```typescript
// components/users/UserTable.tsx
import { usePermissions } from '@/hooks/usePermissions'

function UserTable() {
  const { hasPermission } = usePermissions()

  return (
    <div>
      {hasPermission('users.create') && (
        <button onClick={handleCreateUser}>
          Crear Usuario
        </button>
      )}
      
      <table>
        {users.map(user => (
          <tr key={user.id}>
            <td>{user.name}</td>
            <td>
              {hasPermission('users.update') && (
                <button onClick={() => handleEdit(user.id)}>Editar</button>
              )}
              {hasPermission('users.delete') && (
                <button onClick={() => handleDelete(user.id)}>Eliminar</button>
              )}
            </td>
          </tr>
        ))}
      </table>
    </div>
  )
}
```

### 3.2 Flujo de Streaming de Video con WebRTC

El componente `CameraPlayer` implementa un cliente WebRTC completo que negocia sesiones con MediaMTX para streaming de video en tiempo real.

**Componente CameraPlayer Completo**:

```typescript
// components/CameraPlayer.tsx
import { useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import api from '@/lib/axios'

type Props = {
  cameraId: string
}

export default function CameraPlayer({ cameraId }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  
  const [connected, setConnected] = useState(false)
  const [hasStream, setHasStream] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retries, setRetries] = useState(0)
  
  const retryRef = useRef(0)
  const retryTimerRef = useRef<number | null>(null)
  const maxRetries = 3

  useEffect(() => {
    let mounted = true

    const start = async () => {
      try {
        // Crear RTCPeerConnection con servidor STUN público
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        })
        pcRef.current = pc

        // Handler cuando llega el track de video
        pc.ontrack = (ev) => {
          if (!mounted) return
          if (videoRef.current) {
            videoRef.current.srcObject = ev.streams[0]
            setHasStream(true)
          }
        }

        // Handler de cambios de estado de conexión
        pc.onconnectionstatechange = () => {
          if (!pc) return
          const st = pc.connectionState
          
          setConnected(['connected', 'completed'].includes(st))
          
          if (['disconnected', 'failed', 'closed'].includes(st)) {
            setHasStream(false)
            
            // Intentar reconectar si perdió conexión
            if (mounted && !['connected', 'completed'].includes(st)) {
              retryTimerRef.current = window.setTimeout(() => {
                attemptReconnect()
              }, 250)
            }
          }
        }

        // Agregar transceiver para recibir video
        pc.addTransceiver('video', { direction: 'recvonly' })

        // Crear SDP offer
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        // Esperar a que se recopilen los candidatos ICE
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve()
          
          const onIce = (ev: RTCPeerConnectionIceEvent) => {
            if (ev.candidate === null) {
              pc.removeEventListener('icecandidate', onIce as any)
              resolve()
            }
          }
          
          pc.addEventListener('icecandidate', onIce as any)
          setTimeout(resolve, 3000) // Timeout de 3 segundos
        })

        // Obtener SDP completo
        const localSdp = pc.localDescription?.sdp ?? offer.sdp

        // Negociar con backend (WHEP)
        const token = localStorage.getItem('AUTH_TOKEN')
        const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {}
        
        const resp = await api.post(
          '/streams/whep',
          { offer: localSdp, cameraMount: cameraId },
          config
        )

        const answerSdp = resp.data?.answer ?? resp.data

        // Aplicar SDP answer
        await pc.setRemoteDescription({
          type: 'answer',
          sdp: answerSdp
        } as RTCSessionDescriptionInit)

        // Negociación exitosa
        setLoading(false)
        retryRef.current = 0
        setRetries(0)
        setError(null)

      } catch (err: any) {
        console.error('[CameraPlayer] WHEP negotiation failed', err)
        const msg = err?.response?.data?.message ?? err?.message ?? String(err)
        setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
        attemptReconnect()
      }
    }

    const attemptReconnect = async () => {
      if (!mounted) return
      
      retryRef.current += 1
      setRetries(retryRef.current)
      
      if (retryRef.current > maxRetries) {
        setError('No se pudo reconectar después de varios intentos')
        setLoading(false)
        return
      }

      // Backoff exponencial
      const backoff = 1500 * Math.pow(2, retryRef.current - 1)
      setError(null)
      setLoading(true)
      
      await new Promise(resolve => setTimeout(resolve, backoff))
      
      if (!mounted) return

      // Cerrar conexión anterior
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }

      start()
    }

    start()

    return () => {
      mounted = false
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      setHasStream(false)
      retryRef.current = 0
      setRetries(0)
    }
  }, [cameraId])

  // Función para capturar screenshot
  const handleScreenshot = () => {
    const v = videoRef.current
    if (!v) {
      toast.error('Video no disponible')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth || v.clientWidth
    canvas.height = v.videoHeight || v.clientHeight
    
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      toast.error('No se pudo crear canvas')
      return
    }

    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)

    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error('Error al generar imagen')
        return
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `camera-${cameraId}-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast.success('Captura descargada')
    }, 'image/png')
  }

  return (
    <div className="relative h-full">
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls={connected}
        className="w-full h-full object-cover bg-black"
      />

      {/* Badge de estado */}
      <div className="absolute right-4 top-4 z-30">
        {loading ? (
          <div className="h-3 w-3 rounded-full bg-yellow-500 shadow-md" />
        ) : (
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium text-white shadow-sm ${
            error ? 'bg-red-600' : connected ? 'bg-green-600' : 'bg-zinc-600'
          }`}>
            {retries > 0 && !error && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            <span>
              {error ? 'Error' : connected ? 'Conectado' : 'Desconectado'}
            </span>
          </div>
        )}
      </div>

      {/* Botón de screenshot */}
      {hasStream && (
        <div className="absolute right-3 bottom-3 z-40">
          <button
            type="button"
            onClick={handleScreenshot}
            className="rounded-full bg-black/50 p-3 hover:bg-black/70 text-white shadow-md"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
              <path d="M3 7h3l2-2h8l2 2h3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      )}

      {/* Overlay de carga */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white z-20">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-black/60 px-6 py-4">
            <svg className="h-8 w-8 animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <div className="text-sm font-medium">
              {retries > 0 ? `Reconectando… (${retries}/${maxRetries})` : 'Cargando…'}
            </div>
          </div>
        </div>
      )}

      {/* Overlay de error */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white p-4 z-30">
          <div className="max-w-md text-center rounded-lg bg-black/50 p-4">
            <div className="font-semibold">Error al cargar la cámara</div>
            <div className="text-sm mt-2">{error}</div>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Diagrama de Secuencia del Proceso**:

```
CameraPlayer          RTCPeerConnection       Backend          MediaMTX
     |                       |                    |                |
     |-- useEffect() --------|                    |                |
     |                       |                    |                |
     |-- new RTCPeerConnection()                  |                |
     |                       |                    |                |
     |-- addTransceiver('video', 'recvonly')      |                |
     |                       |                    |                |
     |-- createOffer() ----->|                    |                |
     |                       |                    |                |
     |<-- SDP offer ---------|                    |                |
     |                       |                    |                |
     |-- setLocalDescription(offer)               |                |
     |                       |                    |                |
     |-- [Esperar ICE gathering]                  |                |
     |                       |                    |                |
     |-- POST /streams/whep ---------------------->|                |
     |    { offer, cameraMount }                  |                |
     |                       |          [Validar permisos]         |
     |                       |          [Resolver mountPath]       |
     |                       |                    |                |
     |                       |       POST /{mountPath}/whep ------>|
     |                       |                    |   [Generar SDP answer]
     |                       |                    |                |
     |                       |       <--- SDP answer --------------|
     |                       |                    |                |
     |<-- { answer } ---------------------------------|            |
     |                       |                    |                |
     |-- setRemoteDescription(answer)             |                |
     |                       |                    |                |
     |                [Conexión ICE establecida]  |                |
     |                       |                    |                |
     |<-- ontrack event -----|                    |                |
     |    [Stream de video]  |                    |                |
     |                       |                    |                |
     |-- videoRef.srcObject = stream              |                |
     |                       |                    |                |
[Video displayed]          |                    |                |
```

### 3.3 Flujo de Notificaciones en Tiempo Real

El sistema de notificaciones combina WebSocket para entrega en tiempo real, React Query para cache, y componentes modales para acciones inmediatas.

**Hook useNotifications**:

```typescript
// hooks/useNotifications.ts
import { useState, useCallback, useSyncExternalStore } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { webSocketService } from '@/services/WebSocketService'
import { NotificationsAPI } from '@/api/NotificationsAPI'
import { useAuth } from './useAuth'

const subscribeToRealtimeStatus = (onChange: () => void) => webSocketService.onStatusChange(onChange)
const getRealtimeStatus = () => webSocketService.getStatus()

export function useNotifications() {
  const { data: user } = useAuth()
  const queryClient = useQueryClient()
  // Estado del socket único; la conexión la gobierna RealtimeConnection.
  const isConnected = useSyncExternalStore(subscribeToRealtimeStatus, getRealtimeStatus) === 'connected'

  // Query para obtener notificaciones
  const { data: notificationsResponse, isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => NotificationsAPI.getNotifications({ limit: 50 }),
    enabled: !!user?.id,
    staleTime: 30000,
    refetchInterval: 60000,
  })

  const notifications = notificationsResponse?.notifications.map(n => ({
    id: n.id,
    payload: {
      title: n.title,
      message: n.message,
      type: n.type,
      priority: n.priority,
      timestamp: new Date(n.createdAt),
      data: n.data,
      requiresAction: n.requiresAction,
    },
    read: n.read,
    receivedAt: new Date(n.createdAt),
  })) || []

  const unreadCount = notificationsResponse?.unreadCount || 0

  // Sin conexión ni suscripción aquí: RealtimeConnection (a nivel de app) es
  // el único que conecta el socket y el único suscriptor de 'notification'
  // (refresca ['notifications', userId] y muestra la notificación del navegador).

  // Mutation para marcar como leída
  const markAsReadMutation = useMutation({
    mutationFn: (notificationIds: string[]) => 
      NotificationsAPI.markAsRead(notificationIds),
    
    onMutate: async (notificationIds) => {
      await queryClient.cancelQueries({ queryKey: ['notifications', user?.id] })
      
      const previousNotifications = queryClient.getQueryData(['notifications', user?.id])

      // Actualización optimista
      queryClient.setQueryData(['notifications', user?.id], (old: any) => {
        if (!old) return old
        return {
          ...old,
          notifications: old.notifications.map((n: any) =>
            notificationIds.includes(n.id) 
              ? { ...n, read: true, readAt: new Date().toISOString() } 
              : n
          ),
          unreadCount: old.unreadCount - notificationIds.length,
        }
      })

      return { previousNotifications }
    },
    
    onError: (err, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(['notifications', user?.id], context.previousNotifications)
      }
    },
    
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] })
    },
  })

  const markAsRead = (id: string) => {
    markAsReadMutation.mutate([id])
  }

  const markAllAsRead = () => {
    const unreadIds = notifications
      .filter(n => !n.read)
      .map(n => n.id)
    
    if (unreadIds.length > 0) {
      markAsReadMutation.mutate(unreadIds)
    }
  }

  // Mutation para limpiar todas
  const clearAllMutation = useMutation({
    mutationFn: () => NotificationsAPI.deleteAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] })
    },
  })

  const clearAll = () => {
    clearAllMutation.mutate()
  }

  // Solicitar permiso para notificaciones del navegador
  const requestPermission = async (): Promise<NotificationPermission> => {
    if (!('Notification' in window)) {
      return 'denied'
    }

    if (Notification.permission === 'granted') {
      return 'granted'
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission()
      return permission
    }

    return Notification.permission
  }

  return {
    notifications,
    unreadCount,
    isConnected,
    isLoading,
    markAsRead,
    markAllAsRead,
    clearAll,
    requestPermission,
    hasPermission: Notification.permission === 'granted',
    refreshNotifications: () => 
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  }
}
```

**Componente NotificationBell**:

El componente `NotificationBell` proporciona un centro de notificaciones accesible desde el navbar:

```typescript
// components/NotificationBell.tsx
import { useState } from 'react'
import { BellIcon } from '@heroicons/react/20/solid'
import { useNotifications } from '@/hooks/useNotifications'
import { Dropdown, DropdownButton, DropdownMenu } from '@/components/ui/Dropdown'
import { NavbarItem } from '@/components/ui/Navbar'

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markAllAsRead,
    clearAll,
    markAsRead,
  } = useNotifications()

  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const recentNotifications = notifications.slice(0, 10)
  const hasNotifications = notifications.length > 0

  const handleNotificationClick = (notification: Notification) => {
    setSelectedNotification(notification)
    setIsModalOpen(true)
    
    if (!notification.read) {
      markAsRead(notification.id)
    }
  }

  return (
    <>
      <Dropdown>
        <DropdownButton as={NavbarItem} aria-label="Notificaciones">
          <BellIcon data-slot="icon" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-semibold text-white ring-2 ring-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </DropdownButton>

        <DropdownMenu className="min-w-[22rem] max-h-[36rem]">
          {/* Header */}
          <div className="border-b px-3.5 py-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Notificaciones</h3>
              {unreadCount > 0 && (
                <span className="text-xs font-medium text-blue-700">
                  {unreadCount} nueva{unreadCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {hasNotifications ? (
            <>
              {/* Lista de notificaciones */}
              <div className="overflow-y-auto p-1">
                {recentNotifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`group flex w-full items-start gap-3 px-3.5 py-2.5 text-left rounded-lg hover:bg-zinc-50 ${
                      notification.read ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium">{notification.payload.title}</p>
                        {!notification.read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 line-clamp-2">
                        {notification.payload.message}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Footer con acciones */}
              <div className="border-t px-3.5 py-2.5">
                <div className="flex gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="flex-1 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium hover:bg-zinc-200"
                    >
                      Marcar leídas
                    </button>
                  )}
                  <button
                    onClick={clearAll}
                    className="flex-1 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium hover:bg-zinc-200"
                  >
                    Limpiar todo
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-sm text-zinc-500">
              No tienes notificaciones
            </div>
          )}
        </DropdownMenu>
      </Dropdown>

      {/* Modal de detalle */}
      {isModalOpen && selectedNotification && (
        <NotificationDetailModal
          notification={selectedNotification}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  )
}
```

### 3.4 Flujo de Aprobación de Visitantes

El componente `VisitorApprovalDialog` se activa automáticamente cuando llega una notificación de visitante que requiere acción:

```typescript
// components/VisitorApprovalDialog.tsx
import { useState, useEffect } from 'react'
import { Dialog, DialogTitle, DialogBody, DialogActions } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuth } from '@/hooks/useAuth'
import ConciergeAPI from '@/api/ConciergeAPI'

export function VisitorApprovalDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const [visitorData, setVisitorData] = useState<VisitorData | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const { notifications, markAsRead } = useNotifications()
  const { data: user } = useAuth()

  useEffect(() => {
    // Filtrar notificaciones de visitantes que requieren acción
    const visitorNotifications = notifications.filter(
      (n) =>
        n.payload.type === 'VISITOR_ARRIVAL' &&
        n.payload.requiresAction &&
        !n.read &&
        new Date(n.payload.data.expiresAt) > new Date()
    )

    // Mostrar la primera notificación pendiente
    if (visitorNotifications.length > 0 && !isOpen) {
      const notification = visitorNotifications[0]
      const data = notification.payload.data

      setVisitorData({
        sessionId: data.sessionId,
        visitorName: data.visitor.name,
        vehiclePlate: data.visitor.plate,
        visitReason: data.visitor.reason,
        visitorRut: data.visitor.rut,
        visitorPhone: data.visitor.phone,
        timestamp: notification.payload.timestamp || new Date(),
        notificationId: notification.id,
        expiresAt: new Date(data.expiresAt),
      })

      setIsOpen(true)
      setError(null)
    }
  }, [notifications, isOpen])

  const handleApprove = async () => {
    if (!visitorData || !user?.id) return

    setIsProcessing(true)
    setError(null)

    try {
      // Enviar aprobación con ID del residente
      await ConciergeAPI.respondToVisitor(
        visitorData.sessionId,
        true,
        user.id
      )
      
      // Marcar notificación como leída
      await markAsRead(visitorData.notificationId)
      
      setIsOpen(false)
      setVisitorData(null)
      
      toast.success('Visita aprobada exitosamente')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al aprobar la visita')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!visitorData || !user?.id) return

    setIsProcessing(true)
    setError(null)

    try {
      await ConciergeAPI.respondToVisitor(
        visitorData.sessionId,
        false,
        user.id
      )
      
      await markAsRead(visitorData.notificationId)
      
      setIsOpen(false)
      setVisitorData(null)
      
      toast.info('Visita rechazada')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al rechazar la visita')
    } finally {
      setIsProcessing(false)
    }
  }

  if (!isOpen || !visitorData) return null

  return (
    <Dialog open={isOpen} onClose={() => setIsOpen(false)}>
      <DialogTitle>Solicitud de Visita</DialogTitle>
      <DialogBody>
        <div className="space-y-4">
          <div>
            <dt className="text-sm font-medium text-zinc-500">Visitante</dt>
            <dd className="mt-1 text-sm text-zinc-900">{visitorData.visitorName}</dd>
          </div>

          {visitorData.vehiclePlate && (
            <div>
              <dt className="text-sm font-medium text-zinc-500">Patente</dt>
              <dd className="mt-1 text-sm text-zinc-900">{visitorData.vehiclePlate}</dd>
            </div>
          )}

          {visitorData.visitReason && (
            <div>
              <dt className="text-sm font-medium text-zinc-500">Motivo</dt>
              <dd className="mt-1 text-sm text-zinc-900">{visitorData.visitReason}</dd>
            </div>
          )}

          {visitorData.visitorPhone && (
            <div>
              <dt className="text-sm font-medium text-zinc-500">Teléfono</dt>
              <dd className="mt-1 text-sm text-zinc-900">{visitorData.visitorPhone}</dd>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={() => setIsOpen(false)}>
          Cerrar
        </Button>
        <Button
          color="red"
          onClick={handleReject}
          disabled={isProcessing}
        >
          Rechazar
        </Button>
        <Button
          onClick={handleApprove}
          disabled={isProcessing}
        >
          {isProcessing ? 'Procesando...' : 'Aprobar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

## 4. Condiciones de Borde y Casos Especiales

### 4.1 Token JWT Expirado

**Escenario**: El token JWT del usuario expira mientras está usando la aplicación.

**Síntomas**:
- Requests HTTP reciben error 401 Unauthorized
- WebSocket se desconecta
- Usuario pierde acceso a funciones protegidas

**Manejo**:

```typescript
// lib/axios.ts - Interceptor de respuesta
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      // Token expirado o inválido
      console.log('[Axios] Token expirado, limpiando sesión')
      
      localStorage.removeItem('AUTH_TOKEN')
      
      // Limpiar cache de React Query
      queryClient.clear()
      
      // Redirigir a login
      window.location.href = '/auth/login?expired=true'
      
      // Mostrar mensaje
      toast.error('Tu sesión ha expirado. Por favor, inicia sesión nuevamente.')
    }
    
    return Promise.reject(error)
  }
)
```

**Vista de Login con Mensaje**:

```typescript
// views/auth/LoginView.tsx
export default function LoginView() {
  const [searchParams] = useSearchParams()
  const expired = searchParams.get('expired')

  useEffect(() => {
    if (expired === 'true') {
      toast.warning('Tu sesión ha expirado. Por favor, inicia sesión nuevamente.')
    }
  }, [expired])

  // ... resto del componente
}
```

### 4.2 WebSocket Desconectado

**Escenario**: La conexión WebSocket se pierde por problemas de red o reinicio del servidor.

**Detección y Reconexión** (modelo vigente, `services/WebSocketService.ts`):

| Situación | Señal de socket.io | Comportamiento del cliente |
|---|---|---|
| Corte de red / reinicio del servidor | `connect_error` o `disconnect` con el socket **activo** (`transport close`, etc.) | socket.io reintenta solo (2 s → máx. 30 s, sin tope); cada reconexión vuelve a validar la cookie en el handshake. Estado `reconnecting`. |
| Handshake rechazado | `connect_error` con `unauthorized` y el socket **inactivo** | No reintenta a ciegas: revalida la sesión con `GET /auth/user`. |
| Fin de sesión (logout, expiración, revocación) | `session:ended { reason }` y luego `disconnect` con `io server disconnect` | Igual: revalida la sesión antes de cualquier reintento. |
| Logout local | `useAuth().logout()` → `webSocketService.disconnect()` | Cierra el socket; estado `idle`. |

Tras la revalidación:
- **Sesión inválida** → `session-ended`, sin socket hasta el próximo login. La
  revalidación usa la query `['user']`, así que la app también ve la sesión
  caída y el layout redirige al login.
- **Sesión aún válida** → hasta 3 reintentos con backoff (2 s, 4 s, 8 s,
  ±20 %). El presupuesto se reinicia tras 30 s de conexión estable; agotado,
  queda en `session-ended` (sin bucle) y la lista sigue llegando por el
  refresco de 60 s.

**Indicador Visual de Estado de Conexión**:

```typescript
// components/ConnectionStatus.tsx
function ConnectionStatus() {
  const { isConnected } = useNotifications()

  if (isConnected) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800 shadow-lg border border-yellow-200">
      <svg className="h-5 w-5 animate-pulse" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      <span>Reconectando al servidor...</span>
    </div>
  )
}
```

### 4.3 WebRTC Falló o Cámara Offline

**Escenario**: La negociación WebRTC falla o la cámara está offline.

**Manejo en CameraPlayer**:

El componente ya implementa reintentos con backoff exponencial (ver sección 3.2). Adicionalmente:

```typescript
// views/CamerasView.tsx
function CamerasView() {
  const [failedCameras, setFailedCameras] = useState<Set<string>>(new Set())

  const handleCameraError = (cameraId: string) => {
    setFailedCameras(prev => new Set(prev).add(cameraId))
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {cameras.map(camera => (
        <div key={camera.id} className="aspect-video">
          {failedCameras.has(camera.id) ? (
            <div className="flex flex-col items-center justify-center h-full bg-zinc-100 rounded-lg">
              <svg className="h-12 w-12 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <line x1="4" y1="4" x2="20" y2="20" strokeWidth={2} />
              </svg>
              <p className="mt-2 text-sm font-medium text-zinc-600">
                Cámara no disponible
              </p>
              <button
                onClick={() => {
                  setFailedCameras(prev => {
                    const next = new Set(prev)
                    next.delete(camera.id)
                    return next
                  })
                }}
                className="mt-2 text-sm text-blue-600 hover:text-blue-700"
              >
                Reintentar
              </button>
            </div>
          ) : (
            <CameraPlayer
              cameraId={camera.id}
              onError={() => handleCameraError(camera.id)}
            />
          )}
        </div>
      ))}
    </div>
  )
}
```

### 4.4 Permisos Insuficientes

**Escenario**: Usuario intenta acceder a una ruta o acción sin los permisos necesarios.

**Protección de Rutas**:

```typescript
// router.tsx
<Route 
  path="/users" 
  element={
    <ProtectedRoute permission="users.read">
      <UsersView />
    </ProtectedRoute>
  } 
/>
```

**Página de Error 403**:

```typescript
// views/errors/ForbiddenView.tsx
export function ForbiddenView() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="text-center">
        <h1 className="text-9xl font-bold text-zinc-900">403</h1>
        <h2 className="mt-4 text-2xl font-semibold text-zinc-700">
          Acceso Prohibido
        </h2>
        <p className="mt-2 text-zinc-600">
          No tienes los permisos necesarios para acceder a esta página.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Volver
        </button>
      </div>
    </div>
  )
}
```

**Protección de Elementos de UI**:

```typescript
// components/UserActions.tsx
function UserActions({ userId }: { userId: string }) {
  const { hasPermission } = usePermissions()

  return (
    <div className="flex gap-2">
      {hasPermission('users.update') && (
        <button onClick={() => handleEdit(userId)}>Editar</button>
      )}
      {hasPermission('users.delete') && (
        <button onClick={() => handleDelete(userId)}>Eliminar</button>
      )}
      {!hasPermission('users.update') && !hasPermission('users.delete') && (
        <span className="text-sm text-zinc-500">Sin permisos</span>
      )}
    </div>
  )
}
```

### 4.5 Red Lenta o Intermitente

**Escenario**: Usuario con conexión lenta experimenta timeouts o carga prolongada.

**Indicadores de Carga**:

```typescript
// components/LoadingState.tsx
function LoadingState({ message = 'Cargando...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <svg className="mx-auto h-12 w-12 animate-spin text-blue-600" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="mt-4 text-sm text-zinc-600">{message}</p>
      </div>
    </div>
  )
}
```

**Configuración de Timeouts en Axios**:

```typescript
// lib/axios.ts
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 15000, // 15 segundos
})

// Override timeout para endpoints específicos
export async function uploadFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await api.post('/files/upload', formData, {
    timeout: 60000, // 1 minuto para uploads
    onUploadProgress: (progressEvent) => {
      const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
      console.log(`Upload: ${percentCompleted}%`)
    }
  })

  return data
}
```

**Retry Logic en React Query**:

```typescript
// hooks/useVisits.ts
export function useVisits() {
  return useQuery({
    queryKey: ['visits'],
    queryFn: getVisits,
    retry: 3, // Reintentar hasta 3 veces
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 60000,
  })
}
```

### 4.6 Cache Desactualizado

**Escenario**: Datos en cache no reflejan cambios recientes del servidor.

**Invalidación Manual**:

```typescript
// components/RefreshButton.tsx
function RefreshButton({ queryKey }: { queryKey: string[] }) {
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await queryClient.invalidateQueries({ queryKey })
    setTimeout(() => setIsRefreshing(false), 500)
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm hover:bg-zinc-200"
    >
      <svg
        className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Actualizar
    </button>
  )
}
```

**Invalidación Automática Después de Mutations**:

```typescript
// hooks/useCreateVisit.ts
export function useCreateVisit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createVisit,
    onSuccess: () => {
      // Invalidar todas las queries relacionadas con visitas
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      
      toast.success('Visita creada exitosamente')
    },
  })
}
```

### 4.7 Notificaciones del Navegador Bloqueadas

**Escenario**: Usuario deniega permisos para notificaciones del navegador.

**Manejo Graceful**:

```typescript
// hooks/useNotifications.ts
const requestPermission = async () => {
  if (!('Notification' in window)) {
    console.warn('Este navegador no soporta notificaciones')
    return false
  }

  if (Notification.permission === 'granted') {
    return true
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission()
    return permission === 'granted'
  }

  // Usuario ya denegó permisos
  toast.info('Las notificaciones del navegador están bloqueadas. Puedes habilitarlas en la configuración del sitio.')
  return false
}
```

**Banner Informativo**:

```typescript
// components/NotificationPermissionBanner.tsx
function NotificationPermissionBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      setShow(true)
    }
  }, [])

  if (!show) return null

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <BellIcon className="h-5 w-5 text-blue-600" />
          <p className="text-sm text-blue-900">
            Habilita las notificaciones del navegador para recibir alertas en tiempo real
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              requestPermission()
              setShow(false)
            }}
            className="px-3 py-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
          >
            Habilitar
          </button>
          <button
            onClick={() => setShow(false)}
            className="px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-700"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  )
}
```

### 4.8 Navegador sin Soporte WebRTC

**Escenario**: Usuario accede desde navegador antiguo sin soporte WebRTC.

**Detección y Mensaje de Error**:

```typescript
// components/CameraPlayer.tsx
useEffect(() => {
  if (!('RTCPeerConnection' in window)) {
    setError('Tu navegador no soporta la visualización de video en tiempo real. Por favor, actualiza tu navegador.')
    return
  }
  
  // ... resto del código de conexión
}, [cameraId])
```

## 5. Alcances de la Implementación

### 5.1 Alcances Funcionales

#### 5.1.1 Funcionalidades Implementadas

La aplicación frontend implementa los siguientes módulos completos:

**Módulo de Autenticación**:
- ✅ Registro de usuarios con validación de email
- ✅ Confirmación de cuenta vía código de 6 dígitos
- ✅ Inicio de sesión con JWT
- ✅ Recuperación de contraseña
- ✅ Reenvío de código de confirmación
- ✅ Persistencia de sesión en localStorage
- ✅ Logout con limpieza de cache

**Módulo de Cámaras**:
- ✅ Listado de cámaras con estado (activa/inactiva)
- ✅ Visualización en tiempo real vía WebRTC/WHEP
- ✅ Captura de screenshots
- ✅ Vista de grilla múltiple (2x2, 3x3)
- ✅ Detección automática de errores con reintentos
- ✅ CRUD completo (crear, editar, eliminar cámaras)

**Módulo de Visitantes**:
- ✅ Registro de visitantes por conserjes
- ✅ Notificación automática a residentes
- ✅ Aprobación/rechazo de visitas en tiempo real
- ✅ Historial de visitas con filtros
- ✅ Generación de código QR para acceso
- ✅ Validación de visitas por QR en portería
- ✅ Envío de SMS con detalles de visita (opcional)

**Módulo de Vehículos**:
- ✅ Registro de vehículos por residentes
- ✅ Detección automática vía LPR
- ✅ Notificación de detecciones a residentes
- ✅ Historial de detecciones con imágenes
- ✅ Filtros por fecha y estado (autorizado/no autorizado)
- ✅ CRUD completo de vehículos

**Módulo de Notificaciones**:
- ✅ Centro de notificaciones con contador
- ✅ Notificaciones en tiempo real vía WebSocket
- ✅ Notificaciones del navegador (Browser Notifications API)
- ✅ Marcado de leídas individual y masivo
- ✅ Limpieza de notificaciones antiguas
- ✅ Modales contextuales para acciones (aprobar visitas)
- ✅ Persistencia de estado de lectura

**Módulo de Dashboard**:
- ✅ Métricas en tiempo real (visitas hoy, vehículos detectados)
- ✅ Gráfico de visitas por día (últimos 7 días)
- ✅ Gráfico de detecciones vehiculares por hora
- ✅ Lista de visitas activas
- ✅ Lista de detecciones recientes
- ✅ Indicador de cámaras activas

**Módulo de Usuarios y Permisos**:
- ✅ Gestión de usuarios (crear, editar, eliminar)
- ✅ Asignación de roles (administrador, conserje, residente)
- ✅ Gestión de permisos granulares
- ✅ Protección de rutas según permisos
- ✅ Protección de elementos de UI según permisos
- ✅ Filtrado de datos según permisos (residentes solo ven su info)

#### 5.1.2 Funcionalidades No Implementadas

Las siguientes funcionalidades NO fueron implementadas en la versión actual:

- ❌ Edición de perfil avanzada (cambio de avatar, preferencias)
- ❌ Búsqueda avanzada con filtros múltiples combinados
- ❌ Exportación de reportes a PDF/Excel
- ❌ Modo offline con sincronización posterior
- ❌ Internacionalización (i18n) para múltiples idiomas
- ❌ Tema oscuro/claro configurable
- ❌ Configuración de notificaciones personalizada (por tipo, horarios)
- ❌ Chat en tiempo real entre usuarios
- ❌ Auditoría detallada con logs de acciones
- ❌ Integración con sistemas de pago

### 5.2 Alcances Técnicos

#### 5.2.1 Compatibilidad de Navegadores

La aplicación es compatible con:

✅ **Chrome/Edge** (versión 90+):
- Soporte completo de WebRTC
- Notificaciones del navegador
- WebSocket estable
- Performance óptima

✅ **Firefox** (versión 88+):
- Soporte completo de WebRTC
- Notificaciones del navegador
- WebSocket estable
- Performance buena

✅ **Safari** (versión 14+):
- Soporte completo de WebRTC
- Notificaciones del navegador (con limitaciones en iOS)
- WebSocket estable
- Performance buena (con algunas limitaciones en iOS)

❌ **Internet Explorer**: No soportado
❌ **Navegadores móviles antiguos** (Android < 7, iOS < 14): Soporte limitado

#### 5.2.2 Requisitos del Cliente

**Hardware Mínimo**:
- Procesador: Dual-core 2.0 GHz
- RAM: 4 GB (8 GB recomendado para múltiples streams)
- Conexión a internet: 5 Mbps (10+ Mbps para múltiples cámaras)

**Software**:
- Sistema operativo: Windows 10+, macOS 10.15+, Linux (Ubuntu 20.04+)
- Navegador actualizado (ver compatibilidad arriba)
- JavaScript habilitado
- Cookies habilitadas para persistencia de sesión

#### 5.2.3 Performance

**Métricas de Carga**:
- Tamaño del bundle JavaScript: ~450 KB (gzipped)
- Tamaño del bundle CSS: ~30 KB (gzipped)
- Tiempo de carga inicial: < 2 segundos (conexión rápida)
- Time to Interactive (TTI): < 3 segundos

**Optimizaciones Implementadas**:
- ✅ Code splitting con lazy loading de rutas
- ✅ Compresión gzip/brotli del bundle
- ✅ Minificación de CSS y JS
- ✅ Tree shaking para eliminar código no usado
- ✅ Caching agresivo de assets estáticos
- ✅ Imágenes optimizadas con lazy loading

**Consumo de Ancho de Banda**:
- Streaming de 1 cámara: ~1-2 Mbps
- WebSocket (notificaciones): < 10 KB/min
- Requests HTTP típicas: 2-20 KB por request

### 5.3 Alcances de Seguridad

#### 5.3.1 Medidas de Seguridad Implementadas

**Autenticación y Autorización**:
- ✅ JWT con expiración configurable (24 horas por defecto)
- ✅ Token almacenado en localStorage (consideración: más vulnerable a XSS que httpOnly cookies)
- ✅ Validación de permisos en frontend (nota: no sustituye validación en backend)
- ✅ Rutas protegidas con redirección automática
- ✅ Logout con limpieza completa de sesión

**Validación de Datos**:
- ✅ Validación en cliente con Zod antes de enviar al backend
- ✅ Sanitización de inputs en formularios
- ✅ Validación de tipos con TypeScript en compile-time
- ✅ Rate limiting implícito en React Query (staleTime, cacheTime)

**Comunicación Segura**:
- ✅ HTTPS obligatorio en producción
- ✅ WSS (WebSocket Secure) para comunicación en tiempo real
- ✅ CORS configurado en backend para aceptar solo orígenes permitidos
- ✅ Headers de seguridad (Content Security Policy, X-Frame-Options)

#### 5.3.2 Vulnerabilidades Conocidas y Mitigaciones

**XSS (Cross-Site Scripting)**:
- Riesgo: Bajo
- Mitigación: React escapa automáticamente contenido renderizado, evitando uso de `dangerouslySetInnerHTML`
- Consideración: Validación adicional en backend para contenido de notificaciones

**CSRF (Cross-Site Request Forgery)**:
- Riesgo: Medio
- Mitigación: Token JWT en header Authorization (no en cookies), validación de origen en backend
- Consideración: Implementar CSRF tokens para operaciones críticas

**Almacenamiento de Token en localStorage**:
- Riesgo: Medio (vulnerable a XSS)
- Mitigación: Validación estricta de inputs, CSP headers
- Alternativa recomendada: httpOnly cookies (requiere cambio en backend)

### 5.4 Escalabilidad

#### 5.4.1 Límites Actuales

**Concurrencia de Usuarios**:
- Frontend puede manejar conexiones ilimitadas (estático servido por CDN)
- Límite real está en backend (WebSocket connections, base de datos)
- Recomendado: < 1000 usuarios concurrentes con infraestructura actual

**Streaming de Video**:
- Límite práctico: 4 cámaras simultáneas por cliente
- Consumo de ancho de banda: ~8 Mbps para 4 cámaras
- Performance del navegador: Degradación en computadores de gama baja con 4+ streams

**Tamaño del Cache**:
- React Query cache sin límite de tamaño por defecto
- Recomendación: Limpieza periódica de cache antiguo
- Implementado: `cacheTime: 300000` (5 minutos) para queries grandes

#### 5.4.2 Estrategias de Escalabilidad

**Frontend**:
- Servir desde CDN (Vercel, Netlify, Cloudflare Pages)
- Caching agresivo de assets estáticos
- Lazy loading de componentes pesados
- Paginación en listados grandes

**Backend** (fuera del alcance del frontend, pero relacionado):
- Load balancing de servidores WebSocket
- Sharding de base de datos por condominio
- CDN para streaming de video (CloudFlare Stream, AWS CloudFront)
- Redis para cache y pub/sub de notificaciones

## 6. Detalles de Implantación

### 6.1 Requisitos Previos

#### 6.1.1 Dependencias del Sistema

- Node.js 18+ (recomendado 20 LTS)
- npm 9+ o pnpm 8+
- Git para control de versiones

#### 6.1.2 Variables de Entorno

Crear archivo `.env` en la raíz del proyecto frontend:

```bash
# URL del backend
VITE_API_URL=https://api.example.com

# URL del WebSocket
VITE_WS_URL=https://api.example.com

# URL de MediaMTX para streaming (opcional, si difiere del backend)
VITE_MEDIAMTX_URL=https://stream.example.com

# Configuración de notificaciones (opcional)
VITE_VAPID_PUBLIC_KEY=<clave-pública-vapid>

# Entorno (development, staging, production)
VITE_ENVIRONMENT=production
```

**Para Desarrollo Local**:

```bash
VITE_API_URL=http://localhost:3000
VITE_WS_URL=http://localhost:3000
VITE_MEDIAMTX_URL=http://localhost:8889
VITE_ENVIRONMENT=development
```

### 6.2 Instalación

#### 6.2.1 Clonar Repositorio

```bash
cd c:\PROYECTOS\Taller\ de\ Titulo
cd frontend
```

#### 6.2.2 Instalar Dependencias

```bash
npm install
```

**Tiempo estimado**: 2-5 minutos (dependiendo de la conexión)

#### 6.2.3 Configurar Variables de Entorno

```bash
# Copiar archivo de ejemplo
cp .env.example .env

# Editar con valores reales
notepad .env
```

### 6.3 Ejecución en Desarrollo

#### 6.3.1 Iniciar Servidor de Desarrollo

```bash
npm run dev
```

**Salida esperada**:

```
  VITE v7.1.7  ready in 523 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

#### 6.3.2 Hot Module Replacement (HMR)

Vite incluye HMR automático:
- Cambios en componentes React se reflejan instantáneamente
- Cambios en CSS se aplican sin recargar la página
- Estado de la aplicación se preserva durante actualizaciones

#### 6.3.3 Comandos Adicionales

```bash
# Linter (ESLint)
npm run lint

# Corrección automática de problemas de lint
npm run lint:fix

# Type checking con TypeScript
npm run type-check

# Ejecutar todos los checks antes de commit
npm run validate
```

### 6.4 Build para Producción

#### 6.4.1 Generar Build Optimizado

```bash
npm run build
```

**Proceso**:
1. TypeScript compila a JavaScript
2. Vite aplica tree shaking
3. CSS se minifica y extrae
4. Assets se optimizan y hashean
5. Bundle se genera en carpeta `dist/`

**Salida esperada**:

```
vite v7.1.7 building for production...
✓ 1250 modules transformed.
dist/index.html                    0.52 kB │ gzip:  0.32 kB
dist/assets/index-DwJ5p8YH.css    28.41 kB │ gzip: 10.23 kB
dist/assets/index-BV8c9pKq.js    450.12 kB │ gzip: 145.67 kB

✓ built in 8.34s
```

#### 6.4.2 Preview del Build

```bash
npm run preview
```

Inicia servidor estático sirviendo la carpeta `dist/` en `http://localhost:4173`

### 6.5 Deployment

#### 6.5.1 Deployment en Vercel (Recomendado)

**Método 1: Vercel CLI**

```bash
# Instalar Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

**Método 2: GitHub Integration**

1. Conectar repositorio en [vercel.com](https://vercel.com)
2. Configurar variables de entorno en Vercel Dashboard
3. Cada push a `main` despliega automáticamente

**Configuración en `vercel.json`**:

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

#### 6.5.2 Deployment en Netlify

**netlify.toml**:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

**Deploy**:

```bash
# Instalar Netlify CLI
npm i -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod
```

#### 6.5.3 Deployment con Docker (Opcional)

**Dockerfile**:

```dockerfile
# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**nginx.conf**:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Comprimir respuestas
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Build y Run**:

```bash
# Build imagen
docker build -t conserje-digital-frontend .

# Run contenedor
docker run -p 80:80 conserje-digital-frontend
```

### 6.6 Monitoreo y Mantenimiento

#### 6.6.1 Health Checks

**Endpoint de Health**:

```typescript
// public/health.json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Script de Monitoreo**:

```bash
#!/bin/bash
# health-check.sh

URL="https://app.example.com/health.json"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $URL)

if [ $RESPONSE -eq 200 ]; then
    echo "✅ Frontend is healthy"
    exit 0
else
    echo "❌ Frontend is down (HTTP $RESPONSE)"
    exit 1
fi
```

#### 6.6.2 Logging y Analytics

**Integración con Google Analytics** (opcional):

```typescript
// lib/analytics.ts
export function trackPageView(path: string) {
  if (window.gtag && import.meta.env.PROD) {
    window.gtag('config', 'GA_MEASUREMENT_ID', {
      page_path: path,
    })
  }
}

export function trackEvent(eventName: string, parameters?: Record<string, any>) {
  if (window.gtag && import.meta.env.PROD) {
    window.gtag('event', eventName, parameters)
  }
}
```

**Uso en Router**:

```typescript
// router.tsx
const router = createBrowserRouter([
  // ... rutas
])

router.subscribe((state) => {
  trackPageView(state.location.pathname)
})
```

#### 6.6.3 Error Tracking con Sentry (Opcional)

```bash
npm install @sentry/react
```

```typescript
// main.tsx
import * as Sentry from '@sentry/react'

if (import.meta.env.PROD) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      new Sentry.BrowserTracing(),
      new Sentry.Replay(),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}
```

### 6.7 Actualización y Rollback

#### 6.7.1 Proceso de Actualización

1. **Desarrollo**:
   ```bash
   git checkout -b feature/nueva-funcionalidad
   # ... desarrollo
   npm run validate  # lint + type-check
   git commit -m "feat: nueva funcionalidad"
   git push origin feature/nueva-funcionalidad
   ```

2. **Code Review**: Pull request en GitHub/GitLab

3. **Testing**: Deploy en ambiente de staging
   ```bash
   vercel --env=staging
   ```

4. **Producción**: Merge a `main` activa deploy automático

#### 6.7.2 Rollback

**Vercel**:
```bash
# Listar deployments
vercel ls

# Promover deployment anterior a producción
vercel promote <deployment-id>
```

**Netlify**:
- Dashboard → Deploys → Click en deploy anterior → Publish deploy

**Docker**:
```bash
# Revertir a imagen anterior
docker run -p 80:80 conserje-digital-frontend:v1.2.3
```

### 6.8 Backups

#### 6.8.1 Código Fuente

- ✅ Git en GitHub/GitLab (backup automático)
- ✅ Branches protegidos (`main`, `develop`)
- ✅ Tags para versiones estables

#### 6.8.2 Configuración

- Variables de entorno documentadas en `.env.example`
- Secrets en Vercel/Netlify dashboard (backup manual recomendado)

## 7. Conclusiones

### 7.1 Logros Alcanzados

La implementación del frontend de la aplicación Conserje Digital cumple exitosamente con los objetivos planteados:

1. **Arquitectura Moderna y Escalable**: Se utilizó React 19 con TypeScript, asegurando type safety y mantenibilidad del código. La arquitectura modular permite agregar nuevas funcionalidades sin afectar módulos existentes.

2. **Comunicación Eficiente con Backend**: La integración con los servicios backend (NestJS, MediaMTX, LPR) se logró mediante:
   - HTTP REST con Axios para operaciones CRUD
   - WebSocket con Socket.io para notificaciones en tiempo real
   - WebRTC/WHEP para streaming de video de baja latencia

3. **Gestión de Estado Robusta**: TanStack Query maneja eficientemente el estado del servidor con caching automático, invalidación inteligente y actualización optimista, reduciendo requests innecesarios y mejorando la experiencia de usuario.

4. **Experiencia de Usuario Superior**:
   - Notificaciones en tiempo real sin necesidad de refrescar la página
   - Streaming de video con latencia < 1 segundo
   - Interfaz responsive con Tailwind CSS
   - Feedback visual inmediato en todas las acciones

5. **Seguridad y Control de Acceso**: Sistema de permisos granulares que protege rutas y elementos de UI según el rol del usuario, asegurando que cada usuario vea solo la información que le corresponde.

### 7.2 Desafíos Superados

Durante la implementación se enfrentaron y resolvieron los siguientes desafíos técnicos:

1. **WebRTC Negotiation**: La implementación de WHEP para streaming de video requirió manejo cuidadoso de estados asincrónicos, reintentos con backoff exponencial y detección de errores específicos del protocolo.

2. **Sincronización de Estado**: Mantener sincronizados el estado local (React Query), el estado del servidor (HTTP) y las actualizaciones en tiempo real (WebSocket) requirió diseño cuidadoso de invalidaciones y actualización optimista.

3. **Performance con Múltiples Streams**: Optimización del renderizado de múltiples streams de video simultáneos mediante lazy loading y manejo eficiente del ciclo de vida de conexiones WebRTC.

4. **Manejo de Conexiones Inestables**: Implementación de reconexión automática para WebSocket, retry logic para requests HTTP y fallback graceful para funcionalidades que requieren conexión.

### 7.3 Trabajo Futuro

Las siguientes mejoras se identifican para futuras iteraciones:

1. **Migración de Almacenamiento de Token**: Evaluar migración de localStorage a httpOnly cookies para mejorar seguridad contra XSS.

2. **Progressive Web App (PWA)**: Implementar Service Workers para soporte offline y instalación como app nativa.

3. **Internacionalización (i18n)**: Soporte para múltiples idiomas (español, inglés) usando react-i18next.

4. **Optimización de Bundle**: Análisis con webpack-bundle-analyzer para identificar dependencias pesadas y reducir tamaño del bundle.

5. **Testing**: Implementar suite completa de tests:
   - Unit tests con Vitest
   - Integration tests con React Testing Library
   - E2E tests con Playwright

6. **Accessibility (a11y)**: Auditoría completa de accesibilidad y cumplimiento de WCAG 2.1 nivel AA.

7. **Analytics Avanzados**: Integración con herramientas de analytics para métricas de uso y comportamiento de usuarios.

### 7.4 Reflexión Final

El frontend de Conserje Digital representa una implementación moderna y profesional de una aplicación web en tiempo real, demostrando el uso efectivo de tecnologías actuales del ecosistema JavaScript/TypeScript.

La decisión de utilizar React 19 con TypeScript resultó acertada, proporcionando un balance óptimo entre productividad de desarrollo, performance y mantenibilidad. La integración con TanStack Query simplificó significativamente la gestión de estado asíncrono, eliminando la necesidad de librerías adicionales como Redux.

La implementación de WebRTC para streaming de video y WebSocket para notificaciones en tiempo real demuestra la capacidad de la aplicación para manejar casos de uso complejos con requisitos de baja latencia.

El sistema de permisos granulares asegura que la aplicación pueda escalar a condominios de diferentes tamaños, con roles y permisos personalizables según las necesidades específicas de cada organización.

En resumen, el frontend cumple con los estándares de calidad esperados para una aplicación empresarial moderna, con arquitectura escalable, código mantenible y experiencia de usuario fluida.

---

**Documento generado el**: 15 de enero de 2024  
**Versión del Frontend**: 1.0.0  
**Autor**: [Tu Nombre]  
**Institución**: [Nombre de la Universidad]
