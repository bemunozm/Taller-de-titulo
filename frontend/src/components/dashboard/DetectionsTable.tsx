import type { PlateDetection } from '../../types/dashboard';

interface DetectionsTableProps {
  detections: PlateDetection[];
  loading?: boolean;
}

export function DetectionsTable({ detections, loading = false }: DetectionsTableProps) {
  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Hace un momento';
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffHours < 24) return `Hace ${diffHours} h`;
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (!confidence) return 'text-zinc-400';
    if (confidence >= 0.8) return 'text-green-600 dark:text-green-400';
    if (confidence >= 0.6) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-48 mb-6 animate-pulse"></div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (detections.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
          Últimas Detecciones
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
          No hay detecciones recientes
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
        Últimas Detecciones LPR
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Patente
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Cámara
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Confianza Det.
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Confianza OCR
              </th>
              <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Tiempo
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {detections.map((detection) => (
              <tr
                key={detection.id}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <td className="py-3 px-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {detection.plate}
                    </span>
                    {detection.plate_raw && detection.plate_raw !== detection.plate && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        Raw: {detection.plate_raw}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">
                    {detection.cameraId}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`text-sm font-medium ${getConfidenceColor(
                      detection.det_confidence
                    )}`}
                  >
                    {detection.det_confidence
                      ? `${(detection.det_confidence * 100).toFixed(1)}%`
                      : 'N/A'}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`text-sm font-medium ${getConfidenceColor(
                      detection.ocr_confidence
                    )}`}
                  >
                    {detection.ocr_confidence
                      ? `${(detection.ocr_confidence * 100).toFixed(1)}%`
                      : 'N/A'}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {formatRelativeTime(detection.createdAt)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
