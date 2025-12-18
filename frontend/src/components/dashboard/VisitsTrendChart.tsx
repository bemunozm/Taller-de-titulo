import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { PerformanceTrendData } from '../../types/dashboard';

interface VisitsTrendChartProps {
  data: PerformanceTrendData[];
  loading?: boolean;
}

export function VisitsTrendChart({ data, loading = false }: VisitsTrendChartProps) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-48 mb-6 animate-pulse"></div>
        <div className="h-80 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
        Tendencia de Visitas y Detecciones
      </h3>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-700" />
          <XAxis
            dataKey="date"
            className="text-xs text-zinc-600 dark:text-zinc-400"
            tickFormatter={(value) => {
              const date = new Date(value);
              return `${date.getDate()}/${date.getMonth() + 1}`;
            }}
          />
          <YAxis className="text-xs text-zinc-600 dark:text-zinc-400" />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgb(24 24 27)',
              border: '1px solid rgb(63 63 70)',
              borderRadius: '0.5rem',
              color: 'rgb(244 244 245)',
            }}
            labelFormatter={(value) => {
              const date = new Date(value);
              return date.toLocaleDateString('es-ES', { 
                weekday: 'short', 
                day: 'numeric', 
                month: 'short' 
              });
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="visits"
            name="Total Visitas"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="vehicular"
            name="Vehicular"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="pedestrian"
            name="Peatonal"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="detections"
            name="Detecciones LPR"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
