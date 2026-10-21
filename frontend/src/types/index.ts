import { z } from 'zod'
import { isValidChileanId, isValidRUT } from '@/helpers/index'

// Define el esquema de un permiso
// Sirve para validar los datos de un permiso antes de enviarlos al servidor o de mostrarlos en la aplicación
// El esquema de un permiso es un objeto que tiene las siguientes propiedades:
export const permissionSchema = z.object({
    id: z.string().uuid(),
    name: z.string().max(100),
    description: z.string().max(255),
    module: z.string().max(50),
    action: z.string().max(50),
})

// Define el tipo Permission que es el tipo inferido del esquema permissionSchema
export type Permission = z.infer<typeof permissionSchema>
export type PermissionFormData = Pick<Permission, 'name' | 'description' | 'module' | 'action'>

// Define el esquema de un rol
// Sirve para validar los datos de un rol antes de enviarlos al servidor o de mostrarlos en la aplicación
// El esquema de un rol es un objeto que tiene las siguientes propiedades:
export const roleSchema = z.object({
    id: z.string().uuid(),
    name: z.string().max(100),
    description: z.string().optional(),
    permissions: z.array(permissionSchema).optional(),
    // Rol de sistema (DEFAULT_ROLES del backend): inmutable por la API (403).
    isSystem: z.boolean().optional(),
})

// Define el tipo Role que es el tipo inferido del esquema roleSchema
export type Role = z.infer<typeof roleSchema>
export type RoleFormData = Pick<Role, 'name' | 'description'> & {
    permissionIds?: string[]
}
export type RoleUpdateData = Pick<Role, 'name' | 'description'> & {
    permissionIds?: string[]
}

// Define el esquema de un token
// Sirve para validar los datos de un token antes de enviarlos al servidor o de mostrarlos en la aplicación
// El esquema de un token es un objeto que tiene las siguientes propiedades:
export const tokenSchema = z.object({
    id: z.string().uuid(),
    token: z.string().length(6),
    userId: z.string().uuid(),
    createdAt: z.date(),
    expiresAt: z.date(),
})

// Define el tipo Token que es el tipo inferido del esquema tokenSchema
export type Token = z.infer<typeof tokenSchema>
export type TokenFormData = Pick<Token, 'token' | 'userId'>

// Define el esquema de un usuario
// Sirve para validar los datos de un usuario antes de enviarlos al servidor o de mostrarlos en la aplicación
// El esquema de un usuario es un objeto que tiene las siguientes propiedades:

export const authSchema = z.object({
    name: z.string().max(100),
    rut: z.string().max(50),
    phone: z.string().max(15),
    age: z.number().int().positive(),
    email: z.string().email(),
    password: z.string().min(6).max(100),
    current_password: z.string().min(6).max(100),
    password_confirmation: z.string().min(6).max(100),
    // Tarea #20: token opaco de better-auth (link de confirmación/recuperación
    // por email), ya no un código propio de 6 dígitos — longitud variable.
    token: z.string().min(1),
})
export type Auth = z.infer<typeof authSchema>
export type UserLoginForm = Pick<Auth   , 'email' | 'password'>
export type RequestConfirmationCodeForm = Pick<Auth, 'email'>
export type ForgotPasswordForm = Pick<Auth, 'email'>
export type NewPasswordForm = Pick<Auth, 'password' | 'password_confirmation'>
export type UpdateCurrentUserPasswordForm = Pick<Auth, 'current_password' | 'password' | 'password_confirmation'>
export type ConfirmToken = Pick<Auth, 'token'>
export type CheckPasswordForm = Pick<Auth, 'password'>

// Unit schema básico (para evitar circular dependency con familyBasicSchema)
// Condominio dueño del recurso (columna `organizationId` de la entidad); el
// super-admin lo usa para no elegir unidades/familias de otro condominio.
const organizationIdSchema = z.string().uuid().nullable().optional()

