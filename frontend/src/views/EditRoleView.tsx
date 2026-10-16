import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { getRoleById, updateRole, updateRolePermissions } from '@/api/RoleAPI'
import type { RoleFormData } from '@/types/index'
import { RoleForm } from '@/components/roles/RoleForm'
import { Button } from '@/components/ui/Button'
import { Heading, Subheading } from '@/components/ui/Heading'
import { ArrowLeftIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'

export function EditRoleView() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const { data: role, isLoading } = useQuery({
    queryKey: ['roles', id],
    queryFn: () => getRoleById(id!),
    enabled: !!id,
  })

  const updateMutation = useMutation({
    mutationFn: async (data: RoleFormData) => {
      if (!id) throw new Error('ID de rol no proporcionado')
      
      // Primero actualizar la información básica del rol
      const { permissionIds, ...basicData } = data
      await updateRole(id, basicData)
      
      // Luego actualizar los permisos si fueron proporcionados
      if (permissionIds) {
        await updateRolePermissions(id, permissionIds)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      queryClient.invalidateQueries({ queryKey: ['roles', id] })
      toast.success('Rol actualizado exitosamente')
      navigate('/settings/roles')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al actualizar el rol')
    },
  })

  const handleSubmit = (data: RoleFormData) => {
    updateMutation.mutate(data)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando rol...
        </span>
      </div>
    )
  }

  if (!role) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-center">
          <p className="text-zinc-600 dark:text-zinc-400">Rol no encontrado</p>
          <Button className="mt-4" onClick={() => navigate('/settings/roles')}>
            Volver a roles
          </Button>
        </div>
      </div>
    )
  }

  // Un rol de sistema es inmutable por la API (403): ni el super-admin lo edita.
  if (role.isSystem) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-center">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            "{role.name}" es un rol de sistema
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Sus permisos se definen en el código y no se modifican desde aquí.
          </p>
          <Button className="mt-4" onClick={() => navigate('/settings/roles')}>
            Volver a roles
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Button plain onClick={() => navigate('/settings/roles')}>
            <ArrowLeftIcon className="w-5 h-5" />
            Volver
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <ShieldCheckIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          <div>
            <Heading>Editar Rol</Heading>
            <Subheading>
              Modifica la información y permisos del rol "{role.name}"
            </Subheading>
          </div>
        </div>
      </header>

      {/* Form */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <RoleForm
          role={role}
          onSubmit={handleSubmit}
          isSubmitting={updateMutation.isPending}
        />
      </div>
    </div>
  )
}
