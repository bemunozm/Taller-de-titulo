import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from 'react-toastify'
import { addMemberToFamily, removeMemberFromFamily, getAvailableUsers, getFamilyById } from '@/api/FamilyAPI'
import type { Family, User } from '@/types/index'
import { UserPlusIcon, XMarkIcon } from '@heroicons/react/16/solid'
import { Select } from '@/components/ui/Select'
import { Field, Label } from '@/components/ui/Fieldset'

interface FamilyMembersModalProps {
  isOpen: boolean
  onClose: () => void
  family: Family | null
}

// Modal de confirmación para eliminar
function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  memberName,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  memberName: string
}) {
  return (
    <Dialog open={isOpen} onClose={onClose} size="sm">
      <DialogTitle>Confirmar Eliminación</DialogTitle>
      <DialogDescription>
        ¿Estás seguro de que deseas remover a <strong>{memberName}</strong> de esta familia?
      </DialogDescription>
      <DialogBody>
        <div className="flex justify-end gap-3 mt-6">
          <Button plain onClick={onClose}>
            Cancelar
          </Button>
          <Button color="red" onClick={onConfirm}>
            Remover
          </Button>
        </div>
      </DialogBody>
    </Dialog>
  )
}

export function FamilyMembersModal({ isOpen, onClose, family }: FamilyMembersModalProps) {
  const queryClient = useQueryClient()
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [memberToDelete, setMemberToDelete] = useState<User | null>(null)

  // Query para obtener los datos actualizados de la familia
  const { data: currentFamily, refetch: refetchFamily } = useQuery({
    queryKey: ['family', family?.id],
    queryFn: () => getFamilyById(family!.id),
    enabled: isOpen && !!family?.id,
  })

  const { data: availableUsers = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['availableUsers'],
    queryFn: getAvailableUsers,
    enabled: isOpen,
  })

  const addMemberMutation = useMutation({
    mutationFn: addMemberToFamily,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['families'] })
      queryClient.invalidateQueries({ queryKey: ['availableUsers'] })
      queryClient.invalidateQueries({ queryKey: ['availableUnits'] })
      // Refrescar los datos de la familia actual
      refetchFamily()
      toast.success('Miembro agregado exitosamente')
      setSelectedUserId('')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al agregar el miembro')
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: removeMemberFromFamily,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['families'] })
      queryClient.invalidateQueries({ queryKey: ['availableUsers'] })
      queryClient.invalidateQueries({ queryKey: ['availableUnits'] })
      // Refrescar los datos de la familia actual
      refetchFamily()
      toast.success('Miembro removido exitosamente')
      setMemberToDelete(null)
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al remover el miembro')
      setMemberToDelete(null)
    },
  })

  const handleAddMember = () => {
    if (!selectedUserId || !family) return
    
    addMemberMutation.mutate({
      familyId: family.id,
      userId: selectedUserId,
    })
  }

  const handleRemoveMember = (member: User) => {
    setMemberToDelete(member)
  }

  const confirmRemoveMember = () => {
    if (!memberToDelete || !family) return
    
    removeMemberMutation.mutate({
      familyId: family.id,
      userId: memberToDelete.id,
    })
  }

  // Usar currentFamily si está disponible, sino usar family prop
  const displayFamily = currentFamily || family

  if (!displayFamily) return null

  return (
    <>
      <Dialog open={isOpen} onClose={onClose} size="2xl">
        <DialogTitle>Gestionar Miembros - {displayFamily.name}</DialogTitle>
        <DialogDescription>
          Agrega o remueve miembros de esta familia
        </DialogDescription>
        <DialogBody>
        <div className="space-y-6">
          {/* Sección para agregar miembros */}
          <div className="border-b border-zinc-200 dark:border-zinc-700 pb-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
              Agregar Nuevo Miembro
            </h3>
            
            <div className="flex gap-3">
              <Field className="flex-1">
                <Label htmlFor="userId">Usuario Disponible</Label>
                <Select
                  id="userId"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  disabled={isLoadingUsers || availableUsers.length === 0}
                >
                  <option value="">Selecciona un usuario</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} - {user.email}
                      {user.rut && ` (${user.rut})`}
                    </option>
                  ))}
                </Select>
              </Field>
              
              <div className="flex items-end">
                <Button
                  color="indigo"
                  onClick={handleAddMember}
                  disabled={!selectedUserId || addMemberMutation.isPending}
                >
                  <UserPlusIcon />
                  Agregar
                </Button>
              </div>
            </div>

            {availableUsers.length === 0 && !isLoadingUsers && (
              <p className="text-sm text-zinc-500 mt-2">
                No hay usuarios disponibles. Todos los usuarios ya están asignados a una familia.
              </p>
            )}
          </div>

          {/* Lista de miembros actuales */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
              Miembros Actuales ({displayFamily.members?.length || 0})
            </h3>
            
            {(!displayFamily.members || displayFamily.members.length === 0) ? (
              <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
                Esta familia no tiene miembros asignados
              </div>
            ) : (
              <div className="space-y-2">
                {displayFamily.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {member.name}
                      </div>
                      <div className="text-sm text-zinc-500 dark:text-zinc-400">
                        {member.email}
                        {member.rut && ` • ${member.rut}`}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {member.confirmed ? (
                        <Badge color="lime">Confirmado</Badge>
                      ) : (
                        <Badge color="amber">Pendiente</Badge>
                      )}
                      
                      <Button
                        plain
                        onClick={() => handleRemoveMember(member)}
                        disabled={removeMemberMutation.isPending}
                        aria-label="Remover miembro"
                      >
                        <XMarkIcon className="w-5 h-5 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Botones de acción */}
          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button plain onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>

      {/* Modal de confirmación */}
      <ConfirmDeleteModal
        isOpen={!!memberToDelete}
        onClose={() => setMemberToDelete(null)}
        onConfirm={confirmRemoveMember}
        memberName={memberToDelete?.name || ''}
      />
    </>
  )
}
