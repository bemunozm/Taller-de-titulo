import {
  ClockIcon,
  TruckIcon,
  ArrowRightOnRectangleIcon,
  ArrowLeftOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { useState, useEffect } from 'react';
import type { Visit } from '@/types/index';
import type { PlateDetection } from '@/api/DetectionsAPI';
import { formatRelativeTime } from '@/helpers/index';

interface MyRecentActivityCardProps {
  recentVisits: Visit[];
  recentDetections: PlateDetection[];
}

type ActivityEvent = {
  id: string;
  type: 'visit-checkin' | 'visit-checkout' | 'detection';
  timestamp: Date;
  data: Visit | PlateDetection;
};

export function MyRecentActivityCard({ recentVisits, recentDetections }: MyRecentActivityCardProps) {
  // Estado para detectar si estamos en móvil
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Crear eventos de actividad desde las visitas
  const visitEvents: ActivityEvent[] = recentVisits.flatMap(visit => {
    const events: ActivityEvent[] = [];
    
    // Evento de check-in (entrada)
    if (visit.entryTime) {
      events.push({
        id: `${visit.id}-checkin`,
        type: 'visit-checkin',
        timestamp: new Date(visit.entryTime),
        data: visit,
      });
    }
    
    // Evento de check-out (salida)
    if (visit.exitTime) {
      events.push({
        id: `${visit.id}-checkout`,
        type: 'visit-checkout',
        timestamp: new Date(visit.exitTime),
        data: visit,
      });
    }
    
    return events;
  });

  // Crear eventos de detecciones
  const detectionEvents: ActivityEvent[] = recentDetections.map(detection => ({
    id: detection.id,
    type: 'detection',
    timestamp: new Date(detection.createdAt),
    data: detection,
  }));

  // Combinar y ordenar todos los eventos
  const maxEvents = isMobile ? 6 : 12;
  const activities = [...visitEvents, ...detectionEvents]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, maxEvents);

  const renderActivity = (activity: ActivityEvent) => {
    switch (activity.type) {
      case 'visit-checkin': {
        const visit = activity.data as Visit;
        return (
          <div
            key={activity.id}
            className="flex items-start gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/20"
          >
            <div className="p-2 bg-green-100 dark:bg-green-500/10 rounded-lg">
              <ArrowRightOnRectangleIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {visit.visitorName} ingresó
              </p>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Visita {visit.type === 'vehicular' ? 'vehicular' : 'peatonal'}
                {visit.vehicle?.plate && ` • ${visit.vehicle.plate}`}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {formatRelativeTime(activity.timestamp)}
              </p>
            </div>
          </div>
        );
      }

      case 'visit-checkout': {
        const visit = activity.data as Visit;
        const duration = visit.entryTime && visit.exitTime
          ? Math.round((new Date(visit.exitTime).getTime() - new Date(visit.entryTime).getTime()) / 1000 / 60)
          : null;
        
        return (
          <div
            key={activity.id}
            className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20"
          >
            <div className="p-2 bg-amber-100 dark:bg-amber-500/10 rounded-lg">
              <ArrowLeftOnRectangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {visit.visitorName} se retiró
              </p>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                {duration ? `Duración: ${duration} minutos` : 'Visita finalizada'}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {formatRelativeTime(activity.timestamp)}
              </p>
            </div>
          </div>
        );
      }

      case 'detection': {
        const detection = activity.data as PlateDetection;
        return (
          <div
            key={activity.id}
            className="flex items-start gap-3 p-3 rounded-lg bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/20"
          >
            <div className="p-2 bg-purple-100 dark:bg-purple-500/10 rounded-lg">
              <TruckIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Tu vehículo fue detectado
              </p>
              <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400">
                {detection.plate}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {formatRelativeTime(activity.timestamp)}
              </p>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <ClockIcon className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Actividad Reciente
          </h3>
        </div>
        {activities.length > 0 && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Últimos {activities.length} eventos
          </span>
        )}
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-12">
          <ClockIcon className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No hay actividad reciente
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Las visitas y detecciones aparecerán aquí
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {activities.map(renderActivity)}
        </div>
      )}
    </div>
  );
}
