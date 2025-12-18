import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table'
import { toast } from 'react-toastify'
import { deleteUnit } from '@/api/UnitAPI'
import type { Unit } from '@/types/index'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { 
  PencilIcon, 
  TrashIcon, 
  EllipsisVerticalIcon,
  ChevronUpIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline'
import { Input } from '@/components/ui/Input'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/ui/Dropdown'
import { Alert, AlertActions, AlertDescription, AlertTitle } from '@/components/ui/Alert'

interface UnitTableProps {
  units: Unit[]
  onEdit: (unit: Unit) => void
}

const columnHelper = createColumnHelper<Unit>()

export function UnitTable({ units, onEdit }: UnitTableProps) {
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false)
  const [selectedUnitForDelete, setSelectedUnitForDelete] = useState<Unit | null>(null)

  const deleteMutation = useMutation({
    mutationFn: deleteUnit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units'] })
      queryClient.invalidateQueries({ queryKey: ['availableUnits'] })
      queryClient.invalidateQueries({ queryKey: ['unitStats'] })
      toast.success('Unidad desactivada exitosamente')
      setDeleteAlertOpen(false)
      setSelectedUnitForDelete(null)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al eliminar la unidad')
      setDeleteAlertOpen(false)
    },
  })

  const handleDelete = (unit: Unit) => {
    setSelectedUnitForDelete(unit)
    setDeleteAlertOpen(true)
  }

  const confirmDelete = () => {
    if (selectedUnitForDelete) {
      deleteMutation.mutate(selectedUnitForDelete.id)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('identifier', {
        header: 'Identificador',
        cell: (info) => (
          <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('block', {
        header: 'Bloque',
        cell: (info) => info.getValue() || '-',
      }),
      columnHelper.accessor('number', {
        header: 'Número',
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor('floor', {
        header: 'Piso',
        cell: (info) => {
          const floor = info.getValue()
          if (floor === null || floor === undefined) return '-'
          if (floor < 0) return `S${Math.abs(floor)}` // Subterráneo
          return floor.toString()
        },
      }),
      columnHelper.accessor('type', {
        header: 'Tipo',
        cell: (info) => info.getValue() || '-',
      }),
      columnHelper.accessor('active', {
        header: 'Estado',
        cell: (info) => (
          <Badge color={info.getValue() ? 'lime' : 'zinc'}>
            {info.getValue() ? 'Activa' : 'Inactiva'}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: () => <span className="text-right block">Acciones</span>,
        cell: (info) => (
          <div className="flex justify-end">
            <Dropdown>
              <DropdownButton plain>
                <EllipsisVerticalIcon className="w-5 h-5" />
              </DropdownButton>
              <DropdownMenu anchor="bottom end">
                <DropdownItem onClick={() => onEdit(info.row.original)}>
                  <PencilIcon className="w-4 h-4" />
                  <span>Editar</span>
                </DropdownItem>
                <DropdownItem onClick={() => handleDelete(info.row.original)}>
                  <TrashIcon className="w-4 h-4 text-red-600" />
                  <span>Desactivar</span>
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </div>
        ),
      }),
    ],
    [onEdit]
  )

  const table = useReactTable({
    data: units,
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
        pageSize: 10,
      },
    },
  })

  if (units.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 dark:text-zinc-400">
          No hay unidades registradas
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Búsqueda global */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Input
            type="search"
            placeholder="Buscar por identificador, bloque, número..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHeader
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
                  >
                    {header.isPlaceholder ? null : (
                      <div className="flex items-center gap-2">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {header.column.getCanSort() && (
                          <span className="text-zinc-400">
                            {header.column.getIsSorted() === 'asc' ? (
                              <ChevronUpIcon className="w-4 h-4" />
                            ) : header.column.getIsSorted() === 'desc' ? (
                              <ChevronDownIcon className="w-4 h-4" />
                            ) : (
                              <div className="w-4 h-4" />
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </TableHeader>
                ))}
              </TableRow>
            ))}
          </TableHead>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Paginación */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between pt-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Página {table.getState().pagination.pageIndex + 1} de{' '}
            {table.getPageCount()} ({units.length} unidades)
          </div>
          <div className="flex gap-2">
            <Button
              plain
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Anterior
            </Button>
            <Button
              plain
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* Alert de confirmación de desactivación */}
      <Alert open={deleteAlertOpen} onClose={() => setDeleteAlertOpen(false)}>
        <AlertTitle>Confirmar Desactivación</AlertTitle>
        <AlertDescription>
          ¿Estás seguro de que deseas desactivar la unidad "{selectedUnitForDelete?.identifier}"?
          Esta acción cambiará su estado a inactiva.
        </AlertDescription>
        <AlertActions>
          <Button plain onClick={() => setDeleteAlertOpen(false)}>
            Cancelar
          </Button>
          <Button color="red" onClick={confirmDelete}>
            <TrashIcon className="w-4 h-4" />
            Desactivar
          </Button>
        </AlertActions>
      </Alert>
    </div>
  )
}
