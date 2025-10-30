import { BrowserRouter, Routes, Route } from "react-router-dom";
import RegisterView from "@/views/auth/RegisterView";
import LoginView from "@/views/auth/LoginView";
import ForgotPasswordView from "@/views/auth/ForgotPasswordView";
import ConfirmAccountView from "@/views/auth/ConfirmAccountView";
import NewPasswordView from "@/views/auth/NewPasswordView";
import { AuthLayout } from "@/layouts/AuthLayout";
import RequestCodeView from "./views/auth/RequestCodeView";
import ConserjeView from "./views/ConserjeView";
import ResidenteView from "./views/ResidenteView";
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
  ChevronDownIcon,
  Cog8ToothIcon,
  LightBulbIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@heroicons/react/16/solid";
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from './hooks/useAuth'

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
import { InboxIcon, MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import {
  Navbar,
  NavbarDivider,
  NavbarItem,
  NavbarLabel,
  NavbarSection,
  NavbarSpacer,
} from "@/components/ui/Navbar";
import {
  Sidebar,
  SidebarBody,
  SidebarHeader,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from "@/components/ui/Sidebar";
import DashboardView from "./views/DashboardView";
import SettingsView from "./views/SettingsView";

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          element={
            <StackedLayout
              navbar={
                <Navbar>
                  <Dropdown>
                    <DropdownButton as={NavbarItem} className="max-lg:hidden">
                      <Avatar src="/tailwind-logo.svg" />
                      <NavbarLabel>Condominio San Lorenzo</NavbarLabel>
                      <ChevronDownIcon />
                    </DropdownButton>
                    <DropdownMenu
                      className="min-w-80 lg:min-w-64"
                      anchor="bottom start"
                    >
                      <DropdownItem href="#">
                        <Cog8ToothIcon />
                        <DropdownLabel>Configuraciones</DropdownLabel>
                      </DropdownItem>
                      <DropdownDivider />
                      <DropdownItem href="#">
                        <Avatar slot="icon" src="/tailwind-logo.svg" />
                        <DropdownLabel>Condominio San Lorenzo</DropdownLabel>
                      </DropdownItem>
                      <DropdownItem href="#">
                        <Avatar
                          slot="icon"
                          initials="WC"
                          className="bg-purple-500 text-white"
                        />
                        <DropdownLabel>Condominio La Tirana</DropdownLabel>
                      </DropdownItem>
                      <DropdownDivider />
                      <DropdownItem href="/teams/create">
                        <PlusIcon />
                        <DropdownLabel>Nuevo condominio</DropdownLabel>
                      </DropdownItem>
                    </DropdownMenu>
                  </Dropdown>
                  <NavbarDivider className="max-lg:hidden" />
                  <NavbarSection className="max-lg:hidden">
                    {[
                      { label: "Inicio", url: "/" },
                      { label: "Camaras - Conserje", url: "/conserje" },
                      { label: "Camaras - Residentes", url: "/residente" },
                      { label: "Trazabilidad", url: "/traceability" },
                      { label: "Configuraciones", url: "/settings" },
                    ].map(({ label, url }) => (
                      <NavbarItem key={label} href={url}>
                        {label}
                      </NavbarItem>
                    ))}
                  </NavbarSection>
                  <NavbarSpacer />
                  <NavbarSection>
                    <NavbarItem href="/search" aria-label="Search">
                      <MagnifyingGlassIcon />
                    </NavbarItem>
                    <NavbarItem href="/inbox" aria-label="Inbox">
                      <InboxIcon />
                    </NavbarItem>
                    <Dropdown>
                      <DropdownButton as={NavbarItem}>
                        <Avatar src="/profile-photo.jpg" square />
                      </DropdownButton>
                      <DropdownMenu className="min-w-64" anchor="bottom end">
                        <DropdownItem href="/my-profile">
                          <UserIcon />
                          <DropdownLabel>Mi perfil</DropdownLabel>
                        </DropdownItem>
                        <DropdownItem href="/settings">
                          <Cog8ToothIcon />
                          <DropdownLabel>Configuraciones</DropdownLabel>
                        </DropdownItem>
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
                    <Dropdown>
                      <DropdownButton as={SidebarItem} className="lg:mb-2.5">
                        <Avatar src="/tailwind-logo.svg" />
                        <SidebarLabel>Condominio San Lorenzo</SidebarLabel>
                        <ChevronDownIcon />
                      </DropdownButton>
                      <DropdownMenu
                        className="min-w-80 lg:min-w-64"
                        anchor="bottom start"
                      >
                        <DropdownItem href="#">
                          <Cog8ToothIcon />
                          <DropdownLabel>Configuraciones</DropdownLabel>
                        </DropdownItem>
                        <DropdownDivider />
                        <DropdownItem href="#">
                          <Avatar slot="icon" src="/tailwind-logo.svg" />
                          <DropdownLabel>Condominio San Lorenzo</DropdownLabel>
                        </DropdownItem>
                        <DropdownItem href="#">
                          <Avatar
                            slot="icon"
                            initials="WC"
                            className="bg-purple-500 text-white"
                          />
                          <DropdownLabel>Condominio La Tirana</DropdownLabel>
                        </DropdownItem>
                        <DropdownDivider />
                        <DropdownItem href="/teams/create">
                          <PlusIcon />
                          <DropdownLabel>Nuevo condominio</DropdownLabel>
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </SidebarHeader>
                  <SidebarBody>
                    <SidebarSection>
                      {[
                        { label: "Inicio", url: "/" },
                        { label: "Camaras - Conserje", url: "/conserje" },
                        { label: "Camaras - Residentes", url: "/residente" },
                        { label: "Trazabilidad", url: "/traceability" },
                        { label: "Configuraciones", url: "/settings" },
                      ].map(({ label, url }) => (
                        <SidebarItem key={label} href={url}>
                          {label}
                        </SidebarItem>
                      ))}
                    </SidebarSection>
                  </SidebarBody>
                </Sidebar>
              }
            />
          }
        >
          {" "}
          {/* Se envuelven todas las rutas anidadas en un layout*/}
          {/* 
                        -Se definen las rutas de la aplicación que comparten el layout
                        -En este caso, la ruta raíz renderiza el DashboardView
                        -index = define la ruta raíz
                        -element = componente a renderizar
                        -path = ruta de la aplicación
                    */}
          <Route path="/" element={<DashboardView />} index />
          <Route path="/conserje" element={<ConserjeView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/residente" element={<ResidenteView />} />
          <Route path="/traceability" element={<TraceabilityView />} />
          <Route path="/traceability/:id" element={<TraceabilityDetailView />} />
        </Route>

        {/* Rutas de autenticación sin layout principal */}
        <Route element={<AuthLayout />}>
          {" "}
          {/* Se envuelven todas las rutas anidadas en un layout*/}
          <Route path="/auth/register" element={<RegisterView />} />
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
      </Routes>
    </BrowserRouter>
  );
}
