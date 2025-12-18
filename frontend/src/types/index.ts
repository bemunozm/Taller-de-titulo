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
    token: z.string().length(6),
})
export type Auth = z.infer<typeof authSchema>
export type UserLoginForm = Pick<Auth   , 'email' | 'password'>
export type UserRegistrationForm = Pick<Auth, 'name' | 'email' | 'password' | 'password_confirmation' | 'age' | 'phone' | 'rut' >
export type RequestConfirmationCodeForm = Pick<Auth, 'email'>
export type ForgotPasswordForm = Pick<Auth, 'email'>
export type NewPasswordForm = Pick<Auth, 'password' | 'password_confirmation'>
export type UpdateCurrentUserPasswordForm = Pick<Auth, 'current_password' | 'password' | 'password_confirmation'>
export type ConfirmToken = Pick<Auth, 'token'>
export type CheckPasswordForm = Pick<Auth, 'password'>

// Unit schema básico (para evitar circular dependency con familyBasicSchema)
const unitBasicSchema = z.object({
    id: z.string().uuid(),
    identifier: z.string().max(32),
    block: z.string().max(16).nullable().optional(),
    number: z.string().max(16),
    floor: z.number().int().nullable().optional(),
    type: z.string().max(32).nullable().optional(),
})

// Family schema básico (sin members para evitar circular dependency)
const familyBasicSchema = z.object({
    id: z.string().uuid(),
    name: z.string().max(128),
    description: z.string().max(256).nullable().optional(),
    unit: unitBasicSchema.nullable().optional(),
    active: z.boolean().default(true),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
})

export const userSchema = z.object({
    id: z.string().uuid(),
    rut: z.string().max(50),
    name: z.string().max(100),
    email: z.string().email(),
    phone: z.string().max(15),
    password: z.string().optional(), // Opcional porque no siempre se incluye en las respuestas
    age: z.number().int().positive().optional(),
    profilePicture: z.string().nullable().optional(),
    confirmed: z.boolean().default(false),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
    deletedAt: z.string().transform((date) => new Date(date)).nullable(),
    roles: z.array(roleSchema).optional(),
    tokens: z.array(tokenSchema).optional(),
    family: familyBasicSchema.nullable().optional(),
})

// Define el tipo User que es el tipo inferido del esquema userSchema
// Ahora incluye family directamente en el schema
export type User = z.infer<typeof userSchema>

// UserWithFamily es ahora solo un alias de User (mantener por compatibilidad)
export type UserWithFamily = User
export type UserFormData = Pick<User, 'name' | 'email' | 'password'  | 'age' | 'phone' | 'rut'>
export type UserUpdateData = Pick<User, 'name' | 'email' | 'age' | 'phone' | 'rut'> & {
    roleIds?: string[]
    familyId?: string | null
}
export type UserLoginData = Pick<User, 'email' | 'password'>
export type UserAuthResponse = Omit<User, 'password' | 'tokens'> & {
    token?: string
}

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
    familyId: z.string().uuid().optional(),
})

export type UserAdminFormData = z.infer<typeof userAdminFormSchema>

// Camera schemas and types

// Camera schema based on backend entity (backend/src/cameras/entities/camera.entity.ts)
export const cameraSchema = z.object({
    id: z.string().uuid(),
    name: z.string().max(150),
    location: z.string().max(200).optional(),
    // mountPath is optional and generated by backend
    mountPath: z.string().max(150).optional(),
    registeredInMediamtx: z.boolean().optional(),
    active: z.boolean().optional(),
    // roles may be present in populated responses
    roles: z.array(roleSchema).optional(),
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
    // role IDs that will be associated to the camera
    roleIds: z.array(z.string().uuid()).optional(),
})

export type CreateCameraFormData = z.infer<typeof createCameraSchema>

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

export const createBulkUnitsSchema = z.object({
    block: z.string().max(16).optional(),
    numberFrom: z.number().int().min(1, 'El número inicial debe ser mayor a 0'),
    numberTo: z.number().int().min(1, 'El número final debe ser mayor a 0'),
    floor: z.number().int().optional(),
    type: z.string().max(32).optional(),
    active: z.boolean().default(true).optional(),
}).refine(data => data.numberFrom <= data.numberTo, {
    message: 'El número inicial debe ser menor o igual al número final',
    path: ['numberFrom'],
})

export type CreateBulkUnitsFormData = z.infer<typeof createBulkUnitsSchema>

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
    name: z.string().max(128),
    description: z.string().max(256).nullable().optional(),
    unit: unitSchema.nullable().optional(),
    active: z.boolean().default(true),
    createdAt: z.string().transform((date) => new Date(date)),
    updatedAt: z.string().transform((date) => new Date(date)),
    members: z.array(userSchema).optional(),
})

export type Family = z.infer<typeof familySchema>

export const createFamilySchema = z.object({
    name: z.string().min(1, 'El nombre es requerido').max(128),
    description: z.string().max(256).optional(),
    unitId: z.string().uuid().optional(),
    active: z.boolean().default(true).optional(),
})

export type CreateFamilyFormData = z.infer<typeof createFamilySchema>
export type UpdateFamilyFormData = Partial<CreateFamilyFormData>

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
    rut: z.string().optional(),
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
    owner: userSchema.nullable().optional(),
})

export type Vehicle = z.infer<typeof vehicleSchema>

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
    vehicleType: z.string().max(32).optional(),
    accessLevel: z.string().max(64).optional(),
    ownerId: z.string().optional().transform(val => !val || val === '' ? undefined : val),
    active: z.boolean().default(true).optional(),
})

export type CreateVehicleFormData = z.infer<typeof createVehicleSchema>
export type UpdateVehicleFormData = Partial<CreateVehicleFormData>

// Visit schemas and types

export const visitTypeSchema = z.enum(['vehicular', 'pedestrian'])
export type VisitType = z.infer<typeof visitTypeSchema>

export const visitStatusSchema = z.enum(['pending', 'active', 'ready', 'completed', 'cancelled', 'expired', 'denied'])
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
    host: userSchema.optional(),
    family: familySchema.nullable().optional(),
    vehicle: vehicleSchema.nullable().optional(),
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
