/**
 * Permisos por defecto del sistema
 * Estructura: { name, description, module, action }
 * Nomenclatura: module.action
 */

export interface PermissionDefinition {
  name: string;
  description: string;
  module: string;
  action: string;
}

export const DEFAULT_PERMISSIONS: PermissionDefinition[] = [
  // ============================================
  // NOTA: El módulo de autenticación (auth) NO tiene permisos porque:
  // - Las rutas de registro/login/recuperación son PÚBLICAS por diseño
  // - Las rutas de perfil están protegidas solo con AuthGuard (cualquier usuario autenticado)
  // - No se requiere control granular de permisos en este módulo
  // ============================================

  // ============================================
  // GESTIÓN DE USUARIOS
  // ============================================
  { name: 'users.create', description: 'Crear usuarios', module: 'users', action: 'create' },
  { name: 'users.read', description: 'Ver usuarios', module: 'users', action: 'read' },
  { name: 'users.update', description: 'Actualizar usuarios', module: 'users', action: 'update' },
  { name: 'users.delete', description: 'Eliminar usuarios', module: 'users', action: 'delete' },
  { name: 'users.profile', description: 'Ver perfil propio', module: 'users', action: 'profile' },
  { name: 'users.update-profile', description: 'Actualizar perfil propio', module: 'users', action: 'update-profile' },
  { name: 'users.change-password', description: 'Cambiar contraseña propia', module: 'users', action: 'change-password' },

  // ============================================
  // GESTIÓN DE ROLES
  // ============================================
  { name: 'roles.create', description: 'Crear roles', module: 'roles', action: 'create' },
  { name: 'roles.read', description: 'Ver roles', module: 'roles', action: 'read' },
  { name: 'roles.update', description: 'Actualizar roles', module: 'roles', action: 'update' },
  { name: 'roles.delete', description: 'Eliminar roles', module: 'roles', action: 'delete' },
  { name: 'roles.assign-permissions', description: 'Asignar permisos a roles', module: 'roles', action: 'assign-permissions' },

  // ============================================
  // GESTIÓN DE PERMISOS
  // ============================================
  { name: 'permissions.create', description: 'Crear permisos', module: 'permissions', action: 'create' },
  { name: 'permissions.read', description: 'Ver permisos', module: 'permissions', action: 'read' },
  { name: 'permissions.update', description: 'Actualizar permisos', module: 'permissions', action: 'update' },
  { name: 'permissions.delete', description: 'Eliminar permisos', module: 'permissions', action: 'delete' },

  // ============================================
  // GESTIÓN DE FAMILIAS
  // ============================================
  { name: 'families.create', description: 'Crear familias', module: 'families', action: 'create' },
  { name: 'families.read', description: 'Ver familias', module: 'families', action: 'read' },
  { name: 'families.update', description: 'Actualizar familias', module: 'families', action: 'update' },
  { name: 'families.delete', description: 'Eliminar familias', module: 'families', action: 'delete' },
  { name: 'families.add-member', description: 'Agregar miembros a familia', module: 'families', action: 'add-member' },
  { name: 'families.remove-member', description: 'Remover miembros de familia', module: 'families', action: 'remove-member' },

  // ============================================
  // GESTIÓN DE UNIDADES (Departamentos, Casas, etc.)
  // ============================================
  { name: 'units.create', description: 'Crear unidades', module: 'units', action: 'create' },
  { name: 'units.read', description: 'Ver unidades', module: 'units', action: 'read' },
  { name: 'units.update', description: 'Actualizar unidades', module: 'units', action: 'update' },
  { name: 'units.delete', description: 'Eliminar unidades', module: 'units', action: 'delete' },
  { name: 'units.view-stats', description: 'Ver estadísticas de unidades', module: 'units', action: 'view-stats' },
  { name: 'units.view-available', description: 'Ver unidades disponibles', module: 'units', action: 'view-available' },
  { name: 'units.search', description: 'Buscar unidades', module: 'units', action: 'search' },

  // ============================================
  // GESTIÓN DE VEHÍCULOS
  // ============================================
  { name: 'vehicles.create', description: 'Registrar vehículos', module: 'vehicles', action: 'create' },
  { name: 'vehicles.read', description: 'Ver vehículos', module: 'vehicles', action: 'read' },
  { name: 'vehicles.update', description: 'Actualizar vehículos', module: 'vehicles', action: 'update' },
  { name: 'vehicles.delete', description: 'Eliminar vehículos', module: 'vehicles', action: 'delete' },

  // ============================================
  // GESTIÓN DE VISITAS
  // ============================================
  { name: 'visits.create', description: 'Crear visitas', module: 'visits', action: 'create' },
  { name: 'visits.read', description: 'Ver visitas', module: 'visits', action: 'read' },
  { name: 'visits.update', description: 'Actualizar visitas', module: 'visits', action: 'update' },
  { name: 'visits.delete', description: 'Eliminar visitas', module: 'visits', action: 'delete' },
  { name: 'visits.approve', description: 'Aprobar visitas', module: 'visits', action: 'approve' },
  { name: 'visits.reject', description: 'Rechazar visitas', module: 'visits', action: 'reject' },
  { name: 'visits.check-in', description: 'Registrar entrada de visita', module: 'visits', action: 'check-in' },
  { name: 'visits.check-out', description: 'Registrar salida de visita', module: 'visits', action: 'check-out' },
  { name: 'visits.validate-qr', description: 'Validar código QR de visita', module: 'visits', action: 'validate-qr' },

  // ============================================
  // GESTIÓN DE CÁMARAS
  // ============================================
  { name: 'cameras.create', description: 'Registrar cámaras', module: 'cameras', action: 'create' },
  { name: 'cameras.read', description: 'Ver cámaras', module: 'cameras', action: 'read' },
  { name: 'cameras.update', description: 'Actualizar cámaras', module: 'cameras', action: 'update' },
  { name: 'cameras.delete', description: 'Eliminar cámaras', module: 'cameras', action: 'delete' },
  { name: 'cameras.enable-ia', description: 'Habilitar/deshabilitar IA en cámara', module: 'cameras', action: 'enable-ia' },
  { name: 'cameras.view-stream', description: 'Ver transmisión de cámara', module: 'cameras', action: 'view-stream' },

  // ============================================
  // GESTIÓN DE TRANSMISIONES (STREAMS)
  // ============================================
  { name: 'streams.read', description: 'Ver transmisiones', module: 'streams', action: 'read' },
  { name: 'streams.create', description: 'Crear transmisiones', module: 'streams', action: 'create' },
  { name: 'streams.delete', description: 'Eliminar transmisiones', module: 'streams', action: 'delete' },

  // ============================================
  // GESTIÓN DE DETECCIONES
  // ============================================
  { name: 'detections.create', description: 'Registrar detecciones', module: 'detections', action: 'create' },
  { name: 'detections.read', description: 'Ver detecciones', module: 'detections', action: 'read' },
  { name: 'detections.update', description: 'Actualizar detecciones', module: 'detections', action: 'update' },
  { name: 'detections.delete', description: 'Eliminar detecciones', module: 'detections', action: 'delete' },
  { name: 'detections.approve', description: 'Aprobar detecciones pendientes', module: 'detections', action: 'approve' },
  { name: 'detections.list-pending', description: 'Listar detecciones pendientes', module: 'detections', action: 'list-pending' },
  { name: 'detections.check-status', description: 'Verificar estado de detecciones', module: 'detections', action: 'check-status' },

  // ============================================
  // GESTIÓN DE NOTIFICACIONES
  // ============================================
  { name: 'notifications.read', description: 'Ver notificaciones', module: 'notifications', action: 'read' },
  { name: 'notifications.create', description: 'Enviar notificaciones', module: 'notifications', action: 'create' },
  { name: 'notifications.mark-read', description: 'Marcar notificación como leída', module: 'notifications', action: 'mark-read' },
  { name: 'notifications.delete', description: 'Eliminar notificaciones', module: 'notifications', action: 'delete' },

  // ============================================
  // CONSERJE DIGITAL
  // ============================================
  { name: 'digital-concierge.access', description: 'Acceder a conserjería digital', module: 'digital-concierge', action: 'access' },
  { name: 'digital-concierge.manage', description: 'Gestionar conserjería digital', module: 'digital-concierge', action: 'manage' },

  // ============================================
  // GESTIÓN DE TOKENS
  // ============================================
  { name: 'tokens.create', description: 'Crear tokens', module: 'tokens', action: 'create' },
  { name: 'tokens.read', description: 'Ver tokens', module: 'tokens', action: 'read' },
  { name: 'tokens.update', description: 'Actualizar tokens', module: 'tokens', action: 'update' },
  { name: 'tokens.delete', description: 'Eliminar tokens', module: 'tokens', action: 'delete' },
  { name: 'tokens.cleanup', description: 'Limpiar tokens expirados', module: 'tokens', action: 'cleanup' },

  // ============================================
  // WORKERS (Sistema de tareas)
  // ============================================
  { name: 'workers.read', description: 'Ver estado de workers', module: 'workers', action: 'read' },
  { name: 'workers.manage', description: 'Gestionar workers', module: 'workers', action: 'manage' },

  // ============================================
  // MEDIAMTX (Sistema de streaming)
  // ============================================
  { name: 'mediamtx.read', description: 'Ver configuración MediaMTX', module: 'mediamtx', action: 'read' },
  { name: 'mediamtx.update', description: 'Actualizar configuración MediaMTX', module: 'mediamtx', action: 'update' },

  // ============================================
  // PANEL ADMINISTRATIVO
  // ============================================
  { name: 'admin.dashboard', description: 'Acceder al panel administrativo', module: 'admin', action: 'dashboard' },
  { name: 'admin.reports', description: 'Ver reportes del sistema', module: 'admin', action: 'reports' },
  { name: 'admin.settings', description: 'Configurar sistema', module: 'admin', action: 'settings' },
  { name: 'admin.logs', description: 'Ver registros del sistema', module: 'admin', action: 'logs' },

  // ============================================
  // AUDITORÍA
  // ============================================
  { name: 'audit.read', description: 'Ver registros de auditoría', module: 'audit', action: 'read' },

  // ============================================
  // LOGS DEL SISTEMA
  // ============================================
  { name: 'logs.read', description: 'Ver logs de comunicación entre servicios', module: 'logs', action: 'read' },
];
