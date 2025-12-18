import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles } from '@/api/VehicleAPI'
import type { Vehicle } from '@/types/index'
import { VehicleForm } from '@/components/vehicles/VehicleForm'
import { VehicleTable } from '@/components/vehicles/VehicleTable'
import { Dialog, DialogTitle, DialogDescription, DialogBody } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { PlusIcon } from '@heroicons/react/16/solid'

export function VehiclesView() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: getVehicles,
  })

  const handleEdit = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle)
    setIsDialogOpen(true)
  }

  const handleCreate = () => {
    setSelectedVehicle(null)
    setIsDialogOpen(true)
  }

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setSelectedVehicle(null)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-zinc-600 dark:text-zinc-400">
          Cargando vehículos...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            Gestión de Vehículos
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Administra los vehículos registrados en el sistema
          </p>
        </div>
        <Button color="dark/zinc" onClick={handleCreate}>
          <PlusIcon className="w-5 h-5" />
          Nuevo Vehículo
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Total de Vehículos
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {vehicles.length}
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Vehículos Activos
          </div>
          <div className="text-2xl font-bold text-lime-600 dark:text-lime-400 mt-1">
            {vehicles.filter((v) => v.active).length}
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Vehículos Inactivos
          </div>
          <div className="text-2xl font-bold text-zinc-600 dark:text-zinc-400 mt-1">
            {vehicles.filter((v) => !v.active).length}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg bg-white dark:bg-zinc-900 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10 p-6">
        <VehicleTable vehicles={vehicles} onEdit={handleEdit} />
      </div>

      {/* Dialog for Create/Edit */}
      <Dialog open={isDialogOpen} onClose={handleCloseDialog}>
        <DialogTitle>
          {selectedVehicle ? 'Editar Vehículo' : 'Nuevo Vehículo'}
        </DialogTitle>
        <DialogDescription>
          {selectedVehicle
            ? 'Modifica la información del vehículo'
            : 'Completa el formulario para registrar un nuevo vehículo'}
        </DialogDescription>
        <DialogBody>
          <VehicleForm
            key={selectedVehicle?.id || 'new'}
            vehicle={selectedVehicle || undefined}
            onSuccess={handleCloseDialog}
          />
        </DialogBody>
      </Dialog>
    </div>
  )
}
