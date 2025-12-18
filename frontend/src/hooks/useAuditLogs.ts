import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAuditLogs, getAuditStats } from '@/api/AuditAPI';
import type { AuditLogQuery, PaginatedAuditLogs, AuditStats } from '@/types/audit';

export function useAuditLogs(initialQuery: AuditLogQuery = {}) {
  const [query, setQuery] = useState<AuditLogQuery>({
    page: 1,
    limit: 20,
    ...initialQuery
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['auditLogs', query],
    queryFn: () => getAuditLogs(query)
  });

  const updateQuery = (updates: Partial<AuditLogQuery>) => {
    setQuery(prev => ({ ...prev, ...updates }));
  };

  const resetFilters = () => {
    setQuery({ page: 1, limit: 20 });
  };

  return {
    data,
    isLoading,
    error,
    query,
    updateQuery,
    resetFilters,
    refetch
  };
}

export function useAuditStats(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['auditStats', startDate, endDate],
    queryFn: () => getAuditStats(startDate, endDate)
  });
}
