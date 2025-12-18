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
import { deleteFamily } from '@/api/FamilyAPI'
import type { Family } from '@/types/index'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { 
  PencilIcon, 
  TrashIcon, 
  EllipsisVerticalIcon, 
  UserGroupIcon,
  ChevronUpIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline'
import { Input } from '@/components/ui/Input'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/ui/Dropdown'
import { Alert, AlertActions, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import { FamilyMembersModal } from './FamilyMembersModal'

interface FamilyTableProps {
  families: Family[]
  onEdit: (family: Family) => void
}

const columnHelper = createColumnHelper<Family>()

export function FamilyTable({ families, onEdit }: FamilyTableProps) {
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [membersModalOpen, setMembersModalOpen] = useState(false)
  const [selectedFamily, setSelectedFamily] = useState<Family | null>(null)
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false)
  const [selectedFamilyForDelete, setSelectedFamilyForDelete] = useState<Family | null>(null)

  const deleteMutation = useMutation({
    mutationFn: deleteFamily,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['families'] })
      toast.success('Familia eliminada exitosamente')
      setDeleteAlertOpen(false)
      setSelectedFamilyForDelete(null)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al eliminar la familia')
      setDeleteAlertOpen(false)
    },
  })

  const handleDelete = (family: Family) => {
    setSelectedFamilyForDelete(family)
    setDeleteAlertOpen(true)
  }

  const confirmDelete = () => {
    if (selectedFamilyForDelete) {
      deleteMutation.mutate(selectedFamilyForDelete.id)
    }
  }

  const handleManageMembers = (family: Family) => {
    setSelectedFamily(family)
    setMembersModalOpen(true)
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Nombre',
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      }),
      columnHelper.accessor('unit', {
        header: 'Unidad',
        cell: (info) => {
          const unit = info.getValue()
          return unit ? (
            <div>
              <div className="font-medium">{unit.identifier}</div>
              {unit.type && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {unit.type}
                </div>
              )}
            </div>
          ) : (
            <span className="text-zinc-400">Sin asignar</span>
          )
        },
      }),
      columnHelper.accessor('description', {
        header: 'Descripción',
        cell: (info) => (
          <span className="max-w-xs truncate block">
            {info.getValue() || '-'}
          </span>
        ),
      }),
      columnHelper.accessor('active', {
        header: 'Estado',
        cell: (info) => (
          <Badge color={info.getValue() ? 'lime' : 'zinc'}>
            {info.getValue() ? 'Activa' : 'Inactiva'}
          </Badge>
        ),
      }),
      columnHelper.accessor('members', {
        header: 'Miembros',
        cell: (info) => info.getValue()?.length || 0,
        enableSorting: false,
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
                <DropdownItem onClick={() => handleManageMembers(info.row.original)}>
                  <UserGroupIcon className="w-4 h-4" />
                  <span>Gestionar Miembros</span>
                </DropdownItem>
                <DropdownItem onClick={() => onEdit(info.row.original)}>
                  <PencilIcon className="w-4 h-4" />
                  <span>Editar</span>
                </DropdownItem>
                <DropdownItem onClick={() => handleDelete(info.row.original)}>
                  <TrashIcon className="w-4 h-4 text-red-600" />
                  <span>Eliminar</span>
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
    data: families,
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

  if (families.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 dark:text-zinc-400">
          No hay familias registradas
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="flex items-center gap-4">
        <Input
          placeholder="Buscar por nombre, departamento..."
          value={globalFilter ?? ''}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {table.getFilteredRowModel().rows.length} familias encontradas
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

      {/* Modal de gestión de miembros */}
      <FamilyMembersModal
        isOpen={membersModalOpen}
        onClose={() => setMembersModalOpen(false)}
        family={selectedFamily}
      />

      {/* Alert de confirmación de eliminación */}
      <Alert open={deleteAlertOpen} onClose={() => setDeleteAlertOpen(false)}>
        <AlertTitle>Confirmar Eliminación</AlertTitle>
        <AlertDescription>
          ¿Estás seguro de que deseas eliminar la familia "{selectedFamilyForDelete?.name}"?
          Esta acción no se puede deshacer.
        </AlertDescription>
        <AlertActions>
          <Button plain onClick={() => setDeleteAlertOpen(false)}>
            Cancelar
          </Button>
          <Button color="red" onClick={confirmDelete}>
            <TrashIcon className="w-4 h-4" />
            Eliminar
          </Button>
        </AlertActions>
      </Alert>
    </div>
  )
}
