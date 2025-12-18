import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
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
import { deleteRole } from '@/api/RoleAPI'
import type { Role } from '@/types/index'
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Dropdown, DropdownButton, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown'
import { Alert, AlertTitle, AlertDescription, AlertActions } from '@/components/ui/Alert'
import { 
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  ChevronUpDownIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'

interface RoleTableProps {
  roles: Role[]
}

const columnHelper = createColumnHelper<Role>()

export function RoleTable({ roles }: RoleTableProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  
  // Estados para los diálogos de confirmación
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false)
  const [selectedRoleForAction, setSelectedRoleForAction] = useState<Role | null>(null)

  const deleteMutation = useMutation({
    mutationFn: deleteRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Rol eliminado exitosamente')
      setDeleteAlertOpen(false)
      setSelectedRoleForAction(null)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al eliminar el rol')
      setDeleteAlertOpen(false)
    },
  })

  const handleDelete = (role: Role) => {
    setSelectedRoleForAction(role)
    setDeleteAlertOpen(true)
  }

  const confirmDelete = () => {
    if (selectedRoleForAction) {
      deleteMutation.mutate(selectedRoleForAction.id)
    }
  }

  const handleEdit = (role: Role) => {
    navigate(`/roles/edit/${role.id}`)
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: ({ column }) => (
          <button
            className="flex items-center gap-2 font-semibold"
            onClick={() => column.toggleSorting()}
          >
            Nombre
            <ChevronUpDownIcon className="w-4 h-4" />
          </button>
        ),
        cell: (info) => (
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {info.getValue()}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor('description', {
        header: 'Descripción',
        cell: (info) => (
          <span className="text-zinc-600 dark:text-zinc-400">
            {info.getValue() || 'Sin descripción'}
          </span>
        ),
      }),
      columnHelper.accessor('permissions', {
        header: 'Permisos',
        cell: (info) => {
          const permissions = info.getValue() || []
          return (
            <div className="flex items-center gap-2">
              <Badge color="indigo">
                {permissions.length} {permissions.length === 1 ? 'permiso' : 'permisos'}
              </Badge>
            </div>
          )
        },
        enableSorting: false,
        enableColumnFilter: false,
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Acciones',
        cell: ({ row }) => (
          <Dropdown>
            <DropdownButton plain aria-label="Más opciones">
              <EllipsisVerticalIcon className="w-5 h-5" />
            </DropdownButton>
            <DropdownMenu anchor="bottom end">
              <DropdownItem onClick={() => handleEdit(row.original)}>
                <PencilIcon className="w-4 h-4" />
                Editar
              </DropdownItem>
              <DropdownItem onClick={() => handleDelete(row.original)}>
                <TrashIcon className="w-4 h-4" />
                Eliminar
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        ),
      }),
    ],
    []
  )

  const table = useReactTable({
    data: roles,
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

  return (
    <>
      <div className="space-y-4">
        {/* Search */}
        <div className="flex items-center gap-4">
          <Input
            placeholder="Buscar roles..."
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="max-w-sm"
          />
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {table.getFilteredRowModel().rows.length} roles encontrados
          </div>
        </div>

        {/* Table */}
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
                  <TableCell colSpan={columns.length} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2 text-zinc-500 dark:text-zinc-400">
                      <ShieldCheckIcon className="w-12 h-12" />
                      <p className="font-medium">No se encontraron roles</p>
                      <p className="text-sm">Intenta ajustar los filtros de búsqueda</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
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
      </div>

      {/* Delete Confirmation Alert */}
      <Alert
        open={deleteAlertOpen}
        onClose={() => {
          setDeleteAlertOpen(false)
          setSelectedRoleForAction(null)
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <ExclamationTriangleIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1">
            <AlertTitle>Eliminar Rol</AlertTitle>
            <AlertDescription>
              ¿Estás seguro de que deseas eliminar el rol <strong>{selectedRoleForAction?.name}</strong>?
              Esta acción no se puede deshacer y el rol será eliminado permanentemente.
            </AlertDescription>
          </div>
        </div>
        <AlertActions>
          <Button
            plain
            onClick={() => {
              setDeleteAlertOpen(false)
              setSelectedRoleForAction(null)
            }}
          >
            Cancelar
          </Button>
          <Button
            color="red"
            onClick={confirmDelete}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </AlertActions>
      </Alert>
    </>
  )
}
