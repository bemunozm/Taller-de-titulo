export const AuditModule = {
  AUTH: 'AUTH',
  USERS: 'USERS',
  ROLES: 'ROLES',
  PERMISSIONS: 'PERMISSIONS',
  CAMERAS: 'CAMERAS',
  STREAMS: 'STREAMS',
  MEDIAMTX: 'MEDIAMTX',
  DETECTIONS: 'DETECTIONS',
  VEHICLES: 'VEHICLES',
  VISITS: 'VISITS',
  FAMILIES: 'FAMILIES',
  NOTIFICATIONS: 'NOTIFICATIONS',
  DIGITAL_CONCIERGE: 'DIGITAL_CONCIERGE'
} as const;

export type AuditModule = typeof AuditModule[keyof typeof AuditModule];

export const AuditAction = {
  // Auth
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  
  // CRUD
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  
  // Status
  ENABLE: 'ENABLE',
  DISABLE: 'DISABLE',
  ACTIVATE: 'ACTIVATE',
  DEACTIVATE: 'DEACTIVATE',
  
  // Permissions
  PERMISSION_GRANT: 'PERMISSION_GRANT',
  PERMISSION_REVOKE: 'PERMISSION_REVOKE',
  
  // Cameras
  LPR_ENABLE: 'LPR_ENABLE',
  LPR_DISABLE: 'LPR_DISABLE',
  CAMERA_REGISTER: 'CAMERA_REGISTER',
  
  // Visits
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CHECK_IN: 'CHECK_IN',
  CHECK_OUT: 'CHECK_OUT',
  QR_VALIDATE: 'QR_VALIDATE',
  QR_GENERATE: 'QR_GENERATE',
  
  // Vehicles
  VEHICLE_DETECTED: 'VEHICLE_DETECTED',
  PLATE_RECOGNIZED: 'PLATE_RECOGNIZED',
  
  // Generic
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
  SYNC: 'SYNC'
} as const;

export type AuditAction = typeof AuditAction[keyof typeof AuditAction];

export interface AuditLog {
  id: string;
  module: AuditModule;
  action: AuditAction;
  userId: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  entityId?: string;
  entityType?: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
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
