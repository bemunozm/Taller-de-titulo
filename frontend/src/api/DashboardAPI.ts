import api from '@/lib/axios';
import type {
  DashboardSummary,
  PerformanceTrendData,
  RecentActivityItem,
  PlateDetection,
  DetectionHourlyData,
  CameraActivityData,
  VisitTypeDistribution,
  ErrorTrendData,
  DashboardQueryParams,
  VisitsTrendQueryParams,
  RecentActivityQueryParams,
  DetectionsQueryParams,
} from '../types/dashboard';
import {
  dashboardSummarySchema,
  performanceTrendDataSchema,
  recentActivityItemSchema,
  plateDetectionSchema,
  detectionHourlyDataSchema,
  cameraActivityDataSchema,
  visitTypeDistributionSchema,
  errorTrendDataSchema,
} from '../types/dashboard';
import { z } from 'zod';
import { isAxiosError } from 'axios';

// Tipos para las métricas de tiempo de respuesta
export type ResponseTimeMetrics = {
  avgResponseTimeMs: number
  minResponseTimeMs: number
  maxResponseTimeMs: number
  medianResponseTimeMs: number
  totalDetections: number
  detectionsUnder5s: number
  complianceRate: number
  byDecision: {
    Permitido?: { avgMs: number; count: number }
    Denegado?: { avgMs: number; count: number }
    Pendiente?: { avgMs: number; count: number }
  }
  slaTarget: number
  period: string
  startDate: Date
  endDate: Date
}

const DashboardAPI = {
  /**
   * Obtener resumen completo del dashboard
   */
  getSummary: async (params?: DashboardQueryParams): Promise<DashboardSummary> => {
    try {
      const response = await api.get('/dashboard/summary', { params });
      console.log('Dashboard Summary Raw Response:', response.data);
      
      // Intentar parsear con el schema
      const result = dashboardSummarySchema.safeParse(response.data);
      
      if (!result.success) {
        console.error('Dashboard Summary Parse Error:', result.error);
        console.error('Validation errors:', result.error.errors);
        throw new Error('Error al parsear los datos del dashboard: ' + result.error.message);
      }
      
      console.log('Dashboard Summary Parsed Successfully:', result.data);
      return result.data;
    } catch (error: any) {
      console.error('Error fetching dashboard summary:', error);
      console.error('Error details:', error.response?.data);
      throw error;
    }
  },

  /**
   * Obtener tendencia de visitas por días
   */
  getVisitsTrend: async (params?: VisitsTrendQueryParams): Promise<PerformanceTrendData[]> => {
    const response = await api.get('/dashboard/visits/trend', { params });
    return z.array(performanceTrendDataSchema).parse(response.data);
  },

  /**
   * Obtener actividad reciente del sistema
   */
  getRecentActivity: async (params?: RecentActivityQueryParams): Promise<RecentActivityItem[]> => {
    const response = await api.get('/dashboard/activity/recent', { params });
    return z.array(recentActivityItemSchema).parse(response.data);
  },

  /**
   * Obtener últimas detecciones con detalles
   */
  getLatestDetections: async (params?: DetectionsQueryParams): Promise<PlateDetection[]> => {
    const response = await api.get('/dashboard/detections/latest', { params });
    return z.array(plateDetectionSchema).parse(response.data);
  },

  /**
   * Obtener distribución de detecciones por hora del día
   */
  getDetectionsByHour: async (): Promise<DetectionHourlyData[]> => {
    const response = await api.get('/dashboard/detections/hourly');
    return z.array(detectionHourlyDataSchema).parse(response.data);
  },

  /**
   * Obtener actividad de detecciones por cámara
   */
  getCameraActivity: async (): Promise<CameraActivityData[]> => {
    const response = await api.get('/dashboard/cameras/activity');
    return z.array(cameraActivityDataSchema).parse(response.data);
  },

  /**
   * Obtiene métricas detalladas del tiempo de respuesta del sistema
   * @param period - Período de tiempo: 'today', 'week', 'month', 'custom'
   * @param startDate - Fecha de inicio para período custom
   * @param endDate - Fecha de fin para período custom
   */
  getResponseTimeMetrics: async (
    period: 'today' | 'week' | 'month' | 'custom' = 'today',
    startDate?: string,
    endDate?: string
  ): Promise<ResponseTimeMetrics> => {
    try {
      const params = new URLSearchParams({ period })
      if (startDate) params.append('startDate', startDate)
      if (endDate) params.append('endDate', endDate)

      const { data } = await api.get<ResponseTimeMetrics>(`/dashboard/metrics/response-time?${params}`)
      return data
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Error al obtener métricas de tiempo de respuesta')
      }
      throw error
    }
  },

  /**
   * Obtener distribución de tipos de visitas
   */
  getVisitTypeDistribution: async (): Promise<VisitTypeDistribution> => {
    const response = await api.get('/dashboard/visits/distribution');
    return visitTypeDistributionSchema.parse(response.data);
  },

  /**
   * Obtener tendencias de errores por servicio
   */
  getErrorTrends: async (): Promise<ErrorTrendData[]> => {
    const response = await api.get('/dashboard/errors/trends');
    return z.array(errorTrendDataSchema).parse(response.data);
  },
};

export default DashboardAPI;
