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
import { deleteVehicle } from '@/api/VehicleAPI'
import { useAuth } from '@/hooks/useAuth'
import type { Vehicle } from '@/types/index'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { 
  PencilIcon, 
  TrashIcon, 
  ChevronUpIcon, 
  ChevronDownIcon, 
  EllipsisVerticalIcon 
} from '@heroicons/react/24/outline'
import { Input } from '@/components/ui/Input'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/ui/Dropdown'
import { Alert, AlertTitle, AlertDescription, AlertActions } from '@/components/ui/Alert'

interface VehicleTableProps {
  vehicles: Vehicle[]
  onEdit: (vehicle: Vehicle) => void
}

const columnHelper = createColumnHelper<Vehicle>()

export function VehicleTable({ vehicles, onEdit }: VehicleTableProps) {
  const { data: user } = useAuth()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false)
  const [selectedVehicleForDelete, setSelectedVehicleForDelete] = useState<Vehicle | null>(null)

  const deleteMutation = useMutation({
    mutationFn: deleteVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success('Vehículo eliminado exitosamente')
      setDeleteAlertOpen(false)
      setSelectedVehicleForDelete(null)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al eliminar el vehículo')
      setDeleteAlertOpen(false)
    },
  })

  const handleDeleteClick = (vehicle: Vehicle) => {
    setSelectedVehicleForDelete(vehicle)
    setDeleteAlertOpen(true)
  }

  const confirmDelete = () => {
    if (selectedVehicleForDelete) {
      deleteMutation.mutate(selectedVehicleForDelete.id)
    }
  }

  // Verificar si el usuario puede editar/eliminar un vehículo
  const canModifyVehicle = (vehicle: Vehicle) => {
    if (!user) return false
    
    // Administradores pueden editar/eliminar cualquier vehículo
    const isAdmin = user.roles?.some(role => 
      role.name === 'Super Administrador' || role.name === 'Administrador'
    )
    if (isAdmin) return true
    
    // Residentes solo pueden editar/eliminar sus propios vehículos
    return vehicle.owner?.id === user.id
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('plate', {
        header: 'Patente',
        cell: (info) => <span className="font-mono font-semibold">{info.getValue()}</span>,
      }),
      columnHelper.accessor('brand', {
        header: 'Marca',
        cell: (info) => info.getValue() || '-',
      }),
      columnHelper.accessor('model', {
        header: 'Modelo',
        cell: (info) => info.getValue() || '-',
      }),
      columnHelper.accessor('color', {
        header: 'Color',
        cell: (info) => info.getValue() || '-',
      }),
      columnHelper.accessor('year', {
        header: 'Año',
        cell: (info) => info.getValue() || '-',
      }),
      columnHelper.accessor('vehicleType', {
        header: 'Tipo',
        cell: (info) => {
          const type = info.getValue()
          return type ? (
            <Badge color="indigo">{type}</Badge>
          ) : (
            '-'
          )
        },
      }),
      columnHelper.accessor('owner', {
        header: 'Propietario',
        cell: (info) => {
          const owner = info.getValue()
          return owner ? owner.name : '-'
        },
        enableSorting: false,
      }),
      columnHelper.accessor('active', {
        header: 'Estado',
        cell: (info) => (
          <Badge color={info.getValue() ? 'lime' : 'zinc'}>
            {info.getValue() ? 'Activo' : 'Inactivo'}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: () => <span className="text-right block">Acciones</span>,
        cell: (info) => {
          const vehicle = info.row.original
          const canModify = canModifyVehicle(vehicle)
          
          return (
            <div className="flex justify-end">
              <Dropdown>
                <DropdownButton plain disabled={!canModify}>
                  <EllipsisVerticalIcon className="w-5 h-5" />
                </DropdownButton>
                {canModify && (
                  <DropdownMenu anchor="bottom end">
                    <DropdownItem onClick={() => onEdit(vehicle)}>
                      <PencilIcon className="w-4 h-4" />
                      <span>Editar</span>
                    </DropdownItem>
                    <DropdownItem onClick={() => handleDeleteClick(vehicle)}>
                      <TrashIcon className="w-4 h-4 text-red-600" />
                      <span>Eliminar</span>
                    </DropdownItem>
                  </DropdownMenu>
                )}
              </Dropdown>
            </div>
          )
        },
      }),
    ],
    [onEdit, user]
  )

  const table = useReactTable({
    data: vehicles,
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

  if (vehicles.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 dark:text-zinc-400">
          No hay vehículos registrados
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="flex items-center gap-4">
        <Input
          placeholder="Buscar por patente, marca, modelo..."
          value={globalFilter ?? ''}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {table.getFilteredRowModel().rows.length} vehículos encontrados
        </div>
      </div>

      {/* Table */}
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
                  <div className="flex items-center gap-2">
                    {flexRender(header.column.columnDef.header, header.getContext())}
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

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
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

      {/* Alert de confirmación de eliminación */}
      <Alert open={deleteAlertOpen} onClose={() => setDeleteAlertOpen(false)}>
        <AlertTitle>Confirmar Eliminación</AlertTitle>
        <AlertDescription>
          ¿Estás seguro de que deseas eliminar el vehículo con patente{' '}
          <span className="font-mono font-semibold">{selectedVehicleForDelete?.plate}</span>?
          Esta acción no se puede deshacer.
        </AlertDescription>
        <AlertActions>
          <Button plain onClick={() => setDeleteAlertOpen(false)}>
            Cancelar
          </Button>
          <Button color="red" onClick={confirmDelete} disabled={deleteMutation.isPending}>
            <TrashIcon className="w-4 h-4" />
            {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </AlertActions>
      </Alert>
    </div>
  )
}