const unitBasicSchema = z.object({
    id: z.string().uuid(),
    organizationId: organizationIdSchema,
    identifier: z.string().max(32),
    block: z.string().max(16).nullable().optional(),
    number: z.string().max(16),
    floor: z.number().int().nullable().optional(),
    type: z.string().max(32).nullable().optional(),
})

// Family schema básico (sin members para evitar circular dependency)
const familyBasicSchema = z.object({
    id: z.string().uuid(),
    organizationId: organizationIdSchema,
    name: z.string().max(128),
    description: z.string().max(256).nullable().optional(),
    unit: unitBasicSchema.nullable().optional(),
    active: z.boolean().default(true),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
})

export const userSchema = z.object({
    id: z.string().uuid(),
    // `null` en una cuenta anonimizada (Ley 21.719, P7.R): nombre "Usuario
    // eliminado", email no entregable y RUT/teléfono/edad/foto a null.
    rut: z.string().max(50).nullable(),
    name: z.string().max(100),
    email: z.string().email(),
    phone: z.string().max(15).nullable(),
    password: z.string().optional(), // Opcional porque no siempre se incluye en las respuestas
    age: z.number().int().positive().nullable().optional(),
    profilePicture: z.string().nullable().optional(),
    confirmed: z.boolean().default(false),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
    deletedAt: z.string().transform((date) => new Date(date)).nullable(),
    /** Cuándo se anonimizó la cuenta deshabilitada; una cuenta anonimizada no se vuelve a habilitar. */
    anonymizedAt: z.string().nullable().optional(),
    roles: z.array(roleSchema).optional(),
    tokens: z.array(tokenSchema).optional(),
    family: familyBasicSchema.nullable().optional(),
})

// Define el tipo User que es el tipo inferido del esquema userSchema
// Ahora incluye family directamente en el schema
export type User = z.infer<typeof userSchema>

// UserWithFamily es ahora solo un alias de User (mantener por compatibilidad)
export type UserWithFamily = User

/**
 * Usuario embebido en otra entidad: miembro de una familia, anfitrión de una
 * visita, propietario de un vehículo. Quien no tiene `users.update` lo recibe
 * como `{ id, name }` (P5): todo lo demás (email, RUT, teléfono, familia,
 * confirmación) es opcional y la UI no debe asumirlo.
 */
export const embeddedUserSchema = userSchema.partial().required({ id: true, name: true })
export type EmbeddedUser = z.infer<typeof embeddedUserSchema>
/** Formulario de alta/edición: RUT y teléfono siempre se piden (solo una cuenta anonimizada los tiene en null). */
export type UserFormData = Pick<User, 'name' | 'email' | 'password' | 'age'> & {
    phone: string
    rut: string
}
/** Body de `PATCH /users/:id`: solo viajan los campos presentes. */
export interface UserUpdateData {
    name?: string
    email?: string
    rut?: string
    phone?: string
    age?: number | null
    roleIds?: string[]
    familyId?: string | null
}
export type UserLoginData = Pick<User, 'email' | 'password'>
export type UserAuthResponse = Omit<User, 'password' | 'tokens'> & {
    token?: string
}

/**
 * Proyección mínima de `GET /users` (P5.C) para quien no tiene `users.update`:
 * `{ id, name, family }`. El detalle (`User`) es compatible con este tipo, así
 * que los selectores (anfitrión, propietario) solo dependen de estos campos.
 */
export interface UserSummary {
    id: string
    name: string
    family?: { id: string; name: string; organizationId?: string | null } | null
    /** Solo en el detalle (con `users.update`): la cuenta está deshabilitada. */
    deletedAt?: string | Date | null
    /** Solo en el detalle (con `users.update`): la cuenta se anonimizó. */
    anonymizedAt?: string | null
}

/**
 * `organizationId` de las creaciones de recursos del condominio: obligatorio
 * para el super-admin y rechazado (403) para cualquier otro actor. Nunca va
 * en una edición (400).
 */
