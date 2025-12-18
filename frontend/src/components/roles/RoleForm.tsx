import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { getPermissionsByModule } from '@/api/RoleAPI'
import type { Role, RoleFormData, Permission } from '@/types/index'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/TextArea'
import { Fieldset, FieldGroup, Field, Label, Description } from '@/components/ui/Fieldset'
import { Checkbox, CheckboxField } from '@/components/ui/Checkbox'
import { Heading, Subheading } from '@/components/ui/Heading'
import { Divider } from '@/components/ui/Divider'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'

interface RoleFormProps {
  role?: Role
  onSubmit: (data: RoleFormData) => void
  isSubmitting?: boolean
}

export function RoleForm({ role, onSubmit, isSubmitting = false }: RoleFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RoleFormData>({
    defaultValues: {
      name: role?.name || '',
      description: role?.description || '',
      permissionIds: role?.permissions?.map((p) => p.id) || [],
    },
  })

  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    new Set(role?.permissions?.map((p) => p.id) || [])
  )

  const { data: permissionsByModule = {}, isLoading: loadingPermissions } = useQuery({
    queryKey: ['permissions', 'by-module'],
    queryFn: getPermissionsByModule,
  })

  useEffect(() => {
    setValue('permissionIds', Array.from(selectedPermissions))
  }, [selectedPermissions, setValue])

  const handlePermissionToggle = (permissionId: string) => {
    setSelectedPermissions((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(permissionId)) {
        newSet.delete(permissionId)
      } else {
        newSet.add(permissionId)
      }
      return newSet
    })
  }

  const handleModuleToggle = (modulePermissions: Permission[]) => {
    const modulePermissionIds = modulePermissions.map((p) => p.id)
    const allSelected = modulePermissionIds.every((id) => selectedPermissions.has(id))

    setSelectedPermissions((prev) => {
      const newSet = new Set(prev)
      if (allSelected) {
        // Deseleccionar todos los permisos del módulo
        modulePermissionIds.forEach((id) => newSet.delete(id))
      } else {
        // Seleccionar todos los permisos del módulo
        modulePermissionIds.forEach((id) => newSet.add(id))
      }
      return newSet
    })
  }

  const isModuleFullySelected = (modulePermissions: Permission[]) => {
    return modulePermissions.every((p) => selectedPermissions.has(p.id))
  }

  const isModulePartiallySelected = (modulePermissions: Permission[]) => {
    const selectedCount = modulePermissions.filter((p) => selectedPermissions.has(p.id)).length
    return selectedCount > 0 && selectedCount < modulePermissions.length
  }

  const getModuleName = (module: string) => {
    const moduleNames: Record<string, string> = {
      users: 'Usuarios',
      roles: 'Roles',
      permissions: 'Permisos',
      families: 'Familias',
      cameras: 'Cámaras',
      visits: 'Visitas',
      vehicles: 'Vehículos',
      detections: 'Detecciones',
      notifications: 'Notificaciones',
      streams: 'Transmisiones',
      auth: 'Autenticación',
    }
    return moduleNames[module] || module.charAt(0).toUpperCase() + module.slice(1)
  }

  const getActionName = (action: string) => {
    const actionNames: Record<string, string> = {
      create: 'Crear',
      read: 'Ver',
      update: 'Actualizar',
      delete: 'Eliminar',
      manage: 'Gestionar',
    }
    return actionNames[action] || action
  }

  if (loadingPermissions) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando permisos...
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Información Básica */}
      <Fieldset>
        <Heading>Información del Rol</Heading>
        <Subheading>Proporciona los datos básicos del rol</Subheading>
        <FieldGroup>
          <Field>
            <Label htmlFor="name">Nombre del Rol *</Label>
            <Input
              id="name"
              {...register('name', {
                required: 'El nombre del rol es requerido',
                maxLength: {
                  value: 100,
                  message: 'El nombre no puede exceder los 100 caracteres',
                },
              })}
              invalid={!!errors.name}
            />
            {errors.name && (
              <Description className="text-red-600 dark:text-red-400">
                {errors.name.message}
              </Description>
            )}
          </Field>

          <Field>
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              {...register('description', {
                maxLength: {
                  value: 255,
                  message: 'La descripción no puede exceder los 255 caracteres',
                },
              })}
              rows={3}
              invalid={!!errors.description}
            />
            <Description>
              Describe las responsabilidades y propósito de este rol
            </Description>
            {errors.description && (
              <Description className="text-red-600 dark:text-red-400">
                {errors.description.message}
              </Description>
            )}
          </Field>
        </FieldGroup>
      </Fieldset>

      <Divider />

      {/* Permisos */}
      <Fieldset>
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheckIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          <div>
            <Heading>Permisos</Heading>
            <Subheading>
              Selecciona los permisos que tendrá este rol ({selectedPermissions.size} seleccionados)
            </Subheading>
          </div>
        </div>

        <div className="space-y-6">
          {Object.keys(permissionsByModule).length === 0 ? (
            <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
              No hay permisos disponibles
            </div>
          ) : (
            Object.entries(permissionsByModule).map(([module, permissions]) => {
              const fullySelected = isModuleFullySelected(permissions)
              const partiallySelected = isModulePartiallySelected(permissions)

              return (
                <div
                  key={module}
                  className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4"
                >
                  {/* Module Header with Select All */}
                  <div className="flex items-center justify-between mb-4">
                    <Heading level={3} className="text-base font-semibold">
                      {getModuleName(module)}
                    </Heading>
                    <CheckboxField>
                      <Checkbox
                        checked={fullySelected}
                        indeterminate={partiallySelected}
                        onChange={() => handleModuleToggle(permissions)}
                      />
                      <Label>
                        {fullySelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
                      </Label>
                    </CheckboxField>
                  </div>

                  {/* Permissions Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {permissions.map((permission) => (
                      <CheckboxField key={permission.id}>
                        <Checkbox
                          checked={selectedPermissions.has(permission.id)}
                          onChange={() => handlePermissionToggle(permission.id)}
                        />
                        <div>
                          <Label className="font-medium">
                            {getActionName(permission.action)}
                          </Label>
                          {permission.description && (
                            <Description className="text-xs">
                              {permission.description}
                            </Description>
                          )}
                        </div>
                      </CheckboxField>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </Fieldset>

      {/* Submit Button */}
      <div className="flex justify-end gap-4 pt-4">
        <Button
          type="submit"
          color="indigo"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Guardando...' : role ? 'Actualizar Rol' : 'Crear Rol'}
        </Button>
      </div>
    </form>
  )
}
