import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAnomalies, type AnomalyEvent } from '@/api/DetectionsAPI'
import { 
  createColumnHelper, 
  getCoreRowModel, 
  useReactTable, 
  getSortedRowModel, 
  getFilteredRowModel, 
  getPaginationRowModel, 
  flexRender 
} from '@tanstack/react-table'
import { Button } from '@/components/ui/Button'
import { Input, InputGroup } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { 
  ChevronUpIcon, 
  ChevronDownIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  XMarkIcon
} from '@heroicons/react/16/solid'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'

export default function AnomalyTable() {
  const { data = [] } = useQuery({ queryKey: ['anomalies'], queryFn: () => listAnomalies() })

  const [globalFilter, setGlobalFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('')
  const [sorting, setSorting] = useState<any[]>([{ id: 'timestamp', desc: true }])
  const [showFilters, setShowFilters] = useState(true)

  const columnHelper = createColumnHelper<AnomalyEvent>()

  const columns = useMemo(() => [
    columnHelper.accessor('timestamp', {
      header: 'Fecha y Hora',
      cell: (info: any) => {
        const date = new Date(String(info.getValue()))
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
      }
    }),
    columnHelper.accessor('cameraId', {
      header: 'Cámara',
      cell: (info: any) => <span className="text-sm font-mono">{info.getValue()}</span>
    }),
    columnHelper.accessor('anomalyType', {
      header: 'Tipo',
      cell: (info: any) => (
        <Badge color="zinc" className="uppercase font-bold">
          {info.getValue() === 'intrusion' ? 'Intrusión' : 'Merodeo'}
        </Badge>
      )
    }),
    columnHelper.accessor('suspicionLevel', {
      header: 'Nivel IA',
      cell: (info: any) => {
        const val = info.getValue()
        const colors: any = { HIGH: 'red', MEDIUM: 'orange', LOW: 'green' }
        return <Badge color={colors[val] || 'zinc'}>{val}</Badge>
      }
    }),
    columnHelper.accessor('aiReasoning', {
      header: 'Vedicto de la IA (Razonamiento)',
      cell: (info: any) => (
        <div className="max-w-md">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 hover:line-clamp-none transition-all cursor-pointer">
            {info.getValue() || 'Sin evaluación disponible'}
          </p>
        </div>
      )
    }),
    columnHelper.accessor('confidence', {
      header: 'Confianza IA',
      cell: (info: any) => {
        const conf = info.getValue()
        return (
          <span className={`text-sm font-medium ${conf > 0.8 ? 'text-green-600' : 'text-zinc-500'}`}>
            {(conf * 100).toFixed(0)}%
          </span>
        )
      }
    }),
  ], [columnHelper])

  const filteredData = useMemo(() => {
    let filtered = data
    if (levelFilter) {
      filtered = filtered.filter((item) => item.suspicionLevel === levelFilter)
    }
    return filtered
  }, [data, levelFilter])

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

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <Heading level={3} className="text-sm font-semibold">Historial de Anomalías IA</Heading>
          <div className="flex gap-2">
            <Button plain onClick={() => setShowFilters(!showFilters)}>
              <FunnelIcon className="w-4 h-4" />
            </Button>
            { (globalFilter || levelFilter) && (
              <Button plain onClick={() => { setGlobalFilter(''); setLevelFilter('') }}>
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
            <Select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
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
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-10 text-zinc-500">
                  No hay anomalías registradas
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
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

function Heading({ level = 1, children, className }: any) {
  const Tag = `h${level}` as any
  return <Tag className={className}>{children}</Tag>
}