export interface OrganizationScoped {
    organizationId?: string
}

/** Condominio del selector del super-admin al crear usuarios. */
export interface CondominiumOption {
    id: string
    name: string
    slug: string
}

// Un <select> sin elección envía '': se acepta aquí y se limpia al enviar.
export const optionalUuidField = z.union([z.literal(''), z.string().uuid()]).optional()

// User Admin Form Data - Para creación de cuentas por admin
export const userAdminFormSchema = z.object({
    name: z.string().min(1, 'El nombre es obligatorio').max(100, 'El nombre no puede exceder 100 caracteres'),
    email: z.string().email('Correo electrónico inválido'),
    rut: z.string().min(1, 'El RUT es obligatorio').refine(
        (val) => isValidRUT(val),
        { message: 'Ingrese un RUT válido (Ej: 12345678-9)' }
    ),
    phone: z.string().max(15).optional(),
    age: z.number().int().min(16, 'La edad mínima es 16 años').max(100, 'La edad máxima es 100 años').optional(),
    roleIds: z.array(z.string().uuid()).min(1, 'Debe seleccionar al menos un rol'),
    familyId: optionalUuidField,
    // Solo lo usa el super-admin (el backend responde 403 a cualquier otro).
    organizationId: optionalUuidField,
})

export type UserAdminFormData = z.infer<typeof userAdminFormSchema>

/** Body de `POST /users/create-by-admin`. */
export interface CreateUserByAdminPayload {
    name: string
    email: string
    rut: string
    phone?: string
    age?: number
    roleIds: string[]
    familyId?: string
    /** Solo del super-admin; otro actor que lo envíe recibe 403. */
    organizationId?: string
}

// Camera schemas and types

// Zonas de dibujo (Guardián y LPR): polígonos en coordenadas normalizadas 0-1.
// Límites iguales a los del backend (zone-point.dto.ts, update-guardian-zones.dto.ts).
export const ZONE_LIMITS = { maxZones: 20, minPoints: 3, maxPoints: 100 } as const

export const zonePointSchema = z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
})

export const zonePolygonsSchema = z
    .array(z.array(zonePointSchema).min(ZONE_LIMITS.minPoints).max(ZONE_LIMITS.maxPoints))
    .max(ZONE_LIMITS.maxZones)

export type ZonePoint = z.infer<typeof zonePointSchema>

// Línea de dirección del LPR (backend/src/cameras/lpr-settings.ts): coordenadas
// normalizadas 0-1. `exitSide` es el lado hacia el que se mueve el vehículo al
// SALIR, mirando de `from` a `to` tal como se ve en pantalla (eje y hacia abajo).
export const LPR_EXIT_SIDES = ['left', 'right'] as const
/** Longitud mínima (en coordenadas normalizadas) para que la línea sea útil. */
export const DIRECTION_LINE_MIN_LENGTH = 0.05

function directionLineLength(line: { from: { x: number; y: number }; to: { x: number; y: number } }): number {
    return Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)
}

/** Lectura (respuestas del backend): tolerante con claves extra. */
const directionLineReadSchema = z.object({
    from: zonePointSchema,
    to: zonePointSchema,
    exitSide: z.enum(LPR_EXIT_SIDES),
})

/** Escritura: sin propiedades extra y con largo mínimo (contrato compartido). */
export const directionLineSchema = z
    .object({
        from: zonePointSchema.strict(),
        to: zonePointSchema.strict(),
        exitSide: z.enum(LPR_EXIT_SIDES),
    })
    .strict()
    .refine((line) => directionLineLength(line) >= DIRECTION_LINE_MIN_LENGTH, {
        message: 'La línea de dirección es demasiado corta',
    })

export type DirectionLine = z.infer<typeof directionLineReadSchema>
export type LprExitSide = (typeof LPR_EXIT_SIDES)[number]

