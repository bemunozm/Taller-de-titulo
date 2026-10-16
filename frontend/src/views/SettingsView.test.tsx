import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/renderWithProviders'
import SettingsView from './SettingsView'

const permissionsState = vi.hoisted(() => ({ permissions: [] as string[], isSuperAdmin: false }))
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) => permissionsState.permissions.includes(permission),
    hasAllPermissions: (...permissions: string[]) =>
      permissions.every((permission) => permissionsState.permissions.includes(permission)),
    isSuperAdmin: permissionsState.isSuperAdmin,
    user: undefined,
    isLoading: false,
  }),
}))

// Permisos del Administrador del condominio tras P5 (sin logs.read).
const ADMIN_PERMISSIONS = [
  'cameras.read',
  'users.read',
  'users.update',
  'families.read',
  'units.read',
  'roles.read',
  'audit.read',
  'detections.read',
]

beforeEach(() => {
  permissionsState.permissions = []
  permissionsState.isSuperAdmin = false
})

describe('SettingsView: tarjetas según permisos', () => {
  it('el Administrador no ve "Logs del Sistema" (es de plataforma)', () => {
    permissionsState.permissions = ADMIN_PERMISSIONS
    renderWithProviders(<SettingsView />)

    expect(screen.queryByRole('link', { name: /Logs del Sistema/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Auditoría/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Roles y Permisos/ })).toBeInTheDocument()
  })

  it('un rol con logs.read que no es super-admin tampoco la ve', () => {
    permissionsState.permissions = [...ADMIN_PERMISSIONS, 'logs.read']
    renderWithProviders(<SettingsView />)

    expect(screen.queryByRole('link', { name: /Logs del Sistema/ })).not.toBeInTheDocument()
  })

  it('el super-admin sí la ve', () => {
    permissionsState.permissions = [...ADMIN_PERMISSIONS, 'logs.read']
    permissionsState.isSuperAdmin = true
    renderWithProviders(<SettingsView />)

    expect(screen.getByRole('link', { name: /Logs del Sistema/ })).toHaveAttribute('href', '/settings/logs')
  })

  it('sin users.update no se ofrece la gestión de usuarios (recibiría la proyección mínima)', () => {
    permissionsState.permissions = ['users.read', 'cameras.read']
    renderWithProviders(<SettingsView />)

    expect(screen.queryByRole('link', { name: /Usuarios/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cámaras/ })).toBeInTheDocument()
  })
})
