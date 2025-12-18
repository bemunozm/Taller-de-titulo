import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getFamilies } from '@/api/FamilyAPI'
import { Heading, Subheading } from '@/components/ui/Heading'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/Dialog'
import { PlusIcon, UsersIcon, CheckCircleIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { ChevronLeftIcon } from '@heroicons/react/20/solid'
import { FamilyForm } from '@/components/families/FamilyForm'
import { FamilyTable } from '@/components/families/FamilyTable'
import type { Family } from '@/types/index'

export default function FamiliesView() {
  const navigate = useNavigate()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedFamily, setSelectedFamily] = useState<Family | undefined>()

  const { data: families = [], isLoading } = useQuery({
    queryKey: ['families'],
    queryFn: getFamilies,
  })

  const handleCreate = () => {
    setSelectedFamily(undefined)
    setIsDialogOpen(true)
  }

  const handleEdit = (family: Family) => {
    setSelectedFamily(family)
    setIsDialogOpen(true)
  }

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setSelectedFamily(undefined)
  }

  // Calcular estadísticas
  const stats = {
    total: families.length,
    active: families.filter((f) => f.active).length,
    totalMembers: families.reduce((acc, f) => acc + (f.members?.length || 0), 0),
    withUnit: families.filter((f) => f.unit).length,
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando familias...
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
            <UsersIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            <div>
              <Heading>Gestión de Familias</Heading>
              <Subheading>
                Administra las familias del condominio
              </Subheading>
            </div>
          </div>
          <Button color="indigo" onClick={handleCreate}>
            <PlusIcon className="w-5 h-5" />
            Nueva Familia
          </Button>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Total */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <UsersIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Total de Familias
              </div>
            </div>
            <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {stats.total}
            </div>
          </div>

          {/* Active */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircleIcon className="w-6 h-6 text-lime-600 dark:text-lime-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Familias Activas
              </div>
            </div>
            <div className="text-3xl font-bold text-lime-600 dark:text-lime-400">
              {stats.active}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {stats.total > 0
                ? `${Math.round((stats.active / stats.total) * 100)}% del total`
                : '0% del total'}
            </div>
          </div>

          {/* Total Members */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <UserGroupIcon className="w-6 h-6 text-sky-600 dark:text-sky-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Total de Miembros
              </div>
            </div>
            <div className="text-3xl font-bold text-sky-600 dark:text-sky-400">
              {stats.totalMembers}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {stats.total > 0
                ? `${(stats.totalMembers / stats.total).toFixed(1)} miembros por familia`
                : 'Sin miembros'}
            </div>
          </div>

          {/* With Unit */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-6 h-6 text-amber-600 dark:text-amber-400">
                <svg
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                  />
                </svg>
              </div>
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Con Unidad Asignada
              </div>
            </div>
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              {stats.withUnit}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {stats.total > 0
                ? `${Math.round((stats.withUnit / stats.total) * 100)}% del total`
                : '0% del total'}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg bg-white dark:bg-zinc-900 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10 p-6">
          <FamilyTable families={families} onEdit={handleEdit} />
        </div>
      </div>

      {/* Dialog for Create/Edit */}
      <Dialog open={isDialogOpen} onClose={handleCloseDialog}>
        <DialogTitle>{selectedFamily ? 'Editar Familia' : 'Nueva Familia'}</DialogTitle>
        <DialogDescription>
          {selectedFamily
            ? 'Actualiza la información de la familia'
            : 'Completa los datos para crear una nueva familia'}
        </DialogDescription>
        <DialogBody>
          <FamilyForm family={selectedFamily} onSuccess={handleCloseDialog} />
        </DialogBody>
      </Dialog>
    </>
  )
}
