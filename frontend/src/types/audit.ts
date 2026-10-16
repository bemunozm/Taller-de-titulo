/**
 * Enums de auditoría: copia EXACTA de `backend/src/audit/entities/audit-log.entity.ts`
 * (`AuditModule` y `AuditAction`). Un valor que el backend no tiene no
 * aparece nunca en los registros, y uno que falta aquí queda sin etiqueta ni
 * filtro: si el backend agrega o renombra uno, se replica acá.
 */
export const AuditModule = {
  AUTH: 'AUTH',
  USERS: 'USERS',
  ROLES: 'ROLES',
  PERMISSIONS: 'PERMISSIONS',
  FAMILIES: 'FAMILIES',
  CAMERAS: 'CAMERAS',
  STREAMS: 'STREAMS',
  VISITS: 'VISITS',
  VEHICLES: 'VEHICLES',
  DETECTIONS: 'DETECTIONS',
  NOTIFICATIONS: 'NOTIFICATIONS',
  DIGITAL_CONCIERGE: 'DIGITAL_CONCIERGE',
  MEDIAMTX: 'MEDIAMTX',
  // Fase 4 · P7.R: exportación, supresión y retención de datos personales.
  PRIVACY: 'PRIVACY',
} as const;

export type AuditModule = typeof AuditModule[keyof typeof AuditModule];

export const AuditAction = {
  // CRUD
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',

  // Auth
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ACCOUNT_CONFIRM: 'ACCOUNT_CONFIRM',

  // Permisos y roles
  PERMISSION_GRANT: 'PERMISSION_GRANT',
  PERMISSION_REVOKE: 'PERMISSION_REVOKE',
  ROLE_ASSIGN: 'ROLE_ASSIGN',
  ROLE_UNASSIGN: 'ROLE_UNASSIGN',

  // Cámaras
  CAMERA_REGISTER: 'CAMERA_REGISTER',
  CAMERA_LPR_ENABLE: 'CAMERA_LPR_ENABLE',
  CAMERA_LPR_DISABLE: 'CAMERA_LPR_DISABLE',
  CAMERA_ACTIVATE: 'CAMERA_ACTIVATE',
  CAMERA_DEACTIVATE: 'CAMERA_DEACTIVATE',

  // Visitas
  VISIT_APPROVE: 'VISIT_APPROVE',
  VISIT_REJECT: 'VISIT_REJECT',
  VISIT_CHECK_IN: 'VISIT_CHECK_IN',
  VISIT_CHECK_OUT: 'VISIT_CHECK_OUT',
  VISIT_QR_VALIDATE: 'VISIT_QR_VALIDATE',

  // Detecciones
  DETECTION_CREATED: 'DETECTION_CREATED',
  DETECTION_MATCHED: 'DETECTION_MATCHED',

  // Vehículos
  VEHICLE_REGISTER: 'VEHICLE_REGISTER',
  VEHICLE_AUTHORIZE: 'VEHICLE_AUTHORIZE',
  VEHICLE_REVOKE: 'VEHICLE_REVOKE',

  // Familias
  FAMILY_MEMBER_ADD: 'FAMILY_MEMBER_ADD',
  FAMILY_MEMBER_REMOVE: 'FAMILY_MEMBER_REMOVE',

  // Privacidad (Fase 4 · P7.R, Ley 21.719)
  DATA_EXPORT: 'DATA_EXPORT',
  DATA_ERASURE: 'DATA_ERASURE',
  RETENTION_SWEEP: 'RETENTION_SWEEP',
} as const;

export type AuditAction = typeof AuditAction[keyof typeof AuditAction];

