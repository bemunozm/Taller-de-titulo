import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getUnits, getUnitStats, createBulkUnits } from '@/api/UnitAPI'
import { Heading, Subheading } from '@/components/ui/Heading'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/Dialog'
import { 
  PlusIcon, 
  Squares2X2Icon, 
  HomeModernIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline'
import { ChevronLeftIcon } from '@heroicons/react/20/solid'
import { UnitForm } from '@/components/units/UnitForm'
import BulkUnitsForm from '@/components/units/BulkUnitsForm'
import { UnitTable } from '@/components/units/UnitTable'
import { toast } from 'react-toastify'
import type { Unit, CreateBulkUnitsFormData } from '@/types/index'

export default function UnitsView() {
  const navigate = useNavigate()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false)
  const [selectedUnit, setSelectedUnit] = useState<Unit | undefined>()
  
  const queryClient = useQueryClient()

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['units'],
    queryFn: () => getUnits(false),
  })

  const { data: stats } = useQuery({
    queryKey: ['unitStats'],
    queryFn: getUnitStats,
  })

  const handleCreate = () => {
    setSelectedUnit(undefined)
    setIsDialogOpen(true)
  }

  const handleEdit = (unit: Unit) => {
    setSelectedUnit(unit)
    setIsDialogOpen(true)
  }

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setSelectedUnit(undefined)
  }

  const handleOpenBulkDialog = () => {
    setIsBulkDialogOpen(true)
  }

  const handleCloseBulkDialog = () => {
    setIsBulkDialogOpen(false)
  }

  const bulkCreateMutation = useMutation({
    mutationFn: createBulkUnits,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['units'] })
      queryClient.invalidateQueries({ queryKey: ['unitStats'] })
      handleCloseBulkDialog()

      const { created, skipped, total } = result
      if (skipped.length === 0) {
        toast.success(`✅ ${created.length} unidades creadas exitosamente`)
      } else {
        toast.success(
          `✅ Creadas: ${created.length} | ⚠️ Omitidas (duplicadas): ${skipped.length} de ${total} total`
        )
      }
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleBulkCreate = (formData: CreateBulkUnitsFormData) => {
    bulkCreateMutation.mutate(formData)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando unidades...
        </span>
      </div>
    )
  }

  return (
    <>
      <div className="max-w-7xl mx-auto">
        <Button plain onClick={() => navigate('/settings')} className="mb-4 text-zinc-400 hover:text-white">
          <ChevronLeftIcon className="h-5 w-5" />
          Volver a Configuraciones
        </Button>

        {/* Header */}
        <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <HomeModernIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            <div>
              <Heading>Gestión de Unidades</Heading>
              <Subheading>
                Administra las unidades (departamentos, casas, etc.) del condominio
              </Subheading>
            </div>
          </div>
          <div className="flex gap-2">
            <Button color="zinc" onClick={handleOpenBulkDialog}>
              <Squares2X2Icon className="w-5 h-5" />
              Creación Rápida
            </Button>
            <Button color="indigo" onClick={handleCreate}>
              <PlusIcon className="w-5 h-5" />
              Nueva Unidad
            </Button>
          </div>
          </header>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Total */}
            <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-3 mb-2">
                <HomeModernIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Total de Unidades
                </div>
              </div>
              <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                {stats.total}
              </div>
            </div>

            {/* Occupied */}
            <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircleIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Unidades Ocupadas
                </div>
              </div>
              <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                {stats.occupied}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {stats.total > 0
                  ? `${Math.round((stats.occupied / stats.total) * 100)}% del total`
                  : '0% del total'}
              </div>
            </div>

            {/* Available */}
            <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircleIcon className="w-6 h-6 text-lime-600 dark:text-lime-400" />
                <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Unidades Disponibles
                </div>
              </div>
              <div className="text-3xl font-bold text-lime-600 dark:text-lime-400">
                {stats.available}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {stats.total > 0
                  ? `${Math.round((stats.available / stats.total) * 100)}% del total`
                  : '0% del total'}
              </div>
            </div>

            {/* Inactive */}
            <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-3 mb-2">
                <XCircleIcon className="w-6 h-6 text-zinc-500 dark:text-zinc-400" />
                <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Unidades Inactivas
                </div>
              </div>
              <div className="text-3xl font-bold text-zinc-500 dark:text-zinc-400">
                {stats.inactive}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                No disponibles actualmente
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg bg-white dark:bg-zinc-900 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10 p-6">
          <UnitTable units={units} onEdit={handleEdit} />
        </div>
      </div>

      {/* Dialog for Create/Edit */}
      <Dialog open={isDialogOpen} onClose={handleCloseDialog}>
        <DialogTitle>{selectedUnit ? 'Editar Unidad' : 'Nueva Unidad'}</DialogTitle>
        <DialogDescription>
          {selectedUnit
            ? 'Actualiza la información de la unidad'
            : 'Completa los datos para crear una nueva unidad. El identificador se generará automáticamente.'}
        </DialogDescription>
        <DialogBody>
          <UnitForm unit={selectedUnit} onSuccess={handleCloseDialog} />
        </DialogBody>
      </Dialog>

      {/* Dialog for Bulk Create */}
      <Dialog open={isBulkDialogOpen} onClose={handleCloseBulkDialog}>
        <DialogTitle>Creación Rápida de Unidades</DialogTitle>
        <DialogDescription>
          Crea múltiples unidades en un rango numérico. Las unidades duplicadas serán omitidas automáticamente.
        </DialogDescription>
        <DialogBody>
          <BulkUnitsForm onSubmit={handleBulkCreate} onCancel={handleCloseBulkDialog} />
        </DialogBody>
      </Dialog>
    </>
  )
}
