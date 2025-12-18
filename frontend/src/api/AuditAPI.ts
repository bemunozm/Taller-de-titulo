import api from '@/lib/axios';
import type { AuditLog, AuditLogQuery, AuditStats, PaginatedAuditLogs } from '@/types/audit';

export async function getAuditLogs(params: AuditLogQuery): Promise<PaginatedAuditLogs> {
  const { data } = await api.get('/audit', { params });
  return data;
}

export async function getAuditLogById(id: string): Promise<AuditLog> {
  const { data } = await api.get(`/audit/${id}`);
  return data;
}

export async function getEntityHistory(entityType: string, entityId: string): Promise<AuditLog[]> {
  const { data } = await api.get(`/audit/entity/${entityType}/${entityId}`);
  return data;
}

export async function getAuditStats(startDate?: string, endDate?: string): Promise<AuditStats> {
  const params: any = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  
  const { data } = await api.get('/audit/stats', { params });
  return data;
}
