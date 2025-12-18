import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { createRole } from '@/api/RoleAPI'
import type { RoleFormData } from '@/types/index'
import { RoleForm } from '@/components/roles/RoleForm'
import { Button } from '@/components/ui/Button'
import { Heading, Subheading } from '@/components/ui/Heading'
import { ArrowLeftIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'

export function CreateRoleView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: createRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Rol creado exitosamente')
      navigate('/roles')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear el rol')
    },
  })

  const handleSubmit = (data: RoleFormData) => {
    createMutation.mutate(data)
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Button plain onClick={() => navigate('/roles')}>
            <ArrowLeftIcon className="w-5 h-5" />
            Volver
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <ShieldCheckIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          <div>
            <Heading>Crear Nuevo Rol</Heading>
            <Subheading>
              Define un nuevo rol y asigna los permisos correspondientes
            </Subheading>
          </div>
        </div>
      </header>

      {/* Form */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <RoleForm
          onSubmit={handleSubmit}
          isSubmitting={createMutation.isPending}
        />
      </div>
    </div>
  )
}
