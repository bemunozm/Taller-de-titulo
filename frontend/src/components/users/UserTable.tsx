import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { deleteUser, disableUser, enableUser } from '@/api/UserAPI'
import type { UserWithFamily } from '@/types/index'
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
  CheckCircleIcon,
  XCircleIcon,
  LockClosedIcon,
  LockOpenIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { formatDateTime } from '@/helpers/index'

interface UserTableProps {
  users: UserWithFamily[]
  onEdit: (user: UserWithFamily) => void
}

const columnHelper = createColumnHelper<UserWithFamily>()

export function UserTable({ users, onEdit }: UserTableProps) {
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  
  // Estados para los diálogos de confirmación
  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false)
  const [disableAlertOpen, setDisableAlertOpen] = useState(false)
  const [enableAlertOpen, setEnableAlertOpen] = useState(false)
  const [selectedUserForAction, setSelectedUserForAction] = useState<UserWithFamily | null>(null)

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Usuario eliminado exitosamente')
      setDeleteAlertOpen(false)
      setSelectedUserForAction(null)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al eliminar el usuario')
      setDeleteAlertOpen(false)
    },
  })

  const disableMutation = useMutation({
    mutationFn: disableUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Usuario deshabilitado exitosamente')
      setDisableAlertOpen(false)
      setSelectedUserForAction(null)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al deshabilitar el usuario')
      setDisableAlertOpen(false)
    },
  })

  const enableMutation = useMutation({
    mutationFn: enableUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Usuario habilitado exitosamente')
      setEnableAlertOpen(false)
      setSelectedUserForAction(null)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al habilitar el usuario')
      setEnableAlertOpen(false)
    },
  })

  const handleDelete = (user: UserWithFamily) => {
    setSelectedUserForAction(user)
    setDeleteAlertOpen(true)
  }

  const handleDisable = (user: UserWithFamily) => {
    setSelectedUserForAction(user)
    setDisableAlertOpen(true)
  }

  const handleEnable = (user: UserWithFamily) => {
    setSelectedUserForAction(user)
    setEnableAlertOpen(true)
  }

  const confirmDelete = () => {
    if (selectedUserForAction) {
      deleteMutation.mutate(selectedUserForAction.id)
    }
  }

  const confirmDisable = () => {
    if (selectedUserForAction) {
      disableMutation.mutate(selectedUserForAction.id)
    }
  }

  const confirmEnable = () => {
    if (selectedUserForAction) {
      enableMutation.mutate(selectedUserForAction.id)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Nombre',
        cell: (info) => (
          <div className="flex flex-col">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {info.getValue()}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {info.row.original.email}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor('rut', {
        header: 'RUT',
        cell: (info) => (
          <span className="font-mono text-sm">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('phone', {
        header: 'Teléfono',
        cell: (info) => info.getValue() || '-',
      }),
      columnHelper.accessor('age', {
        header: 'Edad',
        cell: (info) => (info.getValue() ? `${info.getValue()} años` : '-'),
      }),
      columnHelper.accessor('confirmed', {
        header: 'Estado',
        cell: (info) => {
          const user = info.row.original
          const isDisabled = !!user.deletedAt
          
          if (isDisabled) {
            return (
              <div className="flex items-center gap-2">
                <LockClosedIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
                <Badge color="red">Deshabilitado</Badge>
              </div>
            )
          }
          
          return (
            <div className="flex items-center gap-2">
              {info.getValue() ? (
                <>
                  <CheckCircleIcon className="w-5 h-5 text-lime-600 dark:text-lime-400" />
                  <Badge color="lime">Confirmado</Badge>
                </>
              ) : (
                <>
                  <XCircleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  <Badge color="amber">Pendiente</Badge>
                </>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor('roles', {
        header: 'Roles',
        cell: (info) => {
          const roles = info.getValue()
          if (!roles || roles.length === 0) {
            return <span className="text-zinc-500 dark:text-zinc-400">Sin roles</span>
          }
          return (
            <div className="flex flex-wrap gap-1">
              {roles.map((role) => (
                <Badge key={role.id} color="sky">
                  {role.name}
                </Badge>
              ))}
            </div>
          )
        },
        enableSorting: false,
      }),
      columnHelper.accessor('createdAt', {
        header: 'Fecha Registro',
        cell: (info) => (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDateTime(info.getValue())}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: () => <span className="text-right block">Acciones</span>,
        cell: (info) => {
          const user = info.row.original
          const isDisabled = !!user.deletedAt
          
          return (
            <div className="flex justify-end">
              <Dropdown>
                <DropdownButton plain>
                  <EllipsisVerticalIcon className="w-5 h-5" />
                </DropdownButton>
                <DropdownMenu anchor="bottom end">
                  <DropdownItem onClick={() => onEdit(user)}>
                    <PencilIcon className="w-4 h-4" />
                    Editar
                  </DropdownItem>
                  {isDisabled ? (
                    <DropdownItem onClick={() => handleEnable(user)}>
                      <LockOpenIcon className="w-4 h-4 text-green-600" />
                      Habilitar
                    </DropdownItem>
                  ) : (
                    <DropdownItem onClick={() => handleDisable(user)}>
                      <LockClosedIcon className="w-4 h-4 text-amber-600" />
                      Deshabilitar
                    </DropdownItem>
                  )}
                  <DropdownItem onClick={() => handleDelete(user)}>
                    <TrashIcon className="w-4 h-4 text-red-600" />
                    Eliminar
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            </div>
          )
        },
      }),
    ],
    [onEdit]
  )

  const table = useReactTable({
    data: users,
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

  if (users.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 dark:text-zinc-400">
          No hay usuarios registrados
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="flex items-center gap-4">
        <Input
          placeholder="Buscar por nombre, email, RUT..."
          value={globalFilter ?? ''}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {table.getFilteredRowModel().rows.length} usuarios encontrados
        </div>
      </div>

      {/* Table */}
      <Table>
        <TableHead>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHeader key={header.id}>
                  {header.isPlaceholder ? null : (
                    <div
                      className={
                        header.column.getCanSort()
                          ? 'cursor-pointer select-none flex items-center gap-2'
                          : ''
                      }
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {typeof header.column.columnDef.header === 'function'
                        ? header.column.columnDef.header(header.getContext())
                        : header.column.columnDef.header}
                      {header.column.getCanSort() && (
                        <ChevronUpDownIcon className="w-4 h-4" />
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
                  {typeof cell.column.columnDef.cell === 'function'
                    ? cell.column.columnDef.cell(cell.getContext())
                    : cell.getValue() as string}
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

      {/* Alert para confirmar eliminación */}
      <Alert open={deleteAlertOpen} onClose={() => setDeleteAlertOpen(false)}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20">
            <ExclamationTriangleIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <AlertTitle>Eliminar Usuario</AlertTitle>
        </div>
        <AlertDescription>
          ¿Estás seguro de eliminar al usuario <strong>"{selectedUserForAction?.name}"</strong>?
          <br />
          <br />
          Esta acción no se puede deshacer y se perderán todos los datos asociados.
        </AlertDescription>
        <AlertActions>
          <Button plain onClick={() => setDeleteAlertOpen(false)}>
            Cancelar
          </Button>
          <Button color="red" onClick={confirmDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </AlertActions>
      </Alert>

      {/* Alert para confirmar deshabilitación */}
      <Alert open={disableAlertOpen} onClose={() => setDisableAlertOpen(false)}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/20">
            <LockClosedIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <AlertTitle>Deshabilitar Usuario</AlertTitle>
        </div>
        <AlertDescription>
          ¿Estás seguro de deshabilitar al usuario <strong>"{selectedUserForAction?.name}"</strong>?
          <br />
          <br />
          El usuario no podrá iniciar sesión hasta que se habilite nuevamente. Los datos se conservarán.
        </AlertDescription>
        <AlertActions>
          <Button plain onClick={() => setDisableAlertOpen(false)}>
            Cancelar
          </Button>
          <Button color="amber" onClick={confirmDisable} disabled={disableMutation.isPending}>
            {disableMutation.isPending ? 'Deshabilitando...' : 'Deshabilitar'}
          </Button>
        </AlertActions>
      </Alert>

      {/* Alert para confirmar habilitación */}
      <Alert open={enableAlertOpen} onClose={() => setEnableAlertOpen(false)}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20">
            <LockOpenIcon className="w-6 h-6 text-green-600 dark:text-green-400" />
          </div>
          <AlertTitle>Habilitar Usuario</AlertTitle>
        </div>
        <AlertDescription>
          ¿Estás seguro de habilitar al usuario <strong>"{selectedUserForAction?.name}"</strong>?
          <br />
          <br />
          El usuario podrá volver a iniciar sesión en el sistema.
        </AlertDescription>
        <AlertActions>
          <Button plain onClick={() => setEnableAlertOpen(false)}>
            Cancelar
          </Button>
          <Button color="green" onClick={confirmEnable} disabled={enableMutation.isPending}>
            {enableMutation.isPending ? 'Habilitando...' : 'Habilitar'}
          </Button>
        </AlertActions>
      </Alert>
    </div>
  )
}