// Configuración de visión LPR por cámara (backend/src/cameras/lpr-settings.ts).
// Todos los campos son opcionales: el worker mezcla lo presente sobre sus defaults.
export const LPR_ACTIONS = ['register', 'access'] as const
export const LPR_DIRECTIONS = ['entry', 'exit', 'both'] as const
export const LPR_DETECTOR_IMGSZ_VALUES = [640, 960, 1280, 1920] as const

export const lprCropSettingsSchema = z.object({
    minWidth: z.number().int().min(0).max(2000).optional(),
    // null = sin tope superior
    maxWidth: z.number().int().min(1).max(4000).nullable().optional(),
    minRatio: z.number().min(0.1).max(20).optional(),
    maxRatio: z.number().min(0.1).max(20).optional(),
})

const lprSettingsShape = {
    action: z.enum(LPR_ACTIONS).optional(),
    direction: z.enum(LPR_DIRECTIONS).optional(),
    zone: zonePolygonsSchema.optional(),
    directionLine: directionLineReadSchema.optional(),
    detectorImgsz: z
        .union([z.literal(640), z.literal(960), z.literal(1280), z.literal(1920)])
        .optional(),
    sampleFps: z.number().min(1).max(15).optional(),
    crop: lprCropSettingsSchema.optional(),
    confirmReads: z.number().int().min(1).max(10).optional(),
}

/** Lectura (respuestas del backend): tolerante con claves extra. */
export const lprSettingsSchema = z.object(lprSettingsShape)

/** Mínimo de lecturas con control de acceso (action ausente = access). */
export const LPR_MIN_CONFIRM_READS_ACCESS = 3

/**
 * Escritura (lo que se envía en el PATCH): las reglas del contrato compartido
 * (contracts/lpr-settings.cases.json). Rechaza claves desconocidas, exige los
 * pares de recorte y N >= 3 en control de acceso.
 */
export const lprSettingsRequestSchema = z
    .object({
        ...lprSettingsShape,
        crop: lprCropSettingsSchema.strict().optional(),
        directionLine: directionLineSchema.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
        const crop = value.crop
        if (crop) {
            const hasMinW = crop.minWidth !== undefined
            const hasMaxW = crop.maxWidth !== undefined
            if (hasMinW !== hasMaxW) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['crop'], message: 'minWidth y maxWidth van juntos' })
            } else if (typeof crop.minWidth === 'number' && typeof crop.maxWidth === 'number' && crop.maxWidth < crop.minWidth) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['crop', 'maxWidth'], message: 'maxWidth < minWidth' })
            }
            const hasMinR = crop.minRatio !== undefined
            const hasMaxR = crop.maxRatio !== undefined
            if (hasMinR !== hasMaxR) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['crop'], message: 'minRatio y maxRatio van juntos' })
            } else if (typeof crop.minRatio === 'number' && typeof crop.maxRatio === 'number' && crop.maxRatio < crop.minRatio) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['crop', 'maxRatio'], message: 'maxRatio < minRatio' })
            }
        }
        if (
            (value.action ?? 'access') === 'access' &&
            value.confirmReads !== undefined &&
            value.confirmReads < LPR_MIN_CONFIRM_READS_ACCESS
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['confirmReads'],
                message: 'Con control de acceso se requieren al menos 3 lecturas',
            })
        }
    })

export type LprAction = (typeof LPR_ACTIONS)[number]
export type LprDirection = (typeof LPR_DIRECTIONS)[number]
export type LprCropSettings = z.infer<typeof lprCropSettingsSchema>
export type LprSettings = z.infer<typeof lprSettingsSchema>

/** Respuesta de GET/PATCH /cameras/:id/lpr-settings (null = defaults del worker). */
export const cameraLprSettingsResponseSchema = z.object({
    id: z.string(),
    name: z.string(),
    enableLpr: z.boolean(),
    lprSettings: lprSettingsSchema.nullable(),
})

