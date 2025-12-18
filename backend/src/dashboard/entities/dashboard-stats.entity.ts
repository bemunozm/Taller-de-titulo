// Interfaces para las estadísticas del dashboard
// No son entidades de base de datos, sino DTOs de respuesta

export interface SecurityStats {
  detectionsToday: number;
  detectionsWeek: number;
  detectionsMonth: number;
  activeVisits: number;
  pendingVisits: number;
  completedVisitsToday: number;
  unauthorizedVehicles: number;
  alertsPending: number;
  avgVisitDuration: number; // en minutos
  avgResponseTime: number; // en milisegundos (T2 - T1)
}

export interface SystemHealthStats {
  camerasActive: number;
  camerasTotal: number;
  camerasInactive: number;
  errorRateLast24h: number; // porcentaje
  avgResponseTime: number; // en ms
  totalLogsToday: number;
  criticalErrorsToday: number;
  services: ServiceHealth[];
}

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime: number; // porcentaje
  lastCheck: Date;
  responseTime?: number;
  details?: Record<string, any>;
}

export interface UserActivityStats {
  activeFamilies: number;
  totalFamilies: number;
  totalUsers: number;
  activeUsersToday: number;
  activeUsersWeek: number;
  newUsersThisWeek: number;
  topAuditActions: AuditActionCount[];
  notificationsSentToday: number;
  conciergeSessionsToday: number;
}

export interface AuditActionCount {
  module: string;
  action: string;
  count: number;
}

export interface PerformanceTrendData {
  date: string;
  visits: number;
  vehicular: number;
  pedestrian: number;
  detections: number;
  avgResponseTime: number;
}

export interface DetectionHourlyData {
  hour: number;
  count: number;
}

export interface CameraActivityData {
  cameraId: string;
  cameraName: string;
  location: string;
  detectionsToday: number;
  isActive: boolean;
}

export interface RecentActivityItem {
  id: string;
  type: 'detection' | 'visit' | 'audit' | 'error' | 'notification';
  message: string;
  timestamp: Date;
  severity?: 'info' | 'warning' | 'error' | 'success';
  metadata?: Record<string, any>;
}

export interface DashboardSummary {
  security: SecurityStats;
  systemHealth: SystemHealthStats;
  userActivity: UserActivityStats;
  lastUpdated: Date;
}

export interface VisitTypeDistribution {
  vehicular: number;
  pedestrian: number;
  total: number;
  vehicularPercent: number;
  pedestrianPercent: number;
}

export interface ErrorTrendData {
  service: string;
  errorCount: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  lastError: Date;
}
