import api from '@/lib/axios';
import type { SystemLog, SystemLogQuery, SystemLogStats, PaginatedSystemLogs } from '@/types/logs';

export async function getSystemLogs(params: SystemLogQuery): Promise<PaginatedSystemLogs> {
  const { data } = await api.get('/logs', { params });
  return data;
}

export async function getSystemLogById(id: string): Promise<SystemLog> {
  const { data } = await api.get(`/logs/${id}`);
  return data;
}

export async function getSystemLogStats(startDate?: string, endDate?: string): Promise<SystemLogStats> {
  const params: any = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  
  const { data } = await api.get('/logs/stats', { params });
  return data;
}

export async function getLogsByCorrelationId(correlationId: string): Promise<SystemLog[]> {
  const { data } = await api.get(`/logs`, { 
    params: { correlationId } 
  });
  return data.data; // Extrae el array de data de la respuesta paginada
}
