import { z } from 'zod';

// ==================== Security Stats ====================
export const securityStatsSchema = z.object({
  detectionsToday: z.number(),
  detectionsWeek: z.number(),
  detectionsMonth: z.number(),
  activeVisits: z.number(),
  pendingVisits: z.number(),
  completedVisitsToday: z.number(),
  unauthorizedVehicles: z.number(),
  alertsPending: z.number(),
  avgVisitDuration: z.number(),
});

export type SecurityStats = z.infer<typeof securityStatsSchema>;

// ==================== Service Health ====================
export const serviceHealthSchema = z.object({
  name: z.string(),
  status: z.enum(['healthy', 'degraded', 'down']),
  uptime: z.number(),
  lastCheck: z.string().transform((val) => new Date(val)),
  responseTime: z.number().optional(),
  details: z.record(z.any()).optional(),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;

// ==================== System Health Stats ====================
export const systemHealthStatsSchema = z.object({
  camerasActive: z.number(),
  camerasTotal: z.number(),
  camerasInactive: z.number(),
  errorRateLast24h: z.number(),
  avgResponseTime: z.number(),
  totalLogsToday: z.number(),
  criticalErrorsToday: z.number(),
  services: z.array(serviceHealthSchema),
});

export type SystemHealthStats = z.infer<typeof systemHealthStatsSchema>;

// ==================== Audit Action Count ====================
export const auditActionCountSchema = z.object({
  module: z.string(),
  action: z.string(),
  count: z.number(),
});

export type AuditActionCount = z.infer<typeof auditActionCountSchema>;

// ==================== User Activity Stats ====================
export const userActivityStatsSchema = z.object({
  activeFamilies: z.number(),
  totalFamilies: z.number(),
  totalUsers: z.number(),
  activeUsersToday: z.number(),
  activeUsersWeek: z.number(),
  newUsersThisWeek: z.number(),
  topAuditActions: z.array(auditActionCountSchema),
  notificationsSentToday: z.number(),
  conciergeSessionsToday: z.number(),
});

export type UserActivityStats = z.infer<typeof userActivityStatsSchema>;

// ==================== Dashboard Summary ====================
export const dashboardSummarySchema = z.object({
  security: securityStatsSchema,
  systemHealth: systemHealthStatsSchema,
  userActivity: userActivityStatsSchema,
  lastUpdated: z.string().transform((val) => new Date(val)),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

// ==================== Performance Trend Data ====================
export const performanceTrendDataSchema = z.object({
  date: z.string(),
  visits: z.number(),
  vehicular: z.number(),
  pedestrian: z.number(),
  detections: z.number(),
  avgResponseTime: z.number(),
});

export type PerformanceTrendData = z.infer<typeof performanceTrendDataSchema>;

// ==================== Detection Hourly Data ====================
export const detectionHourlyDataSchema = z.object({
  hour: z.number(),
  count: z.number(),
});

export type DetectionHourlyData = z.infer<typeof detectionHourlyDataSchema>;

// ==================== Camera Activity Data ====================
export const cameraActivityDataSchema = z.object({
  cameraId: z.string(),
  cameraName: z.string(),
  location: z.string(),
  detectionsToday: z.number(),
  isActive: z.boolean(),
});

export type CameraActivityData = z.infer<typeof cameraActivityDataSchema>;

// ==================== Recent Activity Item ====================
export const recentActivityItemSchema = z.object({
  id: z.string(),
  type: z.enum(['detection', 'visit', 'audit', 'error', 'notification']),
  message: z.string(),
  timestamp: z.string().transform((val) => new Date(val)),
  severity: z.enum(['info', 'warning', 'error', 'success']).optional(),
  metadata: z.record(z.any()).optional(),
});

export type RecentActivityItem = z.infer<typeof recentActivityItemSchema>;

// ==================== Visit Type Distribution ====================
export const visitTypeDistributionSchema = z.object({
  vehicular: z.number(),
  pedestrian: z.number(),
  total: z.number(),
  vehicularPercent: z.number(),
  pedestrianPercent: z.number(),
});

export type VisitTypeDistribution = z.infer<typeof visitTypeDistributionSchema>;

// ==================== Error Trend Data ====================
export const errorTrendDataSchema = z.object({
  service: z.string(),
  errorCount: z.number(),
  trend: z.enum(['increasing', 'stable', 'decreasing']),
  lastError: z.string().transform((val) => new Date(val)),
});

export type ErrorTrendData = z.infer<typeof errorTrendDataSchema>;

// ==================== Plate Detection (para latest detections) ====================
export const plateDetectionSchema = z.object({
  id: z.string(),
  cameraId: z.string(),
  plate: z.string(),
  plate_raw: z.string().nullable(),
  det_confidence: z.number().nullable(),
  ocr_confidence: z.number().nullable(),
  full_frame_path: z.string().nullable(),
  meta: z.record(z.any()).nullable(),
  createdAt: z.string().transform((val) => new Date(val)),
});

export type PlateDetection = z.infer<typeof plateDetectionSchema>;

// ==================== Query Parameters ====================
export interface DashboardQueryParams {
  period?: 'today' | 'week' | 'month' | 'custom';
  startDate?: string;
  endDate?: string;
}

export interface VisitsTrendQueryParams {
  days?: number;
}

export interface RecentActivityQueryParams {
  limit?: number;
  type?: 'detection' | 'visit' | 'audit' | 'error' | 'notification';
}

export interface DetectionsQueryParams {
  limit?: number;
  matchedOnly?: boolean;
}
