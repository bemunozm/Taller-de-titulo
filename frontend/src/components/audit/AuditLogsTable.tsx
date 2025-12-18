import { useMemo, useState, useEffect, useCallback } from 'react'
import {
  createColumnHelper,
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table'
import type { AuditLog } from '@/types/audit'
import { AuditModule, AuditAction } from '@/types/audit'
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, InputGroup } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { 
  MagnifyingGlassIcon,
  ChevronUpDownIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

interface AuditLogsTableProps {
  logs: AuditLog[]
}

const columnHelper = createColumnHelper<AuditLog>()

export function AuditLogsTable({ logs }: AuditLogsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const getActionBadge = (action: AuditAction) => {
    const colors: Record<string, 'red' | 'orange' | 'amber' | 'yellow' | 'lime' | 'green' | 'emerald' | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet' | 'purple' | 'fuchsia' | 'pink' | 'rose' | 'zinc'> = {
      CREATE: 'green',
      UPDATE: 'blue',
      DELETE: 'red',
      LOGIN: 'purple',
      LOGIN_FAILED: 'red',
      APPROVE: 'green',
      REJECT: 'red',
      ENABLE: 'lime',
      DISABLE: 'orange',
      PASSWORD_RESET: 'amber',
      CHECK_IN: 'cyan',
      CHECK_OUT: 'sky',
      VALIDATE: 'teal',
      CANCEL: 'rose',
      CAMERA_REGISTER: 'indigo',
      PERMISSION_GRANT: 'emerald',
      PERMISSION_REVOKE: 'pink',
    };
    return <Badge color={colors[action] || 'zinc'}>{action.replace(/_/g, ' ')}</Badge>;
  };

  const getModuleBadge = (module: AuditModule) => {
    const colors: Record<string, 'sky' | 'purple' | 'indigo' | 'blue' | 'teal' | 'emerald' | 'cyan'> = {
      AUTH: 'purple',
      USERS: 'sky',
      CAMERAS: 'indigo',
      VISITS: 'blue',
      VEHICLES: 'teal',
      FAMILIES: 'emerald',
      ROLES: 'cyan',
      PERMISSIONS: 'purple',
      STREAMS: 'indigo',
      DETECTIONS: 'sky',
    };
    return <Badge color={colors[module] || 'sky'}>{module}</Badge>;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('createdAt', {
        header: ({ column }) => (
          <button
            onClick={() => column.toggleSorting()}
            className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Fecha
            <ChevronUpDownIcon className="w-4 h-4" />
          </button>
        ),
        cell: (info) => (
          <span className="text-sm font-mono">
            {formatDate(info.getValue())}
          </span>
        ),
        sortingFn: 'datetime',
      }),
      columnHelper.accessor('module', {
        header: 'Módulo',
        cell: (info) => getModuleBadge(info.getValue()),
        filterFn: 'equals',
      }),
      columnHelper.accessor('action', {
        header: 'Acción',
        cell: (info) => getActionBadge(info.getValue()),
        filterFn: 'equals',
      }),
      columnHelper.display({
        id: 'user',
        header: 'Usuario',
        cell: (info) => {
          const log = info.row.original;
          return (
            <div className="flex flex-col">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {log.user?.name || 'Sistema'}
              </span>
              {log.user?.email && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {log.user.email}
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('entityType', {
        header: 'Entidad',
        cell: (info) => {
          const value = info.getValue();
          return value ? (
            <span className="text-xs bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded font-mono">
              {value}
            </span>
          ) : (
            <span className="text-zinc-400">-</span>
          );
        },
        filterFn: 'includesString',
      }),
      columnHelper.accessor('description', {
        header: 'Descripción',
        cell: (info) => (
          <span className="text-sm max-w-md truncate block" title={info.getValue()}>
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'ip',
        header: 'IP',
        cell: (info) => {
          const ip = info.row.original.metadata?.ip;
          return (
            <span className="text-xs font-mono text-zinc-500">
              {ip || '-'}
            </span>
          );
        },
      }),
    ],
    []
  );

  const table = useReactTable({
    data: logs,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 20,
      },
    },
  });

  const moduleFilter = columnFilters.find(f => f.id === 'module')?.value as string;
  const actionFilter = columnFilters.find(f => f.id === 'action')?.value as string;
  const entityTypeFilter = columnFilters.find(f => f.id === 'entityType')?.value as string;

  const hasActiveFilters = moduleFilter || actionFilter || entityTypeFilter || globalFilter;

  const exportFilteredData = useCallback(() => {
    const filteredRows = table.getFilteredRowModel().rows.map(row => row.original);
    
    if (filteredRows.length === 0) {
      return;
    }

    const rows = filteredRows.map(log => ({
      fecha: new Date(log.createdAt).toISOString().replace('T', ' ').slice(0, 19),
      modulo: log.module,
      accion: log.action.replace(/_/g, ' '),
      usuario: log.user?.name || 'Sistema',
      email: log.user?.email || '-',
      entidad: log.entityType || '-',
      id_entidad: log.entityId || '-',
      descripcion: log.description,
      ip: log.metadata?.ip || '-',
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
    a.download = `registros-auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [table]);

  useEffect(() => {
    function onExport() {
      exportFilteredData();
    }

    window.addEventListener('audit:export-csv', onExport as EventListener);
    return () => {
      window.removeEventListener('audit:export-csv', onExport as EventListener);
    };
  }, [exportFilteredData]);

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
                value={globalFilter}
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
                  Módulo
                </label>
                <Select
                  value={moduleFilter || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) {
                      table.getColumn('module')?.setFilterValue(value);
                    } else {
                      table.getColumn('module')?.setFilterValue(undefined);
                    }
                  }}
                >
                  <option value="">Todos los módulos</option>
                  {Object.values(AuditModule).map(module => (
                    <option key={module} value={module}>{module}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block text-zinc-700 dark:text-zinc-300">
                  Acción
                </label>
                <Select
                  value={actionFilter || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) {
                      table.getColumn('action')?.setFilterValue(value);
                    } else {
                      table.getColumn('action')?.setFilterValue(undefined);
                    }
                  }}
                >
                  <option value="">Todas las acciones</option>
                  {Object.values(AuditAction).map(action => (
                    <option key={action} value={action}>{action.replace(/_/g, ' ')}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block text-zinc-700 dark:text-zinc-300">
                  Tipo de Entidad
                </label>
                <Input
                  name="entityType"
                  placeholder="ej: User, Camera, Visit"
                  value={entityTypeFilter || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) {
                      table.getColumn('entityType')?.setFilterValue(value);
                    } else {
                      table.getColumn('entityType')?.setFilterValue(undefined);
                    }
                  }}
                />
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
      <div className="rounded-lg bg-white dark:bg-zinc-900 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHeader key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : typeof header.column.columnDef.header === 'function'
                        ? header.column.columnDef.header(header.getContext())
                        : header.column.columnDef.header}
                    </TableHeader>
                  ))}
                </TableRow>
              ))}
            </TableHead>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2">
                      <MagnifyingGlassIcon className="w-12 h-12 text-zinc-400" />
                      <p className="text-zinc-600 dark:text-zinc-400 font-medium">
                        No se encontraron registros
                      </p>
                      <p className="text-sm text-zinc-500">
                        Intenta ajustar los filtros de búsqueda
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow 
                    key={row.id}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {typeof cell.column.columnDef.cell === 'function'
                          ? cell.column.columnDef.cell(cell.getContext())
                          : null}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {table.getFilteredRowModel().rows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Mostrando {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} a{' '}
              {Math.min(
                (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                table.getFilteredRowModel().rows.length
              )}{' '}
              de {table.getFilteredRowModel().rows.length} registros
            </div>
            <div className="flex items-center gap-2">
              <Button
                plain
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                Anterior
              </Button>
              <span className="px-3 py-1 text-sm text-zinc-700 dark:text-zinc-300">
                Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
              </span>
              <Button
                plain
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
