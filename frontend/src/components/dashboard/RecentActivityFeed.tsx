import { 
  CheckCircleIcon, 
  ExclamationTriangleIcon, 
  XCircleIcon, 
  InformationCircleIcon 
} from '@heroicons/react/24/outline';
import type { RecentActivityItem } from '../../types/dashboard';

interface RecentActivityFeedProps {
  activities: RecentActivityItem[];
  loading?: boolean;
}

export function RecentActivityFeed({ activities, loading = false }: RecentActivityFeedProps) {
  const getSeverityIcon = (severity?: RecentActivityItem['severity']) => {
    switch (severity) {
      case 'success':
        return <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />;
      case 'warning':
        return <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
      case 'error':
        return <XCircleIcon className="h-5 w-5 text-red-600 dark:text-red-400" />;
      default:
        return <InformationCircleIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
    }
  };

  const getTypeColor = (type: RecentActivityItem['type']) => {
    switch (type) {
      case 'detection':
        return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400';
      case 'visit':
        return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400';
      case 'audit':
        return 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400';
      case 'error':
        return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400';
      case 'notification':
        return 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400';
    }
  };

  const getTypeLabel = (type: RecentActivityItem['type']) => {
    switch (type) {
      case 'detection':
        return 'Detección';
      case 'visit':
        return 'Visita';
      case 'audit':
        return 'Auditoría';
      case 'error':
        return 'Error';
      case 'notification':
        return 'Notificación';
    }
  };

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Hace un momento';
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffHours < 24) return `Hace ${diffHours} h`;
    return `Hace ${diffDays} d`;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-48 mb-6 animate-pulse"></div>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
          Actividad Reciente
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
          No hay actividad reciente
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
        Actividad Reciente
      </h3>
      <div className="space-y-3">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex-shrink-0 mt-0.5">
              {getSeverityIcon(activity.severity)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(
                    activity.type
                  )}`}
                >
                  {getTypeLabel(activity.type)}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatRelativeTime(activity.timestamp)}
                </span>
              </div>
              <p className="text-sm text-zinc-900 dark:text-zinc-100">{activity.message}</p>
              {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {Object.entries(activity.metadata)
                    .filter(([key]) => !['plate', 'visitorName', 'userName'].includes(key))
                    .slice(0, 2)
                    .map(([key, value]) => (
                      <span key={key} className="mr-3">
                        {key}: {String(value)}
                      </span>
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
