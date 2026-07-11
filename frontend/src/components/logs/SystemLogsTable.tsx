import { useState, useEffect, useCallback } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, InputGroup } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { SystemLog, LogLevel, LogType, ServiceName } from '@/types/logs';

const columnHelper = createColumnHelper<SystemLog>();

// Helper para formatear tiempo relativo
const formatRelativeTime = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - dateObj.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `hace ${days} día${days > 1 ? 's' : ''}`;
  if (hours > 0) return `hace ${hours} hora${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
  return `hace ${seconds} segundo${seconds !== 1 ? 's' : ''}`;
};

// Helper para color de badges según nivel
const getLevelColor = (level: LogLevel) => {
  const colors: Record<LogLevel, 'zinc' | 'sky' | 'amber' | 'red' | 'rose'> = {
    DEBUG: 'zinc',
    INFO: 'sky',
    WARN: 'amber',
    ERROR: 'red',
    FATAL: 'rose',
  };
  return colors[level] || 'zinc';
};

// Helper para color de badges según tipo
const getTypeColor = (type: LogType) => {
  const colors: Record<LogType, 'blue' | 'indigo' | 'purple' | 'pink' | 'emerald' | 'cyan' | 'teal' | 'violet' | 'fuchsia' | 'lime' | 'zinc' | 'red'> = {
    HTTP_REQUEST: 'blue',
    HTTP_RESPONSE: 'indigo',
    MEDIAMTX_API: 'purple',
    WORKER_API: 'pink',
    OPENAI_API: 'emerald',
    DATABASE: 'cyan',
    WEBSOCKET: 'teal',
    STREAM: 'violet',
    DETECTION: 'fuchsia',
    NOTIFICATION: 'lime',
    SYSTEM: 'zinc',
    EXCEPTION: 'red',
  };
  return colors[type] || 'zinc';
};

// Helper para color de badges según servicio
const getServiceColor = (service: ServiceName) => {
  const colors: Record<ServiceName, 'indigo' | 'purple' | 'pink' | 'emerald' | 'cyan' | 'red' | 'blue' | 'zinc'> = {
    BACKEND: 'indigo',
    MEDIAMTX: 'purple',
    WORKER_PYTHON: 'pink',
    OPENAI: 'emerald',
    DATABASE: 'cyan',
    REDIS: 'red',
    FRONTEND: 'blue',
  };
  return colors[service] || 'zinc';
};

const columns = [
  columnHelper.accessor('createdAt', {
    header: 'Fecha',
    cell: (info) => {
      const date = typeof info.getValue() === 'string' ? new Date(info.getValue()) : info.getValue();
      return (
        <div className="text-sm">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {date.toLocaleString('es-CL', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {formatRelativeTime(info.getValue())}
          </div>
        </div>
      );
    },
  }),
  columnHelper.accessor('level', {
    header: 'Nivel',
    cell: (info) => <Badge color={getLevelColor(info.getValue())}>{info.getValue()}</Badge>,
  }),
  columnHelper.accessor('service', {
    header: 'Servicio',
    cell: (info) => <Badge color={getServiceColor(info.getValue())}>{info.getValue()}</Badge>,
  }),
  columnHelper.accessor('type', {
    header: 'Tipo',
    cell: (info) => (
      <Badge color={getTypeColor(info.getValue())} className="text-xs">
        {info.getValue().replace(/_/g, ' ')}
      </Badge>
    ),
  }),
  columnHelper.accessor('message', {
    header: 'Mensaje',
    cell: (info) => (
      <div className="max-w-md">
        <div className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2">
          {info.getValue()}
        </div>
        {info.row.original.errorMessage && (
          <div className="text-xs text-red-600 dark:text-red-400 mt-1 line-clamp-1">
            Error: {info.row.original.errorMessage}
          </div>
        )}
      </div>
    ),
  }),
  columnHelper.accessor('responseTime', {
    header: 'Tiempo (ms)',
    cell: (info) => {
      const time = info.getValue();
      if (!time) return <span className="text-zinc-400">-</span>;
      
      let color = 'text-lime-600 dark:text-lime-400';
      if (time > 1000) color = 'text-amber-600 dark:text-amber-400';
      if (time > 3000) color = 'text-red-600 dark:text-red-400';
      
      return <span className={`text-sm font-mono ${color}`}>{time}ms</span>;
    },
  }),
  columnHelper.accessor('statusCode', {
    header: 'Status',
    cell: (info) => {
      const status = info.getValue();
      if (!status) return <span className="text-zinc-400">-</span>;
      
      let color = 'text-lime-600 dark:text-lime-400';
      if (status >= 400 && status < 500) color = 'text-amber-600 dark:text-amber-400';
      if (status >= 500) color = 'text-red-600 dark:text-red-400';
      
      return <span className={`text-sm font-mono font-medium ${color}`}>{status}</span>;
    },
  }),
  columnHelper.accessor('correlationId', {
    header: 'Correlation ID',
    cell: (info) => {
      const id = info.getValue();
      if (!id) return <span className="text-zinc-400">-</span>;
      
      return (
        <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
          {id.substring(0, 8)}...
        </code>
      );
    },
  }),
];

interface SystemLogsTableProps {
  logs: SystemLog[];
}

export function SystemLogsTable({ logs }: SystemLogsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true }
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const table = useReactTable({
    data: logs,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    initialState: {
      pagination: {
        pageSize: 20,
      },
    },
  });

  const exportFilteredData = useCallback(() => {
    const filteredRows = table.getFilteredRowModel().rows.map(row => row.original);
    
    if (filteredRows.length === 0) {
      return;
    }

    const rows = filteredRows.map(log => ({
      fecha: new Date(log.createdAt).toISOString().replace('T', ' ').slice(0, 19),
      nivel: log.level,
      servicio: log.service,
      codigo_estado: log.statusCode || '-',
      metodo: log.method || '-',
      url: log.url || '-',
      tiempo_respuesta: log.responseTime ? `${log.responseTime}ms` : '-',
      mensaje: log.message,
      ip: log.ipAddress || '-',
    }));

    const header = Object.keys(rows[0]).join(',');
    const body = rows
      .map((row) => Object.values(row)
        .map((v) => {
          if (v === null || v === undefined) return '';
          const s = String(v);
          return '"' + s.replace(/"/g, '""') + '"';
        })
        .join(','))
      .join('\n');

    const csv = '\uFEFF' + header + '\n' + body;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [table]);

  useEffect(() => {
    function onExport() {
      exportFilteredData();
    }

    window.addEventListener('system-logs:export-csv', onExport as EventListener);
    return () => {
      window.removeEventListener('system-logs:export-csv', onExport as EventListener);
    };
  }, [exportFilteredData]);

  const hasActiveFilters = globalFilter || columnFilters.length > 0;

  return (
    <div className="space-y-4">
      {/* Search & Filters */}
      <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <InputGroup className="flex-1">
              <MagnifyingGlassIcon />
              <Input
                name="search"
                placeholder="Buscar en todos los campos..."
                value={globalFilter ?? ''}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
            </InputGroup>
            <Button 
              outline 
              onClick={() => setShowFilters(!showFilters)}
              className={showFilters ? 'bg-zinc-100 dark:bg-zinc-700' : ''}
            >
              <FunnelIcon />
              Filtros
            </Button>
            {hasActiveFilters && (
              <Button 
                plain 
                onClick={() => {
                  setGlobalFilter('');
                  setColumnFilters([]);
                }}
              >
                <XMarkIcon />
                Limpiar
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <div>
                <label className="text-sm font-medium mb-1 block text-zinc-700 dark:text-zinc-300">
                  Nivel
                </label>
                <Select
                  value={(columnFilters.find(f => f.id === 'level')?.value as string) ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) {
                      table.getColumn('level')?.setFilterValue(value);
                    } else {
                      table.getColumn('level')?.setFilterValue(undefined);
                    }
                  }}
                >
                  <option value="">Todos los niveles</option>
                  <option value="DEBUG">DEBUG</option>
                  <option value="INFO">INFO</option>
                  <option value="WARN">WARN</option>
                  <option value="ERROR">ERROR</option>
                  <option value="FATAL">FATAL</option>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block text-zinc-700 dark:text-zinc-300">
                  Servicio
                </label>
                <Select
                  value={(columnFilters.find(f => f.id === 'service')?.value as string) ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) {
                      table.getColumn('service')?.setFilterValue(value);
                    } else {
                      table.getColumn('service')?.setFilterValue(undefined);
                    }
                  }}
                >
                  <option value="">Todos los servicios</option>
                  <option value="BACKEND">BACKEND</option>
                  <option value="MEDIAMTX">MEDIAMTX</option>
                  <option value="WORKER_PYTHON">WORKER_PYTHON</option>
                  <option value="OPENAI">OPENAI</option>
                  <option value="DATABASE">DATABASE</option>
                  <option value="REDIS">REDIS</option>
                  <option value="FRONTEND">FRONTEND</option>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block text-zinc-700 dark:text-zinc-300">
                  Tipo
                </label>
                <Select
                  value={(columnFilters.find(f => f.id === 'type')?.value as string) ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) {
                      table.getColumn('type')?.setFilterValue(value);
                    } else {
                      table.getColumn('type')?.setFilterValue(undefined);
                    }
                  }}
                >
                  <option value="">Todos los tipos</option>
                  <option value="HTTP_REQUEST">HTTP REQUEST</option>
                  <option value="HTTP_RESPONSE">HTTP RESPONSE</option>
                  <option value="MEDIAMTX_API">MEDIAMTX API</option>
                  <option value="WORKER_API">WORKER API</option>
                  <option value="OPENAI_API">OPENAI API</option>
                  <option value="DATABASE">DATABASE</option>
                  <option value="WEBSOCKET">WEBSOCKET</option>
                  <option value="STREAM">STREAM</option>
                  <option value="DETECTION">DETECTION</option>
                  <option value="NOTIFICATION">NOTIFICATION</option>
                  <option value="SYSTEM">SYSTEM</option>
                  <option value="EXCEPTION">EXCEPTION</option>
                </Select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results Count */}
      {hasActiveFilters && (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          Mostrando {table.getFilteredRowModel().rows.length} de {logs.length} registros
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <div className="overflow-x-auto">
          <Table dense>
            <TableHead>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHeader
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className="cursor-pointer select-none hover:bg-zinc-50 dark:hover:bg-zinc-700"
                    >
                      <div className="flex items-center gap-2">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() && (
                          <span className="text-zinc-400">
                            {header.column.getIsSorted() === 'desc' ? '↓' : '↑'}
                          </span>
                        )}
                      </div>
                    </TableHeader>
                  ))}
                </TableRow>
              ))}
            </TableHead>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center py-12">
                    <div className="text-zinc-500 dark:text-zinc-400">
                      No se encontraron registros de logs
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Mostrando {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} a{' '}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length
            )}{' '}
            de {table.getFilteredRowModel().rows.length} registros
          </div>
          <div className="flex gap-2">
            <Button
              outline
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeftIcon />
              Anterior
            </Button>
            <Button
              outline
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Siguiente
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
