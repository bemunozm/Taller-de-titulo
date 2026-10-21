import { useMemo, useState, useEffect, useCallback, type ComponentProps } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAccessAttempts, type AccessAttempt } from '@/api/DetectionsAPI'
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
import { toast } from 'react-toastify'
import { Input, InputGroup } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { useNavigate } from 'react-router-dom'
import {
  EyeIcon,
  EllipsisVerticalIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/16/solid'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/ui/Dropdown'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { ACCESS_DECISIONS, getAccessDecisionMeta } from '@/helpers/accessDecision'
import { countPassageCameras } from '@/helpers/passage'
import { AccessDecisionBadge } from './AccessDecisionBadge'

type BadgeColor = NonNullable<ComponentProps<typeof Badge>['color']>

const METHOD_COLORS: Record<string, BadgeColor> = {
  lpr: 'lime',
  facial: 'sky',
  manual: 'amber',
  qr: 'purple',
}

// A nivel de módulo: dentro del componente se recreaba en cada render e
// invalidaba el `useMemo` de las columnas.
const columnHelper = createColumnHelper<AccessAttempt>()

export default function TraceabilityTable() {
  const { data = [] } = useQuery({ queryKey: ['detections', 'attempts'], queryFn: () => listAccessAttempts() })
  const navigate = useNavigate()

  const [globalFilter, setGlobalFilter] = useState('')
  const [decisionFilter, setDecisionFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [showFilters, setShowFilters] = useState(true)

  const columns = useMemo(() => [
    columnHelper.accessor((row) => row.id, {
      id: 'id',
      header: 'ID',
      cell: (info) => (
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {String(info.getValue()).slice(0, 8)}
        </span>
      )
    }),
    columnHelper.accessor('createdAt', {
      header: 'Fecha y Hora',
      cell: (info) => {
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
    columnHelper.accessor('decision', {
      header: 'Decisión',
      cell: (info) => <AccessDecisionBadge decision={info.getValue()} />
    }),
    columnHelper.accessor('method', {
      header: 'Método',
      cell: (info) => {
        const method = info.getValue()
        if (!method) return <span className="text-zinc-400 dark:text-zinc-600">-</span>

        return (
          <Badge color={METHOD_COLORS[method.toLowerCase()] ?? 'zinc'}>
            {method}
          </Badge>
        )
      }
    }),
    columnHelper.accessor((row) => row.detection?.plate, {
      id: 'plate',
      header: 'Patente',
      cell: (info) => {
        const plate = info.getValue()
        return plate ? (
          <span className="font-mono font-semibold text-sm bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600">
            {plate}
          </span>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">-</span>
        )
      }
    }),
    columnHelper.accessor((row) => row.detection?.cameraId, {
      id: 'camera',
      header: 'Cámara',
      cell: (info) => {
        const cameraId = info.getValue()
        const cameraCount = countPassageCameras(info.row.original.passage)
        return cameraId ? (
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            {cameraId}
            {cameraCount > 1 && (
              <span
                className="ml-2 text-xs text-zinc-500 dark:text-zinc-400"
                title="Varias cámaras vieron este mismo paso"
              >
                ×{cameraCount} cámaras
              </span>
            )}
          </span>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-600">-</span>
        )
      }
    }),
    columnHelper.accessor((row) => row.detection, {
      id: 'confidence',
      header: 'Confianza',
      cell: (info) => {
        const detection = info.getValue()
        if (!detection) return <span className="text-zinc-400 dark:text-zinc-600">-</span>
        
        const detConf = detection.det_confidence
        const ocrConf = detection.ocr_confidence
        
        // Calcular promedio si ambos están disponibles, sino usar el que esté disponible
        let avgConfidence: number | null = null
        if (detConf && ocrConf) {
          avgConfidence = (detConf + ocrConf) / 2
        } else if (ocrConf) {
          avgConfidence = ocrConf
        } else if (detConf) {
          avgConfidence = detConf
        }
        
        if (!avgConfidence) return <span className="text-zinc-400 dark:text-zinc-600">-</span>
        
        const percentage = (avgConfidence * 100).toFixed(1)
        const color = avgConfidence >= 0.9 ? 'text-green-600 dark:text-green-400' :
                      avgConfidence >= 0.7 ? 'text-amber-600 dark:text-amber-400' :
                      'text-red-600 dark:text-red-400'
        
        return (
          <div className="flex flex-col">
            <span className={`font-medium ${color}`}>{percentage}%</span>
            <span className="text-xs text-zinc-400">Promedio</span>
          </div>
        )
      }
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      cell: (info) => {
        const row = info.row.original
        return (
          <div className="flex justify-end">
            <Dropdown>
              <DropdownButton plain>
                <EllipsisVerticalIcon />
              </DropdownButton>
              <DropdownMenu>
                <DropdownItem onClick={() => navigate(`/traceability/${row.id}`)}>
                  <EyeIcon />
                  Ver detalles
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
        )
      }
    })
  ], [navigate])

  const filteredData = useMemo(() => {
    let filtered = data

    // Filtro por decisión
    if (decisionFilter) {
      filtered = filtered.filter((item) => item.decision === decisionFilter)
    }

    // Filtro por rango de fechas
    if (dateFrom) {
      const startOfDay = new Date(dateFrom)
      startOfDay.setHours(0, 0, 0, 0)
      filtered = filtered.filter((item) => new Date(item.createdAt) >= startOfDay)
    }
    if (dateTo) {
      const endOfDay = new Date(dateTo)
      endOfDay.setHours(23, 59, 59, 999)
      filtered = filtered.filter((item) => new Date(item.createdAt) <= endOfDay)
    }

    return filtered
  }, [data, decisionFilter, dateFrom, dateTo])

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      globalFilter
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 20
      }
    }
  })

  const exportFilteredData = useCallback(() => {
    const rows = table.getFilteredRowModel().rows
    if (rows.length === 0) {
      toast.error('No hay datos para exportar')
      return
    }

    const csvData = rows.map((row) => {
      const original = row.original
      const date = new Date(original.createdAt)
      const formattedDate = date.toISOString().replace('T', ' ').slice(0, 19)
      
      const detConf = original.detection?.det_confidence
      const ocrConf = original.detection?.ocr_confidence
      
      // Calcular promedio
      let avgConfidence = ''
      if (detConf && ocrConf) {
        avgConfidence = (((detConf + ocrConf) / 2) * 100).toFixed(2) + '%'
      } else if (ocrConf) {
        avgConfidence = (ocrConf * 100).toFixed(2) + '%'
      } else if (detConf) {
        avgConfidence = (detConf * 100).toFixed(2) + '%'
      }
      
      return {
        ID: original.id,
        Fecha: formattedDate,
        Decisión: original.decision,
        Método: original.method || '',
        Patente: original.detection?.plate || '',
        Cámara: original.detection?.cameraId || '',
        'Confianza Promedio': avgConfidence,
        'Confianza Detección (YOLO)': detConf ? (detConf * 100).toFixed(2) + '%' : '',
        'Confianza OCR': ocrConf ? (ocrConf * 100).toFixed(2) + '%' : '',
        'URL Imagen': original.detection?.full_frame_path || ''
      }
    })

    const headers = Object.keys(csvData[0])
    const csv = [
      headers.join(','),
      ...csvData.map((row) =>
        headers.map((header) => `"${row[header as keyof typeof row]}"`).join(',')
      )
    ].join('\n')

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `trazabilidad_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    toast.success('CSV exportado exitosamente')
  }, [table])

  useEffect(() => {
    const handleExport = () => exportFilteredData()
    window.addEventListener('traceability:export-csv', handleExport)
    return () => window.removeEventListener('traceability:export-csv', handleExport)
  }, [exportFilteredData])

  const hasActiveFilters = useMemo(() => {
    return globalFilter !== '' || decisionFilter !== '' || dateFrom !== '' || dateTo !== ''
  }, [globalFilter, decisionFilter, dateFrom, dateTo])

  const clearFilters = () => {
    setGlobalFilter('')
    setDecisionFilter('')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
      {/* Filters Section */}
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <Button 
              plain 
              onClick={() => setShowFilters(!showFilters)}
              className="text-zinc-700 dark:text-zinc-300"
            >
              <FunnelIcon className="w-5 h-5" />
              {showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
              {hasActiveFilters && (
                <Badge color="teal" className="ml-2">
                  {[globalFilter, decisionFilter, dateFrom, dateTo].filter(Boolean).length}
                </Badge>
              )}
            </Button>
            {hasActiveFilters && (
              <Button plain onClick={clearFilters} className="text-red-600 dark:text-red-400">
                <XMarkIcon className="w-5 h-5" />
                Limpiar filtros
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Búsqueda global */}
              <InputGroup>
                <MagnifyingGlassIcon />
                <Input
                  placeholder="Buscar en todos los campos..."
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                />
              </InputGroup>

              {/* Filtro por decisión */}
              <Select
                aria-label="Filtrar por decisión"
                value={decisionFilter}
                onChange={(e) => setDecisionFilter(e.target.value)}
              >
                <option value="">Todas las decisiones</option>
                {ACCESS_DECISIONS.map((decision) => (
                  <option key={decision} value={decision}>
                    {getAccessDecisionMeta(decision).label}
                  </option>
                ))}
              </Select>

              {/* Fecha desde */}
              <Input
                type="date"
                placeholder="Fecha desde"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />

              {/* Fecha hasta */}
              <Input
                type="date"
                placeholder="Fecha hasta"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Results Count */}
        <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Mostrando <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {table.getFilteredRowModel().rows.length}
            </span> registro{table.getFilteredRowModel().rows.length !== 1 ? 's' : ''}
            {hasActiveFilters && (
              <span className="text-teal-600 dark:text-teal-400">
                {' '}(filtrado de {data.length} total{data.length !== 1 ? 'es' : ''})
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Table */}
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
                        <span className="text-teal-600 dark:text-teal-400">
                          {header.column.getIsSorted() === 'asc' ? (
                            <ChevronUpIcon className="w-4 h-4" />
                          ) : (
                            <ChevronDownIcon className="w-4 h-4" />
                          )}
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
                <TableCell colSpan={columns.length} className="text-center py-12 text-zinc-500 dark:text-zinc-400">
                  {hasActiveFilters ? 'No se encontraron registros con los filtros aplicados' : 'No hay registros disponibles'}
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

      {/* Pagination */}
      {table.getFilteredRowModel().rows.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <span>Filas por página:</span>
            <Select
              value={table.getState().pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="w-20"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              outline
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              Primera
            </Button>
            <Button
              outline
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Anterior
            </Button>
            <span className="text-sm text-zinc-600 dark:text-zinc-400 px-2">
              Página {table.getState().pagination.pageIndex + 1} de{' '}
              {table.getPageCount()}
            </span>
            <Button
              outline
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Siguiente
            </Button>
            <Button
              outline
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              Última
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
