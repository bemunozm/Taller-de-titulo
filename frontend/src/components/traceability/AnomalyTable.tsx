import { useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { listAnomalies } from '@/api/DetectionsAPI'
import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  flexRender,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/Button'
import { Input, InputGroup } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Subheading } from '@/components/ui/Heading'
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/16/solid'
import { anomalyAiPollInterval, anomalyDetailPath, anomalyStatusMeta } from '@/helpers/anomaly'
import { ANOMALY_STATUSES, ANOMALY_TYPES, type AnomalyListItem, type AnomalyStatus } from '@/types/anomaly'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'

type BadgeColor = NonNullable<ComponentProps<typeof Badge>['color']>

const SUSPICION_COLORS: Record<string, BadgeColor> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' }

/** Filas por página: el servidor pagina (tope 100) y el listado no trae fotos. */
export const ANOMALY_PAGE_SIZE = 20

const TYPE_FILTER_LABELS: Record<(typeof ANOMALY_TYPES)[number], string> = {
  intrusion: 'Intrusión',
  loitering: 'Merodeo',
}

function formatRowDate(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'fecha desconocida' : date.toLocaleString('es-CL')
}

function isAiPending(item: AnomalyListItem): boolean {
  return item.aiStatus === 'pending'
}

function AnalyzingIndicator() {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
      <ArrowPathIcon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Analizando…
    </span>
  )
}

const columnHelper = createColumnHelper<AnomalyListItem>()