export const AUDIT_MODULE_LABELS: Record<AuditModule, string> = {
  AUTH: 'Autenticación',
  USERS: 'Usuarios',
  ROLES: 'Roles',
  PERMISSIONS: 'Permisos',
  FAMILIES: 'Familias',
  CAMERAS: 'Cámaras',
  STREAMS: 'Transmisiones',
  VISITS: 'Visitas',
  VEHICLES: 'Vehículos',
  DETECTIONS: 'Detecciones',
  NOTIFICATIONS: 'Notificaciones',
  DIGITAL_CONCIERGE: 'Conserje digital',
  MEDIAMTX: 'Servidor de video',
  PRIVACY: 'Privacidad',
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Crear',
  READ: 'Consultar',
  UPDATE: 'Actualizar',
  DELETE: 'Eliminar',
  LOGIN: 'Inicio de sesión',
  LOGOUT: 'Cierre de sesión',
  LOGIN_FAILED: 'Inicio de sesión fallido',
  PASSWORD_CHANGE: 'Cambio de contraseña',
  PASSWORD_RESET: 'Restablecimiento de contraseña',
  ACCOUNT_CONFIRM: 'Confirmación de cuenta',
  PERMISSION_GRANT: 'Otorgar permiso',
  PERMISSION_REVOKE: 'Revocar permiso',
  ROLE_ASSIGN: 'Asignar rol',
  ROLE_UNASSIGN: 'Quitar rol',
  CAMERA_REGISTER: 'Registrar cámara',
  CAMERA_LPR_ENABLE: 'Activar lector de patentes',
  CAMERA_LPR_DISABLE: 'Desactivar lector de patentes',
  CAMERA_ACTIVATE: 'Activar cámara',
  CAMERA_DEACTIVATE: 'Desactivar cámara',
  VISIT_APPROVE: 'Aprobar visita',
  VISIT_REJECT: 'Rechazar visita',
  VISIT_CHECK_IN: 'Ingreso de visita',
  VISIT_CHECK_OUT: 'Salida de visita',
  VISIT_QR_VALIDATE: 'Validar QR de visita',
  DETECTION_CREATED: 'Detección registrada',
  DETECTION_MATCHED: 'Detección asociada',
  VEHICLE_REGISTER: 'Registrar vehículo',
  VEHICLE_AUTHORIZE: 'Autorizar vehículo',
  VEHICLE_REVOKE: 'Revocar vehículo',
  FAMILY_MEMBER_ADD: 'Agregar miembro',
  FAMILY_MEMBER_REMOVE: 'Quitar miembro',
  DATA_EXPORT: 'Exportación de datos personales',
  DATA_ERASURE: 'Supresión de datos personales',
  RETENTION_SWEEP: 'Limpieza por plazo de conservación',
};

function isAuditModule(value: string): value is AuditModule {
  return Object.prototype.hasOwnProperty.call(AUDIT_MODULE_LABELS, value);
}

function isAuditAction(value: string): value is AuditAction {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTION_LABELS, value);
}

/** Etiqueta en español; un valor desconocido (backend más nuevo) se muestra legible. */
export function getAuditModuleLabel(value: string): string {
  return isAuditModule(value) ? AUDIT_MODULE_LABELS[value] : value.replace(/_/g, ' ');
}

export function getAuditActionLabel(value: string): string {
  return isAuditAction(value) ? AUDIT_ACTION_LABELS[value] : value.replace(/_/g, ' ');
}

export interface AuditLog {
  id: string;
  module: AuditModule;
  action: AuditAction;
  /** `null` en acciones del sistema (p. ej. `RETENTION_SWEEP`) o de un usuario ya borrado. */
  userId: string | null;
  user?: {
    id: string;
    name: string;
    email: string;
  } | null;
  entityId?: string;
  entityType?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: {
    ip?: string;
    userAgent?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number;
    duration?: number;
  };
  description?: string;
  createdAt: string;
}

export interface AuditLogQuery {
  module?: AuditModule;
  action?: AuditAction;
  userId?: string;
  entityType?: string;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedAuditLogs {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditStats {
  totalLogs: number;
  byAction: Record<string, number>;
  byModule: Record<string, number>;
  activeUsers: number;
}
