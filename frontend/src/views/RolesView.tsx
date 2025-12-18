import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listRoles } from '@/api/RoleAPI'
import { RoleTable } from '@/components/roles/RoleTable'
import { Button } from '@/components/ui/Button'
import { Heading, Subheading } from '@/components/ui/Heading'
import { 
  PlusIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  KeyIcon,
} from '@heroicons/react/24/outline'
import { ChevronLeftIcon } from '@heroicons/react/20/solid'

export function RolesView() {
  const navigate = useNavigate()

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: listRoles,
  })

  const handleCreate = () => {
    navigate('/roles/create')
  }

  // Calcular estadísticas
  const stats = {
    total: roles.length,
    withPermissions: roles.filter((r) => r.permissions && r.permissions.length > 0).length,
    totalPermissions: roles.reduce((acc, r) => acc + (r.permissions?.length || 0), 0),
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando roles...
        </span>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      <Button plain onClick={() => navigate('/settings')} className="mb-4 text-zinc-400 hover:text-white">
        <ChevronLeftIcon className="h-5 w-5" />
        Volver a Configuraciones
      </Button>
      
      {/* Header */}
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheckIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          <div>
            <Heading>Gestión de Roles</Heading>
            <Subheading>
              Administra los roles y permisos del sistema
            </Subheading>
          </div>
        </div>
        <Button color="indigo" onClick={handleCreate}>
          <PlusIcon className="w-5 h-5" />
          Nuevo Rol
        </Button>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Total Roles */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheckIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total de Roles
            </div>
          </div>
          <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {stats.total}
          </div>
        </div>

        {/* Roles with Permissions */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <UserGroupIcon className="w-6 h-6 text-lime-600 dark:text-lime-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Roles con Permisos
            </div>
          </div>
          <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {stats.withPermissions}
          </div>
        </div>

        {/* Total Permissions Assigned */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <KeyIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Permisos Asignados
            </div>
          </div>
          <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {stats.totalPermissions}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <RoleTable roles={roles} />
      </div>
    </div>
  )
}
