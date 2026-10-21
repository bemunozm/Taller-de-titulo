import { useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAnomalies, type AnomalyEvent } from '@/api/DetectionsAPI'
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type SortingState,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/Button'
import { Input, InputGroup } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Subheading } from '@/components/ui/Heading'
import {
  ArrowPathIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  XMarkIcon
} from '@heroicons/react/16/solid'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'

type BadgeColor = NonNullable<ComponentProps<typeof Badge>['color']>

const SUSPICION_COLORS: Record<string, BadgeColor> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' }

const columnHelper = createColumnHelper<AnomalyEvent>()

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
  columnHelper.accessor('suspicionLevel', {
    header: 'Nivel IA',
    cell: (info) => {
      const level = info.getValue()
      if (!level) return <span className="text-sm text-zinc-500">Sin evaluar</span>
      return <Badge color={SUSPICION_COLORS[level] ?? 'zinc'}>{level}</Badge>
    },
  }),
  columnHelper.accessor('aiReasoning', {
    header: 'Veredicto de la IA (Razonamiento)',
    cell: (info) => (
      <div className="max-w-md">
        <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 hover:line-clamp-none transition-all cursor-pointer">
          {info.getValue() || 'Sin evaluación disponible'}
        </p>
      </div>
    ),
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
  const { data = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['anomalies'],
    queryFn: () => listAnomalies(),
  })

  const [globalFilter, setGlobalFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp', desc: true }])
  const [showFilters, setShowFilters] = useState(true)

  const filteredData = useMemo(
    () => (levelFilter ? data.filter((item) => item.suspicionLevel === levelFilter) : data),
    [data, levelFilter],
  )

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } }
  })

  const rows = table.getRowModel().rows

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
    emptyState = data.length === 0 ? 'No hay anomalías registradas' : 'Ninguna anomalía coincide con los filtros'
  }

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
            {(globalFilter || levelFilter) && (
              <Button plain onClick={() => { setGlobalFilter(''); setLevelFilter('') }} aria-label="Limpiar filtros">
                <XMarkIcon className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InputGroup>
              <MagnifyingGlassIcon />
              <Input
                placeholder="Buscar en descripción..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
            </InputGroup>
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
                  <TableHeader
                    key={header.id}
                    className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-2">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() && (
                        <span className="text-teal-600">
                          {header.column.getIsSorted() === 'asc' ? <ChevronUpIcon className="w-3 h-3"/> : <ChevronDownIcon className="w-3 h-3"/>}
                        </span>
                      )}
                    </div>
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
                <TableRow key={row.id}>
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
    </div>
  )
}
