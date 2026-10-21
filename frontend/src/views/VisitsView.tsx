import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVisits } from '@/api/VisitAPI'
import type { Visit, VisitStatus } from '@/types/index'
import { toast } from 'react-toastify'
import {
  canShowVisitQr,
  countVisitsByStatus,
  getVisitStatusPluralLabel,
  isVisitQrWithheld,
  VISIT_QR_WITHHELD_MESSAGE,
} from '@/helpers/visitStatus'
import { VisitForm } from '@/components/visits/VisitForm'
import { VisitTable } from '@/components/visits/VisitTable'
import { QRCodeModal } from '@/components/visits/QRCodeModal'
import { Dialog, DialogTitle, DialogDescription, DialogBody } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Heading, Subheading } from '@/components/ui/Heading'
import { PlusIcon } from '@heroicons/react/16/solid'

interface StatusStatCard {
  status: VisitStatus
  valueClassName: string
  hint: string
}

// Tarjetas de estado en orden del ciclo de vida.
const STATUS_STAT_CARDS: readonly StatusStatCard[] = [
  {
    status: 'awaiting_approval',
    valueClassName: 'text-orange-600 dark:text-orange-400',
    hint: 'Sin respuesta del residente',
  },
  { status: 'pending', valueClassName: 'text-amber-600 dark:text-amber-400', hint: 'Nunca ingresaron' },
  { status: 'active', valueClassName: 'text-lime-600 dark:text-lime-400', hint: 'Dentro del condominio' },
  { status: 'ready', valueClassName: 'text-cyan-600 dark:text-cyan-400', hint: 'Pueden volver a entrar' },
  { status: 'completed', valueClassName: 'text-sky-600 dark:text-sky-400', hint: 'Finalizadas' },
]

export function VisitsView() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedVisit, setSelectedVisit] = useState<Visit | undefined>()
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [createdVisit, setCreatedVisit] = useState<Visit | null>(null)

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ['visits'],
    queryFn: getVisits,
  })

  const handleEdit = (visit: Visit) => {
    setSelectedVisit(visit)
    setIsDialogOpen(true)
  }

  const handleCreate = () => {
    setSelectedVisit(undefined)
    setIsDialogOpen(true)
  }

  const handleCloseDialog = (createdVisit?: Visit) => {
    setIsDialogOpen(false)
    setSelectedVisit(undefined)
    
    // Si se creó una visita nueva, mostrar el QR (solo lo recibe el anfitrión
    // y su familia: al crearla para otro llega `qrCode: null` y no hay modal).
    if (createdVisit && canShowVisitQr(createdVisit)) {
      setCreatedVisit(createdVisit)
      setQrModalOpen(true)
    } else if (createdVisit && isVisitQrWithheld(createdVisit)) {
      toast.info(VISIT_QR_WITHHELD_MESSAGE)
    }
  }

  // Calcular estadísticas
  const stats = {
    total: visits.length,
    byStatus: countVisitsByStatus(visits),
    vehicular: visits.filter((v) => v.type === 'vehicular').length,
    pedestrian: visits.filter((v) => v.type === 'pedestrian').length,
    // `qrCode` solo llega a la familia del anfitrión (P5.C): se cuentan los QR visibles.
    withQR: visits.filter((v) => canShowVisitQr(v)).length,
    multiUse: visits.filter((v) => v.maxUses && v.maxUses > 1).length,
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-zinc-600 dark:text-zinc-400">
          Cargando visitas...
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading>Gestión de Visitas</Heading>
          <Subheading>
            Administra las visitas vehiculares y peatonales del condominio
          </Subheading>
        </div>
        <Button color="indigo" onClick={handleCreate}>
          <PlusIcon />
          Nueva Visita
        </Button>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {/* Total */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Total de Visitas
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {stats.total}
          </div>
        </div>

        {STATUS_STAT_CARDS.map(({ status, valueClassName, hint }) => (
          <div
            key={status}
            className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700"
          >
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              {getVisitStatusPluralLabel(status)}
            </div>
            <div className={`text-2xl font-bold mt-1 ${valueClassName}`}>
              {stats.byStatus[status]}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {hint}
            </div>
          </div>
        ))}
      </div>

      {/* Type Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-purple-700 dark:text-purple-300">
                Visitas Vehiculares
              </div>
              <div className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-1">
                {stats.vehicular}
              </div>
            </div>
            <div className="text-4xl">🚗</div>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-blue-700 dark:text-blue-300">
                Visitas Peatonales
              </div>
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1">
                {stats.pedestrian}
              </div>
            </div>
            <div className="text-4xl">🚶</div>
          </div>
        </div>

        <div className="bg-cyan-50 dark:bg-cyan-900/20 rounded-lg p-4 border border-cyan-200 dark:border-cyan-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-cyan-700 dark:text-cyan-300">
                QR Disponibles
              </div>
              <div className="text-2xl font-bold text-cyan-900 dark:text-cyan-100 mt-1">
                {stats.withQR}
              </div>
              <div className="text-xs text-cyan-600 dark:text-cyan-400 mt-1">
                Solo visitas de tu familia
              </div>
            </div>
            <div className="text-4xl">📱</div>
          </div>
        </div>

        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-emerald-700 dark:text-emerald-300">
                Multi-Uso
              </div>
              <div className="text-2xl font-bold text-emerald-900 dark:text-emerald-100 mt-1">
                {stats.multiUse}
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                Múltiples ingresos
              </div>
            </div>
            <div className="text-4xl">🔄</div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg bg-white dark:bg-zinc-900 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10 p-6">
        <VisitTable visits={visits} onEdit={handleEdit} />
      </div>

      {/* Dialog for Create/Edit */}
      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)} size="4xl">
        <DialogTitle>
          {selectedVisit ? 'Editar Visita' : 'Nueva Visita'}
        </DialogTitle>
        <DialogDescription>
          {selectedVisit
            ? 'Modifica la información de la visita'
            : 'Completa el formulario para registrar una nueva visita'}
        </DialogDescription>
        <DialogBody>
          <VisitForm
            visit={selectedVisit}
            onSuccess={handleCloseDialog}
          />
        </DialogBody>
      </Dialog>

      {/* QR Code Modal */}
      <QRCodeModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        visit={createdVisit}
      />
    </div>
  )
}
