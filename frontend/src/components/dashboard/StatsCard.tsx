import type { ReactNode } from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    label: string;
    isPositive?: boolean;
  };
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'indigo' | 'zinc';
  loading?: boolean;
}

export function StatsCard({
  title,
  value,
  description,
  icon,
  trend,
  color = 'blue',
  loading = false,
}: StatsCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
    red: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400',
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400',
    zinc: 'bg-zinc-50 text-zinc-600 dark:bg-zinc-500/10 dark:text-zinc-400',
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-24"></div>
          <div className="h-10 w-10 bg-zinc-200 dark:bg-zinc-800 rounded-lg"></div>
        </div>
        <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded w-32 mb-2"></div>
        <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-40"></div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{title}</h3>
        {icon && (
          <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-3">
        <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
        {trend && (
          <span
            className={`text-sm font-medium ${
              trend.isPositive
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      {description && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">{description}</p>
      )}
      {trend?.label && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{trend.label}</p>
      )}
    </div>
  );
}
