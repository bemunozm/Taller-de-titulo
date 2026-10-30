/**
 * Roles por defecto del sistema
 * Estructura: { name, description, permissions }
 *
 * Fase 4 · P5 (D10): son los ROLES DE SISTEMA. Se comparan por nombre, la API
 * no los renombra, no los borra ni les cambia permisos, y
 * DataInitializationService los sincroniza con esta definición en cada
 * arranque (agrega los permisos que falten y quita los que sobren). Para
 * cambiar sus permisos se edita este archivo.
 *
 * Crear, editar o borrar roles personalizados y cambiar sus permisos es solo
 * del super-admin (chequeo explícito en RolesService): por eso ningún rol de
 * condominio tiene `roles.create/update/delete/assign-permissions`.
 */
import {
  CONDOMINIUM_VIEW_ALL_PERMISSION,
  PRIVACY_MANAGE_PERMISSION,
} from './default-permissions.constant';

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: string[]; // Array de nombres de permisos
}

export const DEFAULT_ROLES: RoleDefinition[] = [
  // ============================================
  // SUPER ADMINISTRADOR
  // ============================================
  {
    name: 'Super Administrador',
    description: 'Acceso completo y sin restricciones al sistema',
    permissions: [], // Se asignan todos los permisos dinámicamente
  },

  // ============================================
  // ADMINISTRADOR
  // ============================================
  {
    name: 'Administrador',
    description:
      'Gestión completa de usuarios, roles, familias y configuraciones',
    permissions: [
      // Autenticación (credenciales de servicio)
      'auth.manage-service-tokens',

      // Gestión de usuarios
      'users.create',
      'users.read',
      'users.update',
      'users.delete',
      'users.profile',
      'users.update-profile',
      'users.change-password',

      // Roles y permisos: solo lectura (asignar roles a usuarios de SU
      // condominio pasa por RoleAssignmentPolicy; editarlos es del super-admin)
      'roles.read',
      'permissions.read',

      // Alcance: todo el condominio (P5)
      CONDOMINIUM_VIEW_ALL_PERMISSION,

      // Gestión de familias
      'families.create',
      'families.read',
      'families.update',
      'families.delete',
      'families.add-member',
      'families.remove-member',

      // Gestión de unidades
      'units.create',
      'units.read',
      'units.update',
      'units.delete',
      'units.view-stats',
      'units.view-available',
      'units.search',

      // Gestión de vehículos
      'vehicles.create',
      'vehicles.read',
      'vehicles.update',
      'vehicles.delete',

      // Gestión de visitas
      'visits.create',
      'visits.read',
      'visits.update',
      'visits.delete',
      'visits.approve',
      'visits.reject',
      'visits.check-in',
      'visits.check-out',
      'visits.validate-qr',

      // Cámaras y streaming
      'cameras.create',
      'cameras.read',
      'cameras.update',
      'cameras.delete',
      'cameras.enable-ia',
      'cameras.view-stream',
      'streams.read',
      'streams.create',
      'streams.delete',

      // Detecciones (P5, corrección QA B1: también las del Conserje, si no
      // el Administrador no podía asignarle ese rol por la regla de
      // subconjunto de RoleAssignmentPolicy)
      'detections.create',
      'detections.read',
      'detections.update',
      'detections.delete',
      'detections.approve',
      'detections.list-pending',
      'detections.check-status',
      // Guardián: revisar/descartar anomalías
      'anomalies.resolve',

      // Notificaciones
      'notifications.read',
      'notifications.create',
      'notifications.mark-read',
      'notifications.delete',

      // Conserje Digital
      'digital-concierge.access',
      'digital-concierge.manage',

      // Panel administrativo
      'admin.dashboard',
      'admin.reports',
      'admin.settings',
      'admin.logs',

      // Auditoría (acotada a su condominio, P5)
      'audit.read',
      // Sin 'logs.read': los logs del sistema son de plataforma (P5).

      // Derechos de los titulares: supresión en su condominio (P7.R)
      PRIVACY_MANAGE_PERMISSION,
    ],
  },

  // ============================================
  // CONSERJE
  // ============================================
  {
    name: 'Conserje',
    description: 'Control de acceso, visitas, vehículos y monitoreo de cámaras',
    permissions: [
      // Perfil
      'users.profile',
      'users.update-profile',
      'users.change-password',

      // Visitas - Gestión completa
      'visits.create',
      'visits.read',
      'visits.update',
      'visits.approve',
      'visits.reject',
      'visits.check-in',
      'visits.check-out',
      'visits.validate-qr',

      // Vehículos - Solo lectura y registro
      'vehicles.create',
      'vehicles.read',
      'vehicles.update',

      // Familias - Solo lectura
      'families.read',

      // Unidades - Solo lectura
      'units.read',
      'units.search',
      'units.view-available',

      // Usuarios - Solo lectura
      'users.read',

      // Alcance: todo el condominio (P5)
      CONDOMINIUM_VIEW_ALL_PERMISSION,

      // Cámaras - Ver y gestionar transmisiones
      'cameras.read',
      'cameras.view-stream',
      'streams.read',

      // Detecciones - Ver, registrar y aprobar
      'detections.create',
      'detections.read',
      'detections.approve',
      'detections.list-pending',
      'detections.check-status',
      // Guardián: revisar/descartar anomalías (sin conserje humano lo hace el Administrador)
      'anomalies.resolve',

      // Notificaciones
      'notifications.read',
      'notifications.create',
      'notifications.mark-read',

      // Conserje Digital
      'digital-concierge.access',
      'digital-concierge.manage',
    ],
  },

  // ============================================
  // RESIDENTE
  // ============================================
  {
    name: 'Residente',
    description: 'Gestión de visitas propias, vehículos y perfil familiar',
    permissions: [
      // Perfil
      'users.profile',
      'users.update-profile',
      'users.change-password',

      // Visitas propias
      'visits.create',
      'visits.read',
      'visits.update',
      'visits.delete',

      // Vehículos propios
      'vehicles.create',
      'vehicles.read',
      'vehicles.update',
      'vehicles.delete',

      // Familia propia
      'families.read',

      // Unidad propia - Solo lectura
      'units.read',

      // Notificaciones
      'notifications.read',
      'notifications.mark-read',

      // Detecciones - Solo ver las propias
      'detections.read',
    ],
  },

  // ============================================
  // DESARROLLADOR
  // ============================================
  {
    name: 'Desarrollador',
    description: 'Acceso técnico para desarrollo y mantenimiento del sistema',
    permissions: [
      // Autenticación (credenciales de servicio)
      'auth.manage-service-tokens',

      // Alcance: todo SU condominio (P5, corrección QA: sus vistas de
      // usuarios, familias, vehículos y detecciones eran incoherentes sin
      // él). Sigue necesitando membresía en un condominio.
      CONDOMINIUM_VIEW_ALL_PERMISSION,

      // Acceso total a configuraciones
      'admin.dashboard',
      'admin.settings',
      'admin.reports',
      'admin.logs',

      // Roles y permisos: solo lectura (mutarlos es del super-admin, P5)
      'roles.read',
      'permissions.read',

      // Usuarios
      'users.create',
      'users.read',
      'users.update',
      'users.profile',

      // Familias
      'families.read',
      'families.create',
      'families.update',

      // Unidades
      'units.read',
      'units.create',
      'units.update',
      'units.delete',
      'units.view-stats',
      'units.view-available',
      'units.search',

      // Sistema de cámaras y streaming
      'cameras.read',
      'cameras.create',
      'cameras.update',
      'cameras.enable-ia',
      'streams.read',
      'streams.create',
      'streams.delete',
      'mediamtx.read',
      'mediamtx.update',

      // Workers y sistema
      'workers.read',
      'workers.manage',

      // Detecciones
      'detections.read',
      'detections.create',
      'detections.update',
      'detections.delete',

      // Tokens
      'tokens.read',
      'tokens.create',
      'tokens.delete',
    ],
  },

  // ============================================
  // SEGURIDAD
  // ============================================
  {
    name: 'Seguridad',
    description: 'Monitoreo de cámaras, detecciones y control de acceso',
    permissions: [
      // Perfil
      'users.profile',
      'users.update-profile',
      'users.change-password',

      // Cámaras y monitoreo
      'cameras.read',
      'cameras.view-stream',
      'streams.read',

      // Detecciones - Gestión completa
      'detections.create',
      'detections.read',
      'detections.update',

      // Visitas - Control de acceso
      'visits.read',
      'visits.check-in',
      'visits.check-out',
      'visits.validate-qr',

      // Vehículos - Solo lectura
      'vehicles.read',

      // Familias, unidades y usuarios - Solo lectura
      'families.read',
      'units.read',
      'units.search',
      'users.read',

      // Alcance: todo el condominio (P5)
      CONDOMINIUM_VIEW_ALL_PERMISSION,

      // Notificaciones
      'notifications.read',
      'notifications.create',
      'notifications.mark-read',

      // Conserje Digital
      'digital-concierge.access',
    ],
  },
];

/** Nombres de los roles de sistema (inmutables por la API, P5 · D10). */
export const SYSTEM_ROLE_NAMES: ReadonlySet<string> = new Set(
  DEFAULT_ROLES.map((role) => role.name),
);

export function isSystemRoleName(name: string): boolean {
  return SYSTEM_ROLE_NAMES.has(name);
}
