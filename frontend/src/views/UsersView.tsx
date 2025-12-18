import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getUsers } from '@/api/UserAPI'
import type { UserWithFamily } from '@/types/index'
import { UserForm } from '@/components/users/UserForm'
import { UserTable } from '@/components/users/UserTable'
import { Dialog, DialogTitle, DialogDescription, DialogBody } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Heading, Subheading } from '@/components/ui/Heading'
import { 
  PlusIcon,
  UserGroupIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { ChevronLeftIcon } from '@heroicons/react/20/solid'

export function UsersView() {
  const navigate = useNavigate()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserWithFamily | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const handleEdit = (user: UserWithFamily) => {
    setSelectedUser(user)
    setIsDialogOpen(true)
  }

  const handleCreate = () => {
    setSelectedUser(null)
    setIsDialogOpen(true)
  }

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setSelectedUser(null)
  }

  // Calcular estadísticas
  const stats = {
    total: users.length,
    confirmed: users.filter((u) => u.confirmed).length,
    pending: users.filter((u) => !u.confirmed).length,
    withRoles: users.filter((u) => u.roles && u.roles.length > 0).length,
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando usuarios...
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
            <UserGroupIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            <div>
              <Heading>Gestión de Usuarios</Heading>
              <Subheading>
                Administra los usuarios registrados en el sistema
              </Subheading>
            </div>
          </div>
          <Button color="indigo" onClick={handleCreate}>
            <PlusIcon className="w-5 h-5" />
            Nuevo Usuario
          </Button>
        </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Total */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <UserGroupIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total de Usuarios
            </div>
          </div>
          <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {stats.total}
          </div>
        </div>

        {/* Confirmed */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircleIcon className="w-6 h-6 text-lime-600 dark:text-lime-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Usuarios Confirmados
            </div>
          </div>
          <div className="text-3xl font-bold text-lime-600 dark:text-lime-400">
            {stats.confirmed}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {stats.total > 0
              ? `${Math.round((stats.confirmed / stats.total) * 100)}% del total`
              : '0% del total'}
          </div>
        </div>

        {/* Pending */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <XCircleIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Pendientes de Confirmar
            </div>
          </div>
          <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
            {stats.pending}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Requieren verificación de email
          </div>
        </div>

        {/* With Roles */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-6 h-6 text-sky-600 dark:text-sky-400">
              <svg
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                />
              </svg>
            </div>
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Con Roles Asignados
            </div>
          </div>
          <div className="text-3xl font-bold text-sky-600 dark:text-sky-400">
            {stats.withRoles}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {stats.total > 0
              ? `${Math.round((stats.withRoles / stats.total) * 100)}% del total`
              : '0% del total'}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg bg-white dark:bg-zinc-900 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10 p-6">
        <UserTable users={users} onEdit={handleEdit} />
      </div>
    </div>

      {/* Dialog for Create/Edit */}
      <Dialog open={isDialogOpen} onClose={handleCloseDialog} size="2xl">
        <DialogTitle>
          {selectedUser ? 'Editar Usuario' : 'Nuevo Usuario'}
        </DialogTitle>
        <DialogDescription>
          {selectedUser
            ? 'Modifica la información del usuario. La contraseña no se puede cambiar desde aquí.'
            : 'Completa el formulario para registrar un nuevo usuario en el sistema'}
        </DialogDescription>
        <DialogBody>
          <UserForm user={selectedUser || undefined} onSuccess={handleCloseDialog} />
        </DialogBody>
      </Dialog>
    </>
  )
}