export type CameraLprSettingsResponse = z.infer<typeof cameraLprSettingsResponseSchema>

// Camera schema based on backend entity (backend/src/cameras/entities/camera.entity.ts)
export const cameraSchema = z.object({
    id: z.string().uuid(),
    name: z.string().max(150),
    location: z.string().max(200).optional(),
    // mountPath is optional and generated by backend
    mountPath: z.string().max(150).optional(),
    registeredInMediamtx: z.boolean().optional(),
    enableLpr: z.boolean().optional(),
    enableGuardian: z.boolean().optional(),
    active: z.boolean().optional(),
    // roles may be present in populated responses
    roles: z.array(roleSchema).optional(),
    guardianZones: z.array(z.array(zonePointSchema)).optional(),
})

export type Camera = z.infer<typeof cameraSchema>

// CreateCameraDto (backend/src/cameras/dto/create-camera.dto.ts)
export const createCameraSchema = z.object({
    name: z.string().min(1).max(150),
    location: z.string().max(200).optional(),
    // Plain source URL provided by client; backend will encrypt it
    sourceUrl: z.string().min(1).max(500),
    // optional: whether the camera is active
    active: z.boolean().optional(),
    // optional: enable license plate recognition for this camera
    enableLpr: z.boolean().optional(),
    // optional: enable guardian mode for this camera
    enableGuardian: z.boolean().optional(),
    // role IDs that will be associated to the camera
    roleIds: z.array(z.string().uuid()).optional(),
})

export type CreateCameraFormData = z.infer<typeof createCameraSchema>

/** Body de `POST /cameras` (el super-admin indica el condominio). */
export type CreateCameraPayload = CreateCameraFormData & OrganizationScoped

export type UpdateCameraFormData = Partial<CreateCameraFormData> & {
    // mountPath cannot be updated via API
    mountPath?: never
}

// Notification schemas and types

export const notificationTypeSchema = z.enum([
    // Visitas
    'VISIT_CHECK_IN',
    'VISIT_CHECK_OUT',
    'VISIT_APPROVED',
    'VISIT_REJECTED',
    'VISIT_EXPIRING_SOON',
    'VISIT_EXPIRED',
    
    // Conserje Digital
    'VISITOR_ARRIVAL',
    
    // Acceso y Seguridad
    'ACCESS_DENIED',
    'VEHICLE_DETECTED',
    'UNKNOWN_VEHICLE',
    
    // Vehículos
    'VEHICLE_REGISTERED',
    'VEHICLE_UPDATED',
    'VEHICLE_REMOVED',
    
    // Sistema
    'SYSTEM_ALERT',
    'SYSTEM_INFO',
    
    // Familia
    'FAMILY_UPDATE',
    'FAMILY_INVITATION',
    'FAMILY_MEMBER_ADDED',
    'FAMILY_MEMBER_REMOVED',
])

export type NotificationType = z.infer<typeof notificationTypeSchema>

export const notificationPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent'])
export type NotificationPriority = z.infer<typeof notificationPrioritySchema>

export const notificationPayloadSchema = z.object({
    title: z.string(),
    message: z.string(),
    type: notificationTypeSchema,
    priority: notificationPrioritySchema.optional(),
    timestamp: z.union([
        z.string().transform((date) => new Date(date)),
        z.date()
    ]).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    requiresAction: z.boolean().optional(),
})

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>

export const notificationSchema = z.object({
    id: z.string(),
    payload: notificationPayloadSchema,
    read: z.boolean().default(false),
    receivedAt: z.union([
        z.string().transform((date) => new Date(date)),
        z.date()
    ]),
})

export type AppNotification = z.infer<typeof notificationSchema>

// Family schemas and types

