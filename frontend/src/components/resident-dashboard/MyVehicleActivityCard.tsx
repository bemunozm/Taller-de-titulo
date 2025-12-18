import { Link } from 'react-router-dom';
import {
  TruckIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Vehicle } from '@/types/index';
import type { PlateDetection } from '@/api/DetectionsAPI';
import { formatRelativeTime } from '@/helpers/index';

interface MyVehicleActivityCardProps {
  myVehicles: Vehicle[];
  myDetections: PlateDetection[];
  loading: boolean;
}

export function MyVehicleActivityCard({ myVehicles, myDetections, loading }: MyVehicleActivityCardProps) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3"></div>
          <div className="space-y-3">
            <div className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
            <div className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
      {/* Header */}
      <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TruckIcon className="h-6 w-6 text-green-600 dark:text-green-400" />
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Actividad de Mis Vehículos
            </h3>
          </div>
          <Link to="/vehicles">
            <Button plain>Ver vehículos</Button>
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {myVehicles.length === 0 ? (
          <div className="text-center py-8">
            <TruckIcon className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No tienes vehículos registrados
            </p>
            <Link to="/vehicles/new">
              <Button color="indigo" className="mt-4">
                Registrar vehículo
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Lista de Vehículos */}
            <div>
              <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
                Mis Vehículos ({myVehicles.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {myVehicles.map(vehicle => {
                  const vehicleDetections = myDetections.filter(
                    d => d.plate.toUpperCase() === vehicle.plate.toUpperCase()
                  );
                  const lastDetection = vehicleDetections[0];

                  return (
                    <div
                      key={vehicle.id}
                      className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-mono font-semibold text-lg text-zinc-900 dark:text-zinc-100">
                            {vehicle.plate}
                          </p>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {vehicle.brand} {vehicle.model}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {vehicle.color}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge color={vehicleDetections.length > 0 ? 'green' : 'zinc'}>
                            {vehicleDetections.length} detecciones
                          </Badge>
                          {lastDetection && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                              Última: {formatRelativeTime(lastDetection.createdAt)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Detecciones Recientes */}
            {myDetections.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
                  Detecciones Recientes (últimos 7 días)
                </h4>
                <div className="space-y-2">
                  {myDetections.slice(0, 3).map(detection => {
                    const vehicle = myVehicles.find(
                      v => v.plate.toUpperCase() === detection.plate.toUpperCase()
                    );

                    return (
                      <div
                        key={detection.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-100 dark:bg-green-500/10 rounded">
                            <MapPinIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                          </div>
                          <div>
                            <p className="font-mono font-medium text-sm text-zinc-900 dark:text-zinc-100">
                              {detection.plate}
                            </p>
                            {vehicle && (
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {vehicle.brand} {vehicle.model}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {formatRelativeTime(detection.createdAt)}
                          </p>
                          {detection.det_confidence && (
                            <p className="text-xs text-zinc-400 dark:text-zinc-500">
                              Conf: {(detection.det_confidence * 100).toFixed(0)}%
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {myDetections.length > 5 && (
                  <Link to="/detections">
                    <Button plain className="w-full mt-3">
                      Ver todas las detecciones ({myDetections.length})
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
