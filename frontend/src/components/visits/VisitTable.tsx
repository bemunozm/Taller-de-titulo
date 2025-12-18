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
import { deleteVisit, checkInVisit, checkOutVisit, cancelVisit } from '@/api/VisitAPI'
import type { Visit } from '@/types/index'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { 
  PencilIcon, 
  TrashIcon, 
  ChevronUpIcon, 
  ChevronDownIcon,
  ArrowRightEndOnRectangleIcon,
  ArrowLeftEndOnRectangleIcon,
  XMarkIcon,
  EyeIcon,
  QrCodeIcon,
  EllipsisVerticalIcon
} from '@heroicons/react/16/solid'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { formatDateTime } from '@/helpers/index'
import { QRCodeModal } from './QRCodeModal'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/ui/Dropdown'
import { Dialog, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/Dialog'
import { Protected } from '@/components/auth/Protected'

interface VisitTableProps {
  visits: Visit[]
  onEdit: (visit: Visit) => void
  onViewDetail?: (visit: Visit) => void
}

const columnHelper = createColumnHelper<Visit>()

// Modal de confirmación genérico
interface ConfirmActionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmLabel: string
  confirmColor?: 'red' | 'lime' | 'sky' | 'amber'
}

function ConfirmActionModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  confirmColor = 'red',
}: ConfirmActionModalProps) {
  return (
    <Dialog open={isOpen} onClose={onClose} size="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <DialogBody>
        <div className="flex justify-end gap-3 mt-6">
          <Button plain onClick={onClose}>
            Cancelar
          </Button>
          <Button color={confirmColor} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogBody>
    </Dialog>
  )
}

// Colores para los badges de estado
const statusColors = {
  pending: 'amber',
  active: 'lime',
  ready: 'cyan',
  completed: 'sky',
  cancelled: 'zinc',
  expired: 'rose',
  denied: 'red',
} as const

const statusLabels = {
  pending: 'Pendiente',
  active: 'Activa',
  ready: 'Lista para Reingresar',
  completed: 'Completada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  denied: 'Rechazada',
}

const typeColors = {
  vehicular: 'purple',
  pedestrian: 'blue',
} as const

const typeLabels = {
  vehicular: 'Vehicular',
  pedestrian: 'Peatonal',
}