// Unit Schema
export const unitSchema = z.object({
    id: z.string().uuid(),
    organizationId: organizationIdSchema,
    block: z.string().max(16).nullable().optional(),
    number: z.string().max(16),
    identifier: z.string().max(32),
    floor: z.number().int().nullable().optional(),
    type: z.string().max(32).nullable().optional(),
    active: z.boolean().default(true),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
})

export type Unit = z.infer<typeof unitSchema>

export const createUnitSchema = z.object({
    block: z.string().max(16).optional(),
    number: z.string().min(1, 'El número es requerido').max(16),
    floor: z.number().int().optional().nullable().transform((val) => val ?? undefined),
    type: z.string().max(32).optional(),
    active: z.boolean().default(true).optional(),
})

export type CreateUnitFormData = z.infer<typeof createUnitSchema>
export type UpdateUnitFormData = Partial<CreateUnitFormData>
/** Body de `POST /units` (el super-admin indica el condominio). */
export type CreateUnitPayload = CreateUnitFormData & OrganizationScoped

export const createBulkUnitsSchema = z.object({
    block: z.string().max(16).optional(),
    numberFrom: z.number().int().min(1, 'El número inicial debe ser mayor a 0'),
    numberTo: z.number().int().min(1, 'El número final debe ser mayor a 0'),
    floor: z.number().int().optional(),
    type: z.string().max(32).optional(),
    active: z.boolean().default(true).optional(),
    // Solo el super-admin (ver OrganizationScoped); se limpia al enviar.
    organizationId: optionalUuidField,
}).refine(data => data.numberFrom <= data.numberTo, {
    message: 'El número inicial debe ser menor o igual al número final',
    path: ['numberFrom'],
})

export type CreateBulkUnitsFormData = z.infer<typeof createBulkUnitsSchema>
/** Body de `POST /units/bulk`. */
export type CreateBulkUnitsPayload = Omit<CreateBulkUnitsFormData, 'organizationId'> & OrganizationScoped

export const bulkUnitsResultSchema = z.object({
    created: z.array(unitSchema),
    skipped: z.array(z.string()),
    total: z.number(),
})

export type BulkUnitsResult = z.infer<typeof bulkUnitsResultSchema>

export const unitStatsSchema = z.object({
    total: z.number(),
    occupied: z.number(),
    available: z.number(),
    inactive: z.number(),
})

export type UnitStats = z.infer<typeof unitStatsSchema>

// Family Schema actualizado para usar unit
export const familySchema = z.object({
    id: z.string().uuid(),
    organizationId: organizationIdSchema,
    name: z.string().max(128),
    description: z.string().max(256).nullable().optional(),
    unit: unitSchema.nullable().optional(),
    active: z.boolean().default(true),
    // Conserje Digital (IA del citófono) habilitado para la unidad de la familia.
    digitalConciergeEnabled: z.boolean().optional(),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
    members: z.array(embeddedUserSchema).optional(),
})

export type Family = z.infer<typeof familySchema>

export const createFamilySchema = z.object({
    name: z.string().min(1, 'El nombre es requerido').max(128),
    description: z.string().max(256).optional(),
    // '' = "Sin unidad asignada"; el formulario lo limpia antes de enviar.
    unitId: optionalUuidField,
    active: z.boolean().default(true).optional(),
    // Solo el super-admin al crear (ver OrganizationScoped).
    organizationId: optionalUuidField,
    // Solo al editar y con families.update (no existe en CreateFamilyDto).
    digitalConciergeEnabled: z.boolean().optional(),
})

export type CreateFamilyFormData = z.infer<typeof createFamilySchema>
/** Body de `POST /families`. */
export interface CreateFamilyPayload extends OrganizationScoped {
    name: string
    description?: string
    unitId?: string
    active?: boolean
}
/**
 * Body de `PATCH /families/:id` (`UpdateFamilyDto`): un campo extra o
 * `organizationId` → 400. `digitalConciergeEnabled` exige families.update.
 */
export interface UpdateFamilyFormData {
    name?: string
    description?: string
    unitId?: string
    active?: boolean
    digitalConciergeEnabled?: boolean
}

