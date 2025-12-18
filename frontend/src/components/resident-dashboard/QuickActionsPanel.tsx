import { Link } from 'react-router-dom';
import {
  PlusCircleIcon,
  QrCodeIcon,
  TruckIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import type { Visit, Vehicle } from '@/types/index';

interface QuickActionsPanelProps {
  activeVisits: Visit[];
  myVehicles: Vehicle[];
}

export function QuickActionsPanel({ activeVisits, myVehicles }: QuickActionsPanelProps) {
  const activeQRVisit = activeVisits.find(v => v.type === 'pedestrian' && v.qrCode);

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-lg border border-blue-200 dark:border-blue-900 p-6">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
        Acciones Rápidas
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Crear Visita */}
        <Link to="/visits">
          <button className="w-full h-32 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-md transition-all group">
            <div className="flex flex-col items-center justify-center gap-2 h-full">
              <div className="p-3 bg-blue-100 dark:bg-blue-500/10 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-500/20 transition-colors">
                <PlusCircleIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Nueva Visita
              </span>
            </div>
          </button>
        </Link>

        {/* Ver QR de Visita Activa */}
        {activeQRVisit ? (
          <Link to={`/visits/${activeQRVisit.id}`}>
            <button className="w-full h-32 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-green-400 dark:hover:border-green-600 hover:shadow-md transition-all group">
              <div className="flex flex-col items-center justify-center gap-2 h-full">
                <div className="p-3 bg-green-100 dark:bg-green-500/10 rounded-lg group-hover:bg-green-200 dark:group-hover:bg-green-500/20 transition-colors">
                  <QrCodeIcon className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Ver Código QR
                </span>
              </div>
            </button>
          </Link>
        ) : (
          <button 
            disabled 
            className="w-full h-32 p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 opacity-50 cursor-not-allowed"
          >
            <div className="flex flex-col items-center justify-center gap-2 h-full">
              <div className="p-3 bg-zinc-200 dark:bg-zinc-700 rounded-lg">
                <QrCodeIcon className="h-6 w-6 text-zinc-400 dark:text-zinc-500" />
              </div>
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Sin QR activo
              </span>
            </div>
          </button>
        )}

        {/* Mis Vehículos */}
        <Link to="/vehicles">
          <button className="w-full h-32 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-purple-400 dark:hover:border-purple-600 hover:shadow-md transition-all group">
            <div className="flex flex-col items-center justify-center gap-2 h-full">
              <div className="p-3 bg-purple-100 dark:bg-purple-500/10 rounded-lg group-hover:bg-purple-200 dark:group-hover:bg-purple-500/20 transition-colors">
                <TruckIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Mis Vehículos
                {myVehicles.length > 0 && (
                  <span className="ml-1 text-xs text-zinc-500">({myVehicles.length})</span>
                )}
              </span>
            </div>
          </button>
        </Link>

        {/* Historial */}
        <Link to="/visits">
          <button className="w-full h-32 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-md transition-all group">
            <div className="flex flex-col items-center justify-center gap-2 h-full">
              <div className="p-3 bg-amber-100 dark:bg-amber-500/10 rounded-lg group-hover:bg-amber-200 dark:group-hover:bg-amber-500/20 transition-colors">
                <DocumentTextIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Historial
              </span>
            </div>
          </button>
        </Link>
      </div>
    </div>
  );
}
