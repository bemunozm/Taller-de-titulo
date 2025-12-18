import { BrowserRouter, Routes, Route } from "react-router-dom";
import LoginView from "@/views/auth/LoginView";
import ForgotPasswordView from "@/views/auth/ForgotPasswordView";
import ConfirmAccountView from "@/views/auth/ConfirmAccountView";
import NewPasswordView from "@/views/auth/NewPasswordView";
import { AuthLayout } from "@/layouts/AuthLayout";
import RequestCodeView from "./views/auth/RequestCodeView";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Protected } from "@/components/auth/Protected";
import { ForbiddenView } from "@/views/errors/ForbiddenView";
import { NotFoundView } from "@/views/errors/NotFoundView";
import TraceabilityView from "./views/TraceabilityView";
import TraceabilityDetailView from "./views/TraceabilityDetailView";
import { StackedLayout } from "./layouts/StackedLayout";
import { Avatar } from "@/components/ui/Avatar";
import {
  Dropdown,
  DropdownButton,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@/components/ui/Dropdown";
import {
  ArrowRightStartOnRectangleIcon,
  Cog8ToothIcon,
  ShieldCheckIcon,
  UserIcon,
  LightBulbIcon,
} from "@heroicons/react/16/solid";
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from './hooks/useAuth'
import { NotificationBell } from './components/NotificationBell'
import { VisitorApprovalDialog } from './components/VisitorApprovalDialog'
import { UnknownVehicleApprovalDialog } from './components/UnknownVehicleApprovalDialog'

function UserAvatar() {
  const { data: user } = useAuth()
  
  if (!user) {
    return <Avatar src="/profile-photo.jpg" />
  }
  
  if (user.profilePicture) {
    return <Avatar src={user.profilePicture} alt={user.name} />
  }
  
  return (
    <Avatar 
      initials={user.name.charAt(0).toUpperCase()} 
      alt={user.name}
    />
  )
}

function LogoutItem() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const handle = () => {
    try {
      logout()
    } catch (e) {
      // ignore
    }
    toast.success('Cerraste sesión correctamente')
    navigate('/auth/login')
  }
  return (
    <DropdownItem onClick={handle}>
      <ArrowRightStartOnRectangleIcon />
      <DropdownLabel>Cerrar sesión</DropdownLabel>
    </DropdownItem>
  )
}
import {
  Navbar,
  NavbarItem,
  NavbarSection,
  NavbarSpacer,
} from "@/components/ui/Navbar";
import {
  Sidebar,
  SidebarBody,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
} from "@/components/ui/Sidebar";
import DashboardView from "./views/DashboardView";
import ResidentDashboardView from "./views/ResidentDashboardView";
import SettingsView from "./views/SettingsView";
import NotificationTestView from "./views/NotificationTestView";
import FamiliesView from "./views/FamiliesView";
import { VehiclesView } from "./views/VehiclesView";
import { VisitsView } from "./views/VisitsView";
import { QRScannerView } from "./views/QRScannerView";
import { DigitalConciergeView } from "./views/DigitalConciergeView";
import { UsersView } from "./views/UsersView";
import { RolesView } from "./views/RolesView";
import { CreateRoleView } from "./views/CreateRoleView";
import MetricsView from "./views/MetricsView";
import { EditRoleView } from "./views/EditRoleView";
import CamerasSettingsView from "./views/CamerasSettingsView";
import AuditLogsView from "./views/AuditLogsView";
import SystemLogsView from "./views/SystemLogsView";
import ProfileView from "./views/ProfileView";
import UnitsView from "./views/UnitsView";
import CamerasView from "./views/CamerasView";
import PrivacyPolicyView from "./views/PrivacyPolicyView";
import ShareFeedbackView from "./views/ShareFeedbackView";

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          element={
            <StackedLayout
              navbar={
                <Navbar>
                  <div className="max-lg:hidden px-4 py-2.5">
                    <img 
                      src="/logo-fondo-oscuro.png" 
                      alt="Logo" 
                      className="h-24 w-auto"
                    />
                  </div>
                  <NavbarSection className="max-lg:hidden">
                    <NavbarItem href="/">Inicio</NavbarItem>
                  
                    
                    <Protected permission="vehicles.read">
                      <NavbarItem href="/vehicles">Mis Vehículos</NavbarItem>
                    </Protected>
                    
                    <Protected permission="visits.read">
                      <NavbarItem href="/visits">Mis Visitas</NavbarItem>
                    </Protected>
                    
                    <Protected permission="visits.validate-qr">
                      <NavbarItem href="/qr-scanner">Escanear QR</NavbarItem>
                    </Protected>
                    
                    <Protected anyPermission={['cameras.read', 'cameras.view-stream', 'streams.read']}>
                      <NavbarItem href="/cameras">Cámaras</NavbarItem>
                    </Protected>
                    
                    <Protected anyRole={['Administrador', 'Super Administrador']}>
                      <NavbarItem href="/settings">Configuraciones</NavbarItem>
                    </Protected>
                  </NavbarSection>
                  <NavbarSpacer />
                  <NavbarSection>
                    <NotificationBell />
                    <Dropdown>
                      <DropdownButton as={NavbarItem}>
                        <UserAvatar />
                      </DropdownButton>
                      <DropdownMenu className="min-w-64" anchor="bottom end">
                        <DropdownItem href="/my-profile">
                          <UserIcon />
                          <DropdownLabel>Mi perfil</DropdownLabel>
                        </DropdownItem>
                        <Protected anyRole={['Administrador', 'Super Administrador']}>
                          <DropdownItem href="/settings">
                            <Cog8ToothIcon />
                            <DropdownLabel>Configuraciones</DropdownLabel>
                          </DropdownItem>
                        </Protected>
                        <DropdownDivider />
                        <DropdownItem href="/privacy-policy">
                          <ShieldCheckIcon />
                          <DropdownLabel>Política de privacidad</DropdownLabel>
                        </DropdownItem>
                        <DropdownItem href="/share-feedback">
                          <LightBulbIcon />
                          <DropdownLabel>Enviar comentarios</DropdownLabel>
                        </DropdownItem>
                        <DropdownDivider />
                        <LogoutItem />
                      </DropdownMenu>
                    </Dropdown>
                  </NavbarSection>
                </Navbar>
              }
              sidebar={
                <Sidebar>
                  <SidebarHeader>
                    <div className="flex justify-center lg:justify-start">
                      <SidebarItem href="/" className="lg:mb-2.5">
                        <img 
                          src="/logo-fondo-oscuro.png" 
                          alt="Logo" 
                          className="h-32 w-auto"
                        />
                      </SidebarItem>
                    </div>
                  </SidebarHeader>
                  <SidebarBody>
                    <SidebarSection>
                      <SidebarItem href="/">Inicio</SidebarItem>
                      
                      <Protected permission="admin.dashboard">
                        <SidebarItem href="/dashboard">Dashboard Admin</SidebarItem>
                      </Protected>
                      
                      <Protected permission="admin.dashboard" anyRole={['Administrador', 'Super Administrador']}>
                        <SidebarItem href="/metrics">Métricas</SidebarItem>
                      </Protected>
                      
                      <Protected permission="vehicles.read">
                        <SidebarItem href="/vehicles">Mis Vehículos</SidebarItem>
                      </Protected>
                      
                      <Protected permission="visits.read">
                        <SidebarItem href="/visits">Mis Visitas</SidebarItem>
                      </Protected>
                      
                      <Protected permission="visits.validate-qr">
                        <SidebarItem href="/qr-scanner">Escanear QR</SidebarItem>
                      </Protected>
                      
                      <Protected anyPermission={['cameras.read', 'cameras.view-stream', 'streams.read']}>
                        <SidebarItem href="/cameras">Cámaras</SidebarItem>
                      </Protected>
                      
                      <Protected anyRole={['Administrador', 'Super Administrador']}>
                        <SidebarItem href="/settings">Configuraciones</SidebarItem>
                      </Protected>
                    </SidebarSection>
                  </SidebarBody>
                </Sidebar>
              }
            />
          }
        >
          {/* Rutas protegidas por permisos */}
          
          {/* Dashboard Administrativo - Solo Admin y Conserje */}
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute permission="admin.dashboard" >
                <DashboardView />
              </ProtectedRoute>
            } 
          />
          
          {/* Home / Dashboard Residente - Ruta por defecto */}
          <Route 
            path="/" 
            element={<ResidentDashboardView />} 
            index 
          />
          
          {/* Gestión de Familias */}
          <Route 
            path="/families" 
            element={
              <ProtectedRoute permission="families.read" anyRole={['Administrador', 'Super Administrador', 'Conserje']}>
                <FamiliesView />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings/families" 
            element={
              <ProtectedRoute permission="families.read">
                <FamiliesView />
              </ProtectedRoute>
            } 
          />
          
          {/* Gestión de Vehículos */}
          <Route 
            path="/vehicles" 
            element={
              <ProtectedRoute permission="vehicles.read">
                <VehiclesView />
              </ProtectedRoute>
            } 
          />
          
          {/* Gestión de Visitas */}
          <Route 
            path="/visits" 
            element={
              <ProtectedRoute permission="visits.read">
                <VisitsView />
              </ProtectedRoute>
            } 
          />
          
          {/* Gestión de Usuarios */}
          <Route 
            path="/settings/users" 
            element={
              <ProtectedRoute permission="users.read">
                <UsersView />
              </ProtectedRoute>
            } 
          />
          {/* Redirect antigua ruta de usuarios */}
          <Route path="/users" element={<UsersView />} />
          
          {/* Gestión de Roles */}
          <Route 
            path="/settings/roles" 
            element={
              <ProtectedRoute permission="roles.read">
                <RolesView />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings/roles/create" 
            element={
              <ProtectedRoute permission="roles.create">
                <CreateRoleView />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings/roles/edit/:id" 
            element={
              <ProtectedRoute permission="roles.update">
                <EditRoleView />
              </ProtectedRoute>
            } 
          />
          {/* Redirects antiguas rutas de roles */}
          <Route path="/roles" element={<RolesView />} />
          <Route path="/roles/create" element={<CreateRoleView />} />
          <Route path="/roles/edit/:id" element={<EditRoleView />} />
          
          {/* Gestión de Unidades */}
          <Route 
            path="/settings/units" 
            element={
              <ProtectedRoute permission="units.read">
                <UnitsView />
              </ProtectedRoute>
            } 
          />
          
          {/* Escaneo de QR */}
          <Route 
            path="/qr-scanner" 
            element={
              <ProtectedRoute permission="visits.validate-qr">
                <QRScannerView />
              </ProtectedRoute>
            } 
          />
          
          {/* Cámaras - Vista unificada */}
          <Route 
            path="/cameras" 
            element={
              <ProtectedRoute anyPermission={['cameras.read', 'cameras.view-stream', 'streams.read']}>
                <CamerasView />
              </ProtectedRoute>
            } 
          />
          
          {/* Redirects de rutas antiguas de cámaras */}
          <Route path="/conserje" element={<CamerasView />} />
          <Route path="/residente" element={<CamerasView />} />
          
          {/* Configuraciones - Solo Administradores */}
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute anyRole={['Administrador', 'Super Administrador']}>
                <SettingsView />
              </ProtectedRoute>
            } 
          />
          
          {/* Configuración de Cámaras */}
          <Route 
            path="/settings/cameras" 
            element={
              <ProtectedRoute permission="cameras.read">
                <CamerasSettingsView />
              </ProtectedRoute>
            } 
          />
          
          {/* Auditoría */}
          <Route 
            path="/settings/audit" 
            element={
              <ProtectedRoute permission="audit.read">
                <AuditLogsView />
              </ProtectedRoute>
            } 
          />
          
          {/* Logs del Sistema */}
          <Route 
            path="/settings/logs" 
            element={
              <ProtectedRoute permission="logs.read">
                <SystemLogsView />
              </ProtectedRoute>
            } 
          />
          
          {/* Mi Perfil - Accesible para todos los usuarios autenticados */}
          <Route 
            path="/my-profile" 
            element={
              <ProtectedRoute>
                <ProfileView />
              </ProtectedRoute>
            } 
          />
          
          {/* Trazabilidad */}
          <Route 
            path="/traceability" 
            element={
              <ProtectedRoute permission="detections.read" anyRole={['Administrador', 'Super Administrador', 'Conserje']}>
                <TraceabilityView />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/traceability/:id" 
            element={
              <ProtectedRoute permission="detections.read" anyRole={['Administrador', 'Super Administrador', 'Conserje']}>
                <TraceabilityDetailView />
              </ProtectedRoute>
            } 
          />
          
          {/* Métricas de Rendimiento */}
          <Route 
            path="/metrics" 
            element={
              <ProtectedRoute permission="admin.dashboard" anyRole={['Administrador', 'Super Administrador']}>
                <MetricsView />
              </ProtectedRoute>
            } 
          />
          
          {/* Testing (sin protección) */}
          <Route path="/notifications-test" element={<NotificationTestView />} />
          
          {/* Política de Privacidad - Accesible para todos */}
          <Route 
            path="/privacy-policy" 
            element={
              <ProtectedRoute>
                <PrivacyPolicyView />
              </ProtectedRoute>
            } 
          />
          
          {/* Enviar Comentarios - Accesible para todos */}
          <Route 
            path="/share-feedback" 
            element={
              <ProtectedRoute>
                <ShareFeedbackView />
              </ProtectedRoute>
            } 
          />
          
        </Route>

        {/* Rutas de autenticación sin layout principal */}
        <Route element={<AuthLayout />}>
          {" "}
          {/* Se envuelven todas las rutas anidadas en un layout*/}
          <Route path="/auth/login" element={<LoginView />} />
          <Route
            path="/auth/forgot-password"
            element={<ForgotPasswordView />}
          />
          <Route
            path="/auth/confirm-account"
            element={<ConfirmAccountView />}
          />
          <Route path="/auth/request-code" element={<RequestCodeView />} />
          <Route path="/auth/new-password" element={<NewPasswordView />} />
        </Route>

        {/* Conserje Digital */}
          <Route 
            path="/digital-concierge" 
            element={
                <DigitalConciergeView />
            } 
          />

        {/* Páginas de Error - Sin layout */}
        <Route path="/403" element={<ForbiddenView />} />
        <Route path="*" element={<NotFoundView />} />
      </Routes>

      {/* Componentes globales para aprobaciones */}
      <VisitorApprovalDialog />
      <UnknownVehicleApprovalDialog />
    </BrowserRouter>
  );
}