// Add/Remove members from family
export const addMemberSchema = z.object({
    userId: z.string().uuid('Debe seleccionar un usuario válido'),
})

export const addMembersSchema = z.object({
    userIds: z.array(z.string().uuid()).min(1, 'Debe seleccionar al menos un usuario'),
})

export type AddMemberFormData = z.infer<typeof addMemberSchema>
export type AddMembersFormData = z.infer<typeof addMembersSchema>

// Available user (user without family)
export const availableUserSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    rut: z.string().nullable().optional(),
})

export type AvailableUser = z.infer<typeof availableUserSchema>

// Vehicle schemas and types

export const vehicleSchema = z.object({
    id: z.string().uuid(),
    plate: z.string().max(16),
    brand: z.string().max(128).nullable().optional(),
    model: z.string().max(64).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    year: z.number().int().nullable().optional(),
    vehicleType: z.string().max(32).nullable().optional(),
    accessLevel: z.string().max(64).nullable().optional(),
    active: z.boolean().nullable().optional(),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
    owner: embeddedUserSchema.nullable().optional(),
})

export type Vehicle = z.infer<typeof vehicleSchema>

// P5.C: `vehicleType` es solo la carrocería (descriptivo); `accessLevel` es lo
// único que decide el portón. El backend rechaza (400) cualquier otro literal.
export const VEHICLE_TYPES = ['auto', 'camioneta', 'moto', 'camion', 'otro'] as const
export const vehicleTypeSchema = z.enum(VEHICLE_TYPES)
export type VehicleType = z.infer<typeof vehicleTypeSchema>

export const VEHICLE_ACCESS_LEVELS = ['residente', 'visitante', 'servicio'] as const
export const vehicleAccessLevelSchema = z.enum(VEHICLE_ACCESS_LEVELS)
export type VehicleAccessLevel = z.infer<typeof vehicleAccessLevelSchema>

export const createVehicleSchema = z.object({
    plate: z.string()
        .min(1, 'La patente es requerida')
        .max(16)
        .regex(/^[A-Z0-9]+$/, 'La patente solo puede contener letras y números')
        .transform(val => val.toUpperCase()),
    brand: z.string().max(128).optional(),
    model: z.string().max(64).optional(),
    color: z.string().max(32).optional(),
    year: z.number().int().min(1900).max(new Date().getFullYear() + 1).optional(),
    // '' = "sin elegir" en el <select>; el payload lo traduce (ver toVehiclePayload).
    vehicleType: z.union([z.literal(''), vehicleTypeSchema]).optional(),
    accessLevel: z.union([z.literal(''), vehicleAccessLevelSchema]).optional(),
    ownerId: z.string().optional().transform(val => !val || val === '' ? undefined : val),
    active: z.boolean().default(true).optional(),
    // Solo el super-admin al crear (ver OrganizationScoped).
    organizationId: optionalUuidField,
})

/** Valores del formulario (antes de las transformaciones de zod). */
export type VehicleFormValues = z.input<typeof createVehicleSchema>
export type CreateVehicleFormData = z.infer<typeof createVehicleSchema>

/** Body de `POST /vehicles`: sin elegir = campo ausente. */
export interface CreateVehiclePayload {
    plate: string
    brand?: string
    model?: string
    color?: string
    year?: number
    vehicleType?: VehicleType
    accessLevel?: VehicleAccessLevel
    ownerId?: string
    active?: boolean
    /** Solo el super-admin (ver OrganizationScoped). */
    organizationId?: string
}

/**
 * Body de `PUT /vehicles/:id`: `null` limpia carrocería, nivel de acceso o
 * propietario (este último solo con `condominium.view-all`); nunca `organizationId`.
 */
