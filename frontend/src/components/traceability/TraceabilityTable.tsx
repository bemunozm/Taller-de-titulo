import { useMemo, useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAccessAttempts, type AccessAttempt } from '@/api/DetectionsAPI'
import { createColumnHelper, getCoreRowModel, useReactTable, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, flexRender } from '@tanstack/react-table'
import type { HeaderGroup, Row, Cell } from '@tanstack/react-table'
import { Button } from '@/components/ui/Button'
import { toast } from 'react-toastify'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useNavigate } from 'react-router-dom'

export default function TraceabilityTable() {
  const { data = [] } = useQuery({ queryKey: ['detections', 'attempts'], queryFn: () => listAccessAttempts() })

  const navigate = useNavigate()

  const [globalFilter, setGlobalFilter] = useState('')
  const [decisionFilter, setDecisionFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [sorting, setSorting] = useState<any[]>([])

  const columnHelper = createColumnHelper<AccessAttempt>()

  const columns = useMemo(() => [
    columnHelper.accessor((row: AccessAttempt) => row.id, {
      id: 'id',
      header: 'ID',
      cell: (info: any) => String(info.getValue()).slice(0, 8)
    }),
    columnHelper.accessor('createdAt', {
      header: 'Fecha',
      cell: (info: any) => new Date(String(info.getValue())).toLocaleString()
    }),
    columnHelper.accessor('decision', {
      header: 'Decisión'
    }),
    columnHelper.accessor('method', {
      header: 'Método',
      cell: (info: any) => info.getValue() ?? '-'
    }),
    columnHelper.accessor((row: AccessAttempt) => row.detection?.plate, {
      id: 'plate',
      header: 'Patente',
      cell: (info: any) => info.getValue() || '-'
    }),
    columnHelper.accessor((row: AccessAttempt) => row.detection?.cameraId, {
      id: 'camera',
      header: 'Cámara',
      cell: (info: any) => info.getValue() || '-'
    }),
    columnHelper.display({
      id: 'actions',
      header: ' ',
      cell: (info: any) => (
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate(`/traceability/${info.row.original.id}`)}>Ver</Button>
        </div>
      )
    })
  ], [columnHelper])

  // client-side filters
  const filteredData = useMemo(() => {
    return (data || []).filter((row) => {
      const gf = globalFilter.trim().toLowerCase()
      if (gf) {
        const hay = `${row.id} ${row.detection?.plate ?? ''} ${row.detection?.cameraId ?? ''} ${row.method ?? ''} ${row.decision}`.toLowerCase()
        if (!hay.includes(gf)) return false
      }
      if (decisionFilter) {
        if ((row.decision || '').toLowerCase() !== decisionFilter.toLowerCase()) return false
      }
      if (dateFrom) {
        // compare using date-only (YYYY-MM-DD) to avoid timezone issues
        const createdYMD = new Date(row.createdAt).toISOString().slice(0, 10)
        if (createdYMD < dateFrom) return false
      }
      if (dateTo) {
        const createdYMD = new Date(row.createdAt).toISOString().slice(0, 10)
        if (createdYMD > dateTo) return false
      }
      return true
    })
  }, [data, globalFilter, decisionFilter, dateFrom, dateTo])

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const exportCsv = useCallback(() => {
    const rows = filteredData.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      decision: r.decision,
      method: r.method ?? '',
      residente: r.residente ? (r.residente.name ?? r.residente.id) : '',
      plate: r.detection?.plate ?? '',
      camera: r.detection?.cameraId ?? '',
      ocr_confidence: r.detection?.ocr_confidence ?? '',
      det_confidence: r.detection?.det_confidence ?? '',
      full_frame_path: r.detection?.full_frame_path ?? '',
    }))

    if (rows.length === 0) {
      toast.info('No hay datos para exportar')
      return
    }

    const header = Object.keys(rows[0] || {}).join(',')
    const body = rows
      .map((row) => Object.values(row)
        .map((v) => {
          if (v === null || v === undefined) return ''
          const s = String(v)
          // escape quotes
          return '"' + s.replace(/"/g, '""') + '"'
        })
        .join(','))
      .join('\n')

    // BOM for Excel compatibility
    const csv = '\uFEFF' + header + '\n' + body
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `traceability-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    try { toast.success(`CSV generado (${rows.length} registros)`) } catch {}
  }, [filteredData])

  useEffect(() => {
    function onClear() {
      setGlobalFilter('')
      setDecisionFilter('')
      setDateFrom('')
      setDateTo('')
      // reset to first page
      table.setPageIndex(0)
    }

    function onExport() {
      exportCsv()
    }

    window.addEventListener('traceability:clear-filters', onClear as EventListener)
    window.addEventListener('traceability:export-csv', onExport as EventListener)
    return () => {
      window.removeEventListener('traceability:clear-filters', onClear as EventListener)
      window.removeEventListener('traceability:export-csv', onExport as EventListener)
    }
  }, [exportCsv, table])

  return (
    <div>
      <div className="mb-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
        <div className="sm:col-span-6">
          <Input
            type="search"
            placeholder="Buscar por ID, patente, cámara, método..."
            value={globalFilter}
            onChange={(e: any) => setGlobalFilter(typeof e === 'string' ? e : e?.target?.value ?? '')}
          />
        </div>
        <div className="sm:col-span-2">
          <Select value={decisionFilter} onChange={(v: any) => setDecisionFilter(typeof v === 'string' ? v : v?.target?.value ?? '')}>
            <option value="">Todas</option>
            <option value="Aprovado">Aprovado</option>
            <option value="Denegado">Denegado</option>
          </Select>
        </div>
        <div className="sm:col-span-2 flex gap-2">
          <Input type="date" aria-label="Fecha desde" value={dateFrom} onChange={(e: any) => setDateFrom(typeof e === 'string' ? e : e?.target?.value ?? '')} />
          <Input type="date" aria-label="Fecha hasta" value={dateTo} onChange={(e: any) => setDateTo(typeof e === 'string' ? e : e?.target?.value ?? '')} />
        </div>
      </div>

      <div className="overflow-x-auto rounded">
        <table className="w-full table-auto divide-y border border-zinc-100 dark:border-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            {table.getHeaderGroups().map((hg: HeaderGroup<AccessAttempt>) => (
              <tr key={hg.id}>
                {hg.headers.map((h: any) => (
                  <th key={h.id} className="px-2 py-2 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row: Row<AccessAttempt>) => (
              <tr key={row.id} className="border-t hover:bg-zinc-50 dark:hover:bg-zinc-800">
                {row.getVisibleCells().map((cell: Cell<AccessAttempt, any>) => (
                  <td key={cell.id} className="px-2 py-2 text-sm text-zinc-800 dark:text-zinc-200 align-top max-w-[12rem] truncate">
                    <div className="truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Mostrando {table.getRowModel().rows.length} resultados</div>
        <div className="flex items-center gap-2">
          <Button onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>Primera</Button>
          <Button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Anterior</Button>
          <div className="px-2">{table.getState().pagination.pageIndex + 1} / {table.getPageCount()}</div>
          <Button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Siguiente</Button>
          <Button onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>Última</Button>
        </div>
      </div>
    </div>
  )
}