export function VisitTable({ visits, onEdit, onViewDetail }: VisitTableProps) {
  const queryClient = useQueryClient()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)

  // Estados para modales de confirmación
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [checkInModalOpen, setCheckInModalOpen] = useState(false)
  const [checkOutModalOpen, setCheckOutModalOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [visitToAction, setVisitToAction] = useState<Visit | null>(null)

  const handleShowQR = (visit: Visit) => {
    setSelectedVisit(visit)
    setQrModalOpen(true)
  }

  const deleteMutation = useMutation({
    mutationFn: deleteVisit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success('Visita eliminada exitosamente')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al eliminar la visita')
    },
  })

  const checkInMutation = useMutation({
    mutationFn: checkInVisit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success('Check-in registrado exitosamente')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al registrar check-in')
    },
  })

  const checkOutMutation = useMutation({
    mutationFn: checkOutVisit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success('Check-out registrado exitosamente')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al registrar check-out')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelVisit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success('Visita cancelada exitosamente')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al cancelar la visita')
    },
  })

  const handleDelete = (visit: Visit) => {
    setVisitToAction(visit)
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (visitToAction) {
      deleteMutation.mutate(visitToAction.id)
    }
    setDeleteModalOpen(false)
    setVisitToAction(null)
  }

  const handleCheckIn = (visit: Visit) => {
    setVisitToAction(visit)
    setCheckInModalOpen(true)
  }

  const confirmCheckIn = () => {
    if (visitToAction) {
      checkInMutation.mutate(visitToAction.id)
    }
    setCheckInModalOpen(false)
    setVisitToAction(null)
  }

  const handleCheckOut = (visit: Visit) => {
    setVisitToAction(visit)
    setCheckOutModalOpen(true)
  }

  const confirmCheckOut = () => {
    if (visitToAction) {
      checkOutMutation.mutate(visitToAction.id)
    }
    setCheckOutModalOpen(false)
    setVisitToAction(null)
  }

  const handleCancel = (visit: Visit) => {
    setVisitToAction(visit)
    setCancelModalOpen(true)
  }

  const confirmCancel = () => {
    if (visitToAction) {
      cancelMutation.mutate(visitToAction.id)
    }
    setCancelModalOpen(false)
    setVisitToAction(null)
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('visitorName', {
        header: 'Visitante',
        cell: (info) => (
          <div>
            <div className="font-medium">{info.getValue()}</div>
            {info.row.original.visitorRut && (
              <div className="text-sm text-zinc-500">{info.row.original.visitorRut}</div>
            )}
          </div>
        ),
      }),
      columnHelper.accessor('type', {
        header: 'Tipo',
        cell: (info) => (
          <Badge color={typeColors[info.getValue()]}>
            {typeLabels[info.getValue()]}
          </Badge>
        ),
      }),
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: (info) => (
          <Badge color={statusColors[info.getValue()]}>
            {statusLabels[info.getValue()]}
          </Badge>
        ),
      }),
      columnHelper.accessor('validFrom', {
        header: 'Válido Desde',
        cell: (info) => formatDateTime(info.getValue()),
      }),
      columnHelper.accessor('validUntil', {
        header: 'Válido Hasta',
        cell: (info) => formatDateTime(info.getValue()),
      }),
      columnHelper.accessor('host', {
        header: 'Anfitrión',
        cell: (info) => {
          const host = info.getValue()
          return host ? host.name : '-'
        },
        enableSorting: false,
      }),
      columnHelper.accessor('vehicle', {
        header: 'Vehículo',
        cell: (info) => {
          const visit = info.row.original
          const vehicle = info.getValue()
          
          if (visit.type === 'vehicular' && vehicle) {
            return (
              <div>
                <div className="font-mono font-semibold">{vehicle.plate}</div>
                {vehicle.brand && (
                  <div className="text-sm text-zinc-500">
                    {vehicle.brand} {vehicle.model}
                  </div>
                )}
              </div>
            )
          }
          
          return '-'
        },
        enableSorting: false,
      }),
      columnHelper.display({
        id: 'uses',
        header: 'Usos',
        cell: (info) => {
          const visit = info.row.original
          if (visit.maxUses === null || visit.maxUses === undefined) {
            return (
              <div className="text-center">
                <div className="text-sm font-medium">{visit.usedCount || 0}</div>
                <div className="text-xs text-zinc-500">Ilimitado</div>
              </div>
            )
          }
          return (
            <div className="text-center">
              <div className="text-sm font-medium">
                {visit.usedCount || 0} / {visit.maxUses}
              </div>
              <div className="text-xs text-zinc-500">
                {visit.maxUses - (visit.usedCount || 0)} restantes
              </div>
            </div>
          )
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: () => <span className="text-right block">Acciones</span>,
        cell: (info) => {
          const visit = info.row.original
          const canCheckIn = visit.status === 'pending' || visit.status === 'ready'
          const canCheckOut = visit.status === 'active'
          const canCancel = visit.status === 'pending' || visit.status === 'active' || visit.status === 'ready'

          return (
            <div className="flex justify-end">
              <Dropdown>
                <DropdownButton plain>
                  <EllipsisVerticalIcon className="w-5 h-5" />
                </DropdownButton>
                <DropdownMenu anchor="bottom end">
                  {onViewDetail && (
                    <DropdownItem onClick={() => onViewDetail(visit)}>
                      <EyeIcon className="w-4 h-4" />
                      <span>Ver detalles</span>
                    </DropdownItem>
                  )}
                  
                  {visit.qrCode && (
                    <DropdownItem onClick={() => handleShowQR(visit)}>
                      <QrCodeIcon className="w-4 h-4" />
                      <span>Ver código QR</span>
                    </DropdownItem>
                  )}
                  
                  {canCheckIn && (
                    <Protected permission="visits.check-in">
                      <DropdownItem onClick={() => handleCheckIn(visit)}>
                        <ArrowRightEndOnRectangleIcon className="w-4 h-4 text-lime-600" />
                        <span>Registrar entrada</span>
                      </DropdownItem>
                    </Protected>
                  )}

                  {canCheckOut && (
                    <Protected permission="visits.check-out">
                      <DropdownItem onClick={() => handleCheckOut(visit)}>
                        <ArrowLeftEndOnRectangleIcon className="w-4 h-4 text-sky-600" />
                        <span>Registrar salida</span>
                      </DropdownItem>
                    </Protected>
                  )}

                  {canCancel && (
                    <DropdownItem onClick={() => handleCancel(visit)}>
                      <XMarkIcon className="w-4 h-4 text-amber-600" />
                      <span>Cancelar visita</span>
                    </DropdownItem>
                  )}

                  <Protected permission="visits.update" anyRole={['Administrador', 'Super Administrador']}>
                    <DropdownItem onClick={() => onEdit(visit)}>
                      <PencilIcon className="w-4 h-4" />
                      <span>Editar</span>
                    </DropdownItem>
                  </Protected>
                  
                  <Protected permission="visits.delete" anyRole={['Administrador', 'Super Administrador']}>
                    <DropdownItem onClick={() => handleDelete(visit)}>
                      <TrashIcon className="w-4 h-4 text-red-600" />
                      <span>Eliminar</span>
                    </DropdownItem>
                  </Protected>
                </DropdownMenu>
              </Dropdown>
            </div>
          )
        },
      }),
    ],
    [onEdit, onViewDetail]
  )

  // Filtrar por estado y tipo
  const filteredVisits = useMemo(() => {
    let filtered = visits

    if (statusFilter !== 'all') {
      filtered = filtered.filter((visit) => visit.status === statusFilter)
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter((visit) => visit.type === typeFilter)
    }

    return filtered
  }, [visits, statusFilter, typeFilter])

  const table = useReactTable({
    data: filteredVisits,
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

  if (visits.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 dark:text-zinc-400">
          No hay visitas registradas
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Input
          placeholder="Buscar por nombre, RUT, patente..."
          value={globalFilter ?? ''}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="flex-1"
        />
        
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full sm:w-48"
        >
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="active">Activas</option>
          <option value="ready">Listas para Reingresar</option>
          <option value="completed">Completadas</option>
          <option value="cancelled">Canceladas</option>
          <option value="expired">Expiradas</option>
          <option value="denied">Rechazadas</option>
        </Select>

        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full sm:w-48"
        >
          <option value="all">Todos los tipos</option>
          <option value="vehicular">Vehicular</option>
          <option value="pedestrian">Peatonal</option>
        </Select>

        <div className="text-sm text-zinc-600 dark:text-zinc-400 flex items-center">
          {table.getFilteredRowModel().rows.length} visitas
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
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}
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

      {/* QR Code Modal */}
      <QRCodeModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        visit={selectedVisit}
      />

      {/* Modal de confirmación para eliminar */}
      <ConfirmActionModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Eliminar Visita"
        description={`¿Estás seguro de que deseas eliminar la visita de "${visitToAction?.visitorName}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        confirmColor="red"
      />

      {/* Modal de confirmación para check-in */}
      <ConfirmActionModal
        isOpen={checkInModalOpen}
        onClose={() => setCheckInModalOpen(false)}
        onConfirm={confirmCheckIn}
        title="Registrar Entrada"
        description={`¿Confirmar la entrada de "${visitToAction?.visitorName}"?`}
        confirmLabel="Registrar Entrada"
        confirmColor="lime"
      />

      {/* Modal de confirmación para check-out */}
      <ConfirmActionModal
        isOpen={checkOutModalOpen}
        onClose={() => setCheckOutModalOpen(false)}
        onConfirm={confirmCheckOut}
        title="Registrar Salida"
        description={`¿Confirmar la salida de "${visitToAction?.visitorName}"?`}
        confirmLabel="Registrar Salida"
        confirmColor="sky"
      />

      {/* Modal de confirmación para cancelar */}
      <ConfirmActionModal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={confirmCancel}
        title="Cancelar Visita"
        description={`¿Estás seguro de que deseas cancelar la visita de "${visitToAction?.visitorName}"?`}
        confirmLabel="Cancelar Visita"
        confirmColor="amber"
      />
    </div>
  )
}
