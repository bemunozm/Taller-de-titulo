import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarIcon,
  ClockIcon,
  QrCodeIcon,
  TruckIcon,
  UserIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Visit } from '@/types/index';
import { formatDateTime } from '@/helpers/index';

interface MyVisitsCardProps {
  activeVisits: Visit[];
  upcomingVisits: Visit[];
  recentCompletedVisits: Visit[];
  loading: boolean;
}

type TabType = 'active' | 'upcoming' | 'recent';

export function MyVisitsCard({ activeVisits, upcomingVisits, recentCompletedVisits, loading }: MyVisitsCardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('active');

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3"></div>
          <div className="space-y-3">
            <div className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
            <div className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
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
            <CalendarIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Mis Visitas
            </h3>
          </div>
          <Link to="/visits">
            <Button plain>Ver todas</Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex">
          <button 
            onClick={() => setActiveTab('active')}
            className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'active'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            Activas ({activeVisits.length})
          </button>
          <button 
            onClick={() => setActiveTab('upcoming')}
            className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'upcoming'
                ? 'border-amber-600 text-amber-600 dark:text-amber-400'
                : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            Próximas ({upcomingVisits.length})
          </button>
          <button 
            onClick={() => setActiveTab('recent')}
            className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'recent'
                ? 'border-green-600 text-green-600 dark:text-green-400'
                : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            Recientes ({recentCompletedVisits.length})
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeVisits.length === 0 && upcomingVisits.length === 0 && recentCompletedVisits.length === 0 ? (
          <div className="text-center py-8">
            <CalendarIcon className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No tienes visitas registradas
            </p>
            <Link to="/visits">
              <Button color="indigo" className="mt-4">
                Crear primera visita
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Visitas Activas */}
            {activeTab === 'active' && (
              <>
                {activeVisits.length === 0 ? (
                  <div className="text-center py-8">
                    <CalendarIcon className="h-10 w-10 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      No tienes visitas activas
                    </p>
                  </div>
                ) : (
                  activeVisits.slice(0, 5).map(visit => (
                    <Link
                      key={visit.id}
                      to={`/visits`}
                      className="block p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="p-2 bg-blue-100 dark:bg-blue-500/10 rounded-lg">
                            {visit.type === 'vehicular' ? (
                              <TruckIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            ) : (
                              <UserIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                                {visit.visitorName}
                              </p>
                              <Badge color="lime">Activa</Badge>
                            </div>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                              {visit.type === 'vehicular' && visit.vehicle && (
                                <span className="font-mono">{visit.vehicle.plate}</span>
                              )}
                              {visit.type === 'pedestrian' && visit.qrCode && (
                                <span className="flex items-center gap-1">
                                  <QrCodeIcon className="h-4 w-4" />
                                  Código QR generado
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                              Válida hasta: {formatDateTime(visit.validUntil)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Usos: {visit.usedCount}/{visit.maxUses || '∞'}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </>
            )}

            {/* Próximas Visitas */}
            {activeTab === 'upcoming' && (
              <>
                {upcomingVisits.length === 0 ? (
                  <div className="text-center py-8">
                    <ClockIcon className="h-10 w-10 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      No tienes visitas próximas programadas
                    </p>
                  </div>
                ) : (
                  upcomingVisits.slice(0, 5).map(visit => (
                    <Link
                      key={visit.id}
                      to={`/visits`}
                      className="block p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-amber-300 dark:hover:border-amber-700 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-amber-100 dark:bg-amber-500/10 rounded-lg">
                          <ClockIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-zinc-900 dark:text-zinc-100">
                              {visit.visitorName}
                            </p>
                            <Badge color="amber">Programada</Badge>
                          </div>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                            {visit.type === 'vehicular' && visit.vehicle && (
                              <span className="font-mono">{visit.vehicle.plate}</span>
                            )}
                            {visit.type === 'pedestrian' && (
                              <span className="flex items-center gap-1">
                                <UserIcon className="h-4 w-4" />
                                Visita peatonal
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            Comienza: {formatDateTime(visit.validFrom)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </>
            )}

            {/* Visitas Recientes */}
            {activeTab === 'recent' && (
              <>
                {recentCompletedVisits.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircleIcon className="h-10 w-10 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      No tienes visitas recientes completadas
                    </p>
                  </div>
                ) : (
                  recentCompletedVisits.slice(0, 5).map(visit => (
                    <Link
                      key={visit.id}
                      to={`/visits`}
                      className="block p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-green-300 dark:hover:border-green-700 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-green-100 dark:bg-green-500/10 rounded-lg">
                          <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-zinc-900 dark:text-zinc-100">
                              {visit.visitorName}
                            </p>
                            <Badge color="sky">Completada</Badge>
                          </div>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                            {visit.type === 'vehicular' && visit.vehicle && (
                              <span className="font-mono">{visit.vehicle.plate}</span>
                            )}
                            {visit.type === 'pedestrian' && (
                              <span className="flex items-center gap-1">
                                <UserIcon className="h-4 w-4" />
                                Visita peatonal
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            Salida: {visit.exitTime ? formatDateTime(visit.exitTime) : '-'}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </>
            )}

            {/* Ver más si hay más visitas */}
            {((activeTab === 'active' && activeVisits.length > 5) ||
              (activeTab === 'upcoming' && upcomingVisits.length > 5) ||
              (activeTab === 'recent' && recentCompletedVisits.length > 5)) && (
              <Link to="/visits">
                <Button plain className="w-full mt-2">
                  Ver todas
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
