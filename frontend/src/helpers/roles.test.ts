import { describe, expect, it } from 'vitest'
import {
  SUPER_ADMIN_ROLE_NAME,
  canAssignRole,
  canManageUserWithRoles,
  canManageRole,
  getAssignableRoles,
  includesSuperAdminRole,
  isSuperAdmin,
} from './roles'

describe('isSuperAdmin', () => {
  it('true solo con el rol "Super Administrador"', () => {
    expect(SUPER_ADMIN_ROLE_NAME).toBe('Super Administrador')
    expect(isSuperAdmin({ roles: [{ name: 'Residente' }, { name: 'Super Administrador' }] })).toBe(true)
  })

  it('false para el Administrador del condominio y para roles parecidos', () => {
    expect(isSuperAdmin({ roles: [{ name: 'Administrador' }] })).toBe(false)
    expect(isSuperAdmin({ roles: [{ name: 'super administrador' }] })).toBe(false)
  })

  it('false sin usuario o sin roles', () => {
    expect(isSuperAdmin(undefined)).toBe(false)
    expect(isSuperAdmin(null)).toBe(false)
    expect(isSuperAdmin({})).toBe(false)
    expect(isSuperAdmin({ roles: null })).toBe(false)
    expect(isSuperAdmin({ roles: [] })).toBe(false)
  })
})

describe('includesSuperAdminRole', () => {
  const roles = [
    { id: 'r-admin', name: 'Administrador' },
    { id: 'r-super', name: 'Super Administrador' },
  ]

  it('detecta el rol de plataforma entre los elegidos', () => {
    expect(includesSuperAdminRole(roles, ['r-admin', 'r-super'])).toBe(true)
    expect(includesSuperAdminRole(roles, ['r-admin'])).toBe(false)
    expect(includesSuperAdminRole(roles, [])).toBe(false)
  })

  it('ignora ids que no están en la lista de roles', () => {
    expect(includesSuperAdminRole(roles, ['desconocido'])).toBe(false)
  })
})

describe('canManageRole', () => {
  it('solo el super-admin gestiona roles personalizados', () => {
    expect(canManageRole({ isSystem: false }, true)).toBe(true)
    expect(canManageRole({ isSystem: false }, false)).toBe(false)
  })

  it('un rol de sistema nunca se gestiona, ni siquiera el super-admin', () => {
    expect(canManageRole({ isSystem: true }, true)).toBe(false)
    expect(canManageRole({ isSystem: true }, false)).toBe(false)
  })

  it('sin la marca (backend antiguo) se trata como personalizado', () => {
    expect(canManageRole({}, true)).toBe(true)
  })
})

describe('getAssignableRoles (espejo de RoleAssignmentPolicy)', () => {
  const perm = (name: string) => ({ name })
  const roles = [
    { id: 'r-super', name: 'Super Administrador', permissions: [perm('users.read')] },
    { id: 'r-res', name: 'Residente', permissions: [perm('visits.read'), perm('vehicles.read')] },
    { id: 'r-dev', name: 'Desarrollador', permissions: [perm('visits.read'), perm('mediamtx.update')] },
    { id: 'r-plat', name: 'Plataforma', permissions: [perm('platform.manage')] },
    { id: 'r-empty', name: 'Sin permisos', permissions: [] },
  ]
  const admin = { isSuperAdmin: false, permissions: ['visits.read', 'vehicles.read', 'users.read', 'platform.manage'] }

  it('el super-admin puede asignar todos', () => {
    expect(getAssignableRoles(roles, { isSuperAdmin: true, permissions: [] })).toHaveLength(roles.length)
  })

  it('otro actor: subconjunto de sus permisos, nunca "Super Administrador" ni platform.*', () => {
    expect(getAssignableRoles(roles, admin).map((role) => role.id)).toEqual(['r-res', 'r-empty'])
  })

  it('un rol sin la lista de permisos se ofrece (el backend decide)', () => {
    expect(canAssignRole({ id: 'r-x', name: 'Otro' }, admin)).toBe(true)
    expect(canAssignRole({ id: 'r-super', name: 'Super Administrador' }, admin)).toBe(false)
  })
})

describe('canManageUserWithRoles (escribir sobre otro usuario)', () => {
  const perm = (name: string) => ({ name })
  const admin = { isSuperAdmin: false, permissions: ['users.read', 'users.update', 'visits.read'] }
  const catalog = [
    { id: 'r-res', name: 'Residente', permissions: [perm('visits.read')] },
    { id: 'r-dev', name: 'Desarrollador', permissions: [perm('visits.read'), perm('mediamtx.update')] },
  ]

  it('roles del destino dentro de los permisos del actor: sí', () => {
    expect(canManageUserWithRoles([{ id: 'r-res', name: 'Residente' }], admin, catalog)).toBe(true)
  })

  it('un rol del destino con permisos que el actor no tiene: no', () => {
    expect(canManageUserWithRoles([{ id: 'r-dev', name: 'Desarrollador' }], admin, catalog)).toBe(false)
    expect(canManageUserWithRoles([{ id: 'r-super', name: 'Super Administrador' }], admin, catalog)).toBe(false)
  })

  it('un rol sin permisos conocidos: se ofrece (decide el backend)', () => {
    expect(canManageUserWithRoles([{ id: 'r-x', name: 'Otro' }], admin, catalog)).toBe(true)
  })

  it('el super-admin siempre; un destino sin roles, también', () => {
    expect(canManageUserWithRoles([{ id: 'r-dev', name: 'Desarrollador' }], { isSuperAdmin: true, permissions: [] }, catalog)).toBe(true)
    expect(canManageUserWithRoles([], admin)).toBe(true)
    expect(canManageUserWithRoles(undefined, admin)).toBe(true)
  })
})