export interface UpdateVehiclePayload
    extends Omit<Partial<CreateVehiclePayload>, 'vehicleType' | 'accessLevel' | 'organizationId' | 'ownerId'> {
    vehicleType?: VehicleType | null
    accessLevel?: VehicleAccessLevel | null
    ownerId?: string | null
}

// Visit schemas and types

export const visitTypeSchema = z.enum(['vehicular', 'pedestrian'])
export type VisitType = z.infer<typeof visitTypeSchema>

// Orden del ciclo de vida: `awaiting_approval` es una solicitud del conserje
// digital que el residente todavía no aprueba (no admite check-in ni QR).
export const visitStatusSchema = z.enum([
    'awaiting_approval',
    'pending',
    'active',
    'ready',
    'completed',
    'cancelled',
    'expired',
    'denied',
])
export type VisitStatus = z.infer<typeof visitStatusSchema>

export const visitSchema = z.object({
    id: z.string().uuid(),
    type: visitTypeSchema,
    status: visitStatusSchema,
    visitorName: z.string().max(128),
    visitorRut: z.string().max(32).nullable().optional(),
    visitorPhone: z.string().max(15).nullable().optional(),
    reason: z.string().max(256).nullable().optional(),
    qrCode: z.string().max(64).nullable().optional(),
    maxUses: z.number().int().nullable().optional(), // null = ilimitado
    usedCount: z.number().int().default(0), // Contador de usos
    validFrom: z.string().transform((date) => new Date(date)),
    validUntil: z.string().transform((date) => new Date(date)),
    entryTime: z.string().transform((date) => new Date(date)).nullable().optional(),
    exitTime: z.string().transform((date) => new Date(date)).nullable().optional(),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
    host: embeddedUserSchema.optional(),
    family: familySchema.nullable().optional(),
    vehicle: vehicleSchema.nullable().optional(),
    // Patente de una solicitud sin `vehicle` aún (el backend lo crea al aprobar).
    requestedPlate: z.string().max(16).nullable().optional(),
})

export type Visit = z.infer<typeof visitSchema>

export const createVisitSchema = z.object({
    type: visitTypeSchema,
    visitorName: z.string().min(1, 'El nombre del visitante es requerido').max(128),
    visitorRut: z.string().max(32).optional().refine(
        (val) => {
            // Si está vacío, es válido (campo opcional)
            if (!val || val.trim() === '') return true
            // Si tiene valor, debe ser un RUT o pasaporte válido
            return isValidChileanId(val)
        },
        { message: 'Ingrese un RUT o pasaporte válido' }
    ),
    visitorPhone: z.string().max(15).optional(),
    reason: z.string().max(256).optional(),
    validFrom: z.string().min(1, 'La fecha de inicio es requerida'),
    validUntil: z.string().min(1, 'La fecha de fin es requerida'),
    hostId: z.string().uuid('Debe seleccionar un anfitrión'),
    familyId: z.string().uuid().optional(),
    maxUses: z.preprocess(
        (val) => {
            // Si es undefined, null, NaN o string vacío, devolver undefined
            if (val === undefined || val === null || val === '' || (typeof val === 'number' && isNaN(val))) {
                return undefined;
            }
            return val;
        },
        z.number().int().min(1, 'Debe ser al menos 1').optional()
    ),
    // Para visitas vehiculares
    vehiclePlate: z.string().max(16).optional(),
    vehicleBrand: z.string().max(128).optional(),
    vehicleModel: z.string().max(64).optional(),
    vehicleColor: z.string().max(32).optional(),
}).refine(
    (data) => {
        // Si es visita vehicular, la patente es requerida
        if (data.type === 'vehicular') {
            return !!data.vehiclePlate && data.vehiclePlate.length > 0
        }
        return true
    },
    {
        message: 'La patente es requerida para visitas vehiculares',
        path: ['vehiclePlate'],
    }
)

export type CreateVisitFormData = z.infer<typeof createVisitSchema>
export type UpdateVisitFormData = Partial<CreateVisitFormData>
