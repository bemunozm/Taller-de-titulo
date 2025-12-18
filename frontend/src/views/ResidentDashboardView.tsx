import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { Protected } from '@/components/auth/Protected';
import {
  CalendarIcon,
  TruckIcon,
  UserGroupIcon,
  PlusCircleIcon,
  BellIcon,
  ChartBarSquareIcon,
} from '@heroicons/react/24/outline';
import { Heading, Subheading } from '@/components/ui/Heading';
import { Button } from '@/components/ui/Button';
import { Link } from 'react-router-dom';
import { MyVisitsCard } from '@/components/resident-dashboard/MyVisitsCard';
import { MyVehicleActivityCard } from '@/components/resident-dashboard/MyVehicleActivityCard';
import { MyFamilyCard } from '@/components/resident-dashboard/MyFamilyCard';
import { QuickActionsPanel } from '@/components/resident-dashboard/QuickActionsPanel';
import { MyRecentActivityCard } from '@/components/resident-dashboard/MyRecentActivityCard';
import { getVisits } from '@/api/VisitAPI';
import { getVehicles } from '@/api/VehicleAPI';
import { listPlateDetections } from '@/api/DetectionsAPI';
import { getFamilyById } from '@/api/FamilyAPI';
import type { Visit, Vehicle } from '@/types/index';
import type { PlateDetection } from '@/api/DetectionsAPI';

export default function ResidentDashboardView() {
  const { data: user } = useAuth();
  const { unreadCount } = useNotifications();

  // Query para obtener visitas (backend filtra automáticamente por rol)
  const { data: myVisits = [], isLoading: visitsLoading } = useQuery<Visit[]>({
    queryKey: ['visits'],
    queryFn: getVisits,
  });
  
  // Visitas activas (estado 'active')
  const activeVisits = myVisits.filter(visit => visit.status === 'active');
  
  // Visitas próximas (programadas para el futuro o listas para reingresar)
  const upcomingVisits = myVisits.filter(visit => {
    const now = new Date();
    const validFrom = new Date(visit.validFrom);
    // Incluir visitas pending (nunca ingresaron) y ready (pueden reingresar)
    return (visit.status === 'pending' && validFrom > now) || visit.status === 'ready';
  }).sort((a, b) => new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime());

  // Visitas recientes completadas (últimos 7 días)
  const recentCompletedVisits = myVisits.filter(visit => {
    const exitTime = visit.exitTime ? new Date(visit.exitTime) : null;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return visit.status === 'completed' && exitTime && exitTime >= sevenDaysAgo;
  }).sort((a, b) => {
    const aTime = a.exitTime ? new Date(a.exitTime).getTime() : 0;
    const bTime = b.exitTime ? new Date(b.exitTime).getTime() : 0;
    return bTime - aTime;
  });

  // Visitas recientes con actividad (últimos 7 días) - para el timeline de actividad
  const recentVisitsWithActivity = myVisits.filter(visit => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Incluir visitas que tengan entryTime o exitTime en los últimos 7 días
    const hasRecentEntry = visit.entryTime && new Date(visit.entryTime) >= sevenDaysAgo;
    const hasRecentExit = visit.exitTime && new Date(visit.exitTime) >= sevenDaysAgo;
    
    return hasRecentEntry || hasRecentExit;
  });

  // Query para obtener vehículos (backend filtra automáticamente por rol)
  const { data: myVehicles = [], isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: getVehicles,
  });

  // Query para obtener detecciones
  const { data: allDetections = [], isLoading: detectionsLoading } = useQuery<PlateDetection[]>({
    queryKey: ['detections'],
    queryFn: listPlateDetections,
  });

  // Filtrar detecciones de mis vehículos (últimos 7 días)
  const myVehiclePlates = myVehicles.map(v => v.plate.toUpperCase());
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const myDetections = allDetections.filter(detection => {
    const detectionDate = new Date(detection.createdAt);
    return myVehiclePlates.includes(detection.plate.toUpperCase()) && detectionDate >= sevenDaysAgo;
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Query para obtener detalles completos de la familia (incluyendo miembros)
  const { data: familyDetails } = useQuery({
    queryKey: ['family', user?.family?.id],
    queryFn: () => getFamilyById(user!.family!.id),
    enabled: !!user?.family?.id, // Solo ejecutar si el usuario tiene familia
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Heading>¡Bienvenid@, {user?.name?.split(' ')[0]}! 👋</Heading>
            <Subheading className="mt-1">
              Resumen de tu actividad y seguridad
            </Subheading>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Protected anyRole={['Super Administrador', 'Administrador']}>
              <Link to="/dashboard" className="w-full sm:w-auto">
                <Button color="zinc" className="w-full sm:w-auto">
                  <ChartBarSquareIcon className="h-5 w-5" />
                  Dashboard Ejecutivo
                </Button>
              </Link>
            </Protected>
            <Link to="/visits" className="w-full sm:w-auto">
              <Button color="indigo" className="w-full sm:w-auto">
                <PlusCircleIcon className="h-5 w-5" />
                Nueva Visita
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Cards Principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Visitas Activas */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Visitas Activas
              </p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mt-2">
                {activeVisits.length}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {upcomingVisits.length} próximas
              </p>
            </div>
            <div className="p-3 bg-blue-100 dark:bg-blue-500/10 rounded-lg">
              <CalendarIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>

        {/* Mis Vehículos */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Mis Vehículos
              </p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mt-2">
                {myVehicles.length}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {myDetections.length} detecciones (7d)
              </p>
            </div>
            <div className="p-3 bg-green-100 dark:bg-green-500/10 rounded-lg">
              <TruckIcon className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </div>

        {/* Mi Familia */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Mi Familia
              </p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mt-2">
                {user?.family?.name || 'Sin asignar'}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {user?.family?.unit?.type} {user?.family?.unit?.number || '-'}
              </p>
            </div>
            <div className="p-3 bg-purple-100 dark:bg-purple-500/10 rounded-lg">
              <UserGroupIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>

        {/* Notificaciones */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Notificaciones
              </p>
              <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mt-2">
                {unreadCount}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Sin leer
              </p>
            </div>
            <div className="p-3 bg-amber-100 dark:bg-amber-500/10 rounded-lg">
              <BellIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <QuickActionsPanel 
        activeVisits={activeVisits}
        myVehicles={myVehicles}
      />

      {/* Main Content Grid */}
      <div className="space-y-6">
        {/* Top Grid - 2/3 + 1/3 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Visitas y Vehículos (2/3) */}
          <div className="lg:col-span-2 space-y-6">
            <MyVisitsCard
              activeVisits={activeVisits}
              upcomingVisits={upcomingVisits}
              recentCompletedVisits={recentCompletedVisits}
              loading={visitsLoading}
            />
            
            <MyVehicleActivityCard
              myVehicles={myVehicles}
              myDetections={myDetections}
              loading={vehiclesLoading || detectionsLoading}
            />
          </div>

          {/* Right Column - Mi Familia (1/3, altura completa) */}
          <div className="lg:col-span-1 flex">
            <MyFamilyCard 
              family={user?.family} 
              members={familyDetails?.members}
            />
          </div>
        </div>

        {/* Bottom - Actividad Reciente (ancho completo) */}
        <MyRecentActivityCard
          recentVisits={recentVisitsWithActivity}
          recentDetections={myDetections}
        />
      </div>
    </div>
  );
}