// Definidas a nivel de módulo: no dependen del estado del componente.
const columns = [
  columnHelper.accessor('timestamp', {
    header: 'Fecha y Hora',
    cell: (info) => {
      const date = new Date(info.getValue())
      return (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {date.toLocaleDateString('es-CL')}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {date.toLocaleTimeString('es-CL')}
          </span>
        </div>
      )
    },
  }),
  columnHelper.accessor('cameraId', {
    header: 'Cámara',
    cell: (info) => <span className="text-sm font-mono">{info.getValue()}</span>,
  }),
  columnHelper.accessor('anomalyType', {
    header: 'Tipo',
    cell: (info) => (
      <Badge color="zinc" className="uppercase font-bold">
        {info.getValue() === 'intrusion' ? 'Intrusión' : 'Merodeo'}
      </Badge>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Estado',
    cell: (info) => {
      const meta = anomalyStatusMeta(info.getValue())
      return <Badge color={meta.color}>{meta.label}</Badge>
    },
  }),
  columnHelper.accessor('suspicionLevel', {
    header: 'Nivel IA',
    cell: (info) => {
      if (isAiPending(info.row.original)) return <AnalyzingIndicator />
      const level = info.getValue()
      if (!level) return <span className="text-sm text-zinc-500">Sin evaluar</span>
      return <Badge color={SUSPICION_COLORS[level] ?? 'zinc'}>{level}</Badge>
    },
  }),
  columnHelper.accessor('aiReasoning', {
    header: 'Veredicto de la IA (Razonamiento)',
    cell: (info) => {
      const item = info.row.original
      if (isAiPending(item)) return <AnalyzingIndicator />
      return (
        <div className="max-w-md space-y-1">
          {item.aiFalsePositive === true && <Badge color="amber">Posible falso positivo</Badge>}
          <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
            {info.getValue() || (item.aiStatus === 'failed' ? 'El análisis de la IA falló' : 'Sin evaluación disponible')}
          </p>
        </div>
      )
    },
  }),
  columnHelper.accessor('confidence', {
    header: 'Confianza IA',
    cell: (info) => {
      const confidence = info.getValue()
      return (
        <span className={`text-sm font-medium ${confidence > 0.8 ? 'text-green-600' : 'text-zinc-500'}`}>
          {(confidence * 100).toFixed(0)}%
        </span>
      )
    },
  }),
]

export default function AnomalyTable() {
  const [statusFilter, setStatusFilter] = useState<AnomalyStatus | ''>('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(0)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['anomalies', 'list', { status: statusFilter, type: typeFilter, page }],
    queryFn: () =>
      listAnomalies({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        limit: ANOMALY_PAGE_SIZE,
        offset: page * ANOMALY_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    // Mientras la IA analiza alguna fila se refresca (acotado); `security:anomaly_updated` lo adelanta.
    refetchInterval: (query) =>
      anomalyAiPollInterval(query.state.data?.items.some(isAiPending) ?? false, query.state.dataUpdateCount),
  })

  const items = useMemo(() => data?.items ?? [], [data])
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / ANOMALY_PAGE_SIZE))

  // Búsqueda y nivel de riesgo se aplican solo sobre la página cargada.
  const [globalFilter, setGlobalFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('')
  const [showFilters, setShowFilters] = useState(true)

  const filteredData = useMemo(
    () => (levelFilter ? items.filter((item) => item.suspicionLevel === levelFilter) : items),
    [items, levelFilter],
  )

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const rows = table.getRowModel().rows
  const hasServerFilters = statusFilter !== '' || typeFilter !== ''
  const hasFilters = hasServerFilters || globalFilter !== '' || levelFilter !== ''

  const changeStatus = (value: string) => {
    setStatusFilter(ANOMALY_STATUSES.find((status) => status === value) ?? '')
    setPage(0)
  }
  const changeType = (value: string) => {
    setTypeFilter(value)
    setPage(0)
  }
  const clearFilters = () => {
    setStatusFilter('')
    setTypeFilter('')
    setGlobalFilter('')
    setLevelFilter('')
    setPage(0)
  }

  // Un fallo de esta pestaña no debe tumbar la trazabilidad de accesos: se
  // muestra en la tabla, con opción de reintentar.
  let emptyState: ReactNode = null
  if (isLoading) {
    emptyState = <span>Cargando anomalías...</span>
  } else if (isError) {
    emptyState = (
      <div role="alert" className="flex flex-col items-center gap-3">
        <span className="text-red-600 dark:text-red-400">
          {error instanceof Error && error.message ? error.message : 'No se pudieron cargar las anomalías'}
        </span>
        <Button outline onClick={() => refetch()} disabled={isFetching}>
          <ArrowPathIcon className={isFetching ? 'animate-spin' : ''} />
          Reintentar
        </Button>
      </div>
    )
  } else if (rows.length === 0) {
    emptyState =
      items.length === 0 && !hasServerFilters ? 'No hay anomalías registradas' : 'Ninguna anomalía coincide con los filtros'
  }

  const firstShown = total === 0 ? 0 : page * ANOMALY_PAGE_SIZE + 1
  const lastShown = Math.min(total, page * ANOMALY_PAGE_SIZE + items.length)

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <Subheading level={3} className="text-sm font-semibold">Historial de Anomalías IA</Subheading>
          <div className="flex gap-2">
            <Button
              plain
              onClick={() => setShowFilters(!showFilters)}
              aria-label={showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
            >
              <FunnelIcon className="w-4 h-4" />
            </Button>
            {hasFilters && (
              <Button plain onClick={clearFilters} aria-label="Limpiar filtros">
                <XMarkIcon className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <InputGroup>
              <MagnifyingGlassIcon />
              <Input
                aria-label="Buscar en esta página"
                placeholder="Buscar en esta página..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
            </InputGroup>
            <Select
              aria-label="Filtrar por estado"
              value={statusFilter}
              onChange={(e) => changeStatus(e.target.value)}
            >
              <option value="">Todos los estados</option>
              {ANOMALY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {anomalyStatusMeta(status).label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filtrar por tipo"
              value={typeFilter}
              onChange={(e) => changeType(e.target.value)}
            >
              <option value="">Todos los tipos</option>
              {ANOMALY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_FILTER_LABELS[type]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filtrar por nivel de riesgo"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            >
              <option value="">Todo el riesgo</option>
              <option value="HIGH">Crítico (HIGH)</option>
              <option value="MEDIUM">Sospechoso (MEDIUM)</option>
              <option value="LOW">Bajo Riesgo (LOW)</option>
            </Select>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHeader key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHeader>
                ))}
              </TableRow>
            ))}
          </TableHead>
          <TableBody>
            {emptyState !== null ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-10 text-zinc-500">
                  {emptyState}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                // Toda la fila lleva al detalle; el enlace de la primera celda es el foco de teclado.
                <TableRow
                  key={row.id}
                  href={anomalyDetailPath(row.original.id)}
                  title={`Ver detalle de la anomalía del ${formatRowDate(row.original.timestamp)}`}
                >
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

      {!isError && total > 0 && (
        <nav
          aria-label="Paginación de anomalías"
          className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800"
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {firstShown}–{lastShown} de {total}
          </p>
          <div className="flex items-center gap-2">
            <Button plain onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
              <ChevronLeftIcon />
              Anterior
            </Button>
            <span className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
              Página {page + 1} de {pageCount}
            </span>
            <Button
              plain
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              disabled={page >= pageCount - 1}
            >
              Siguiente
              <ChevronRightIcon />
            </Button>
          </div>
        </nav>
      )}
    </div>
  )
}
