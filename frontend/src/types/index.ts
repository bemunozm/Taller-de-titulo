import { z } from 'zod'

// Define el esquema de un permiso
// Sirve para validar los datos de un permiso antes de enviarlos al servidor o de mostrarlos en la aplicación
// El esquema de un permiso es un objeto que tiene las siguientes propiedades:
export const permissionSchema = z.object({
    id: z.uuid(),
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
    id: z.uuid(),
    name: z.string().max(100),
    description: z.string().optional(),
    permissions: z.array(permissionSchema).optional(),
})

// Define el tipo Role que es el tipo inferido del esquema roleSchema
export type Role = z.infer<typeof roleSchema>
export type RoleFormData = Pick<Role, 'name' | 'description'>

// Define el esquema de un token
// Sirve para validar los datos de un token antes de enviarlos al servidor o de mostrarlos en la aplicación
// El esquema de un token es un objeto que tiene las siguientes propiedades:
export const tokenSchema = z.object({
    id: z.uuid(),
    token: z.string().length(6),
    userId: z.uuid(),
    createdAt: z.date(),
    expiresAt: z.date(),
})

// Define el tipo Token que es el tipo inferido del esquema tokenSchema
export type Token = z.infer<typeof tokenSchema>
export type TokenFormData = Pick<Token, 'token' | 'userId'>

// Define el esquema de un usuario
// Sirve para validar los datos de un usuario antes de enviarlos al servidor o de mostrarlos en la aplicación
// El esquema de un usuario es un objeto que tiene las siguientes propiedades:
export const userSchema = z.object({
    id: z.uuid(),
    name: z.string().max(100),
    email: z.email(),
    password: z.string().optional(), // Opcional porque no siempre se incluye en las respuestas
    age: z.number().int().positive().optional(),
    confirmed: z.boolean().default(false),
    createdAt: z.date(),
    updatedAt: z.date(),
    deletedAt: z.date().optional(),
    roles: z.array(roleSchema).optional(),
    tokens: z.array(tokenSchema).optional(),
})

// Define el tipo User que es el tipo inferido del esquema userSchema
export type User = z.infer<typeof userSchema>
export type UserFormData = Pick<User, 'name' | 'email' | 'password' | 'age'>
export type UserUpdateData = Pick<User, 'name' | 'email' | 'age'>
export type UserLoginData = Pick<User, 'email' | 'password'>
export type UserAuthResponse = Omit<User, 'password' | 'tokens'> & {
    token?: string
}

// Tipos adicionales para la API de autenticación basados en los schemas existentes

// Define el tipo para el registro de usuario (mismo que UserFormData)
export type UserRegistrationForm = UserFormData

// Define el tipo para el login de usuario 
export type UserLoginForm = UserLoginData

// Define el tipo para tokens de confirmación (basado en tokenSchema)
export type ConfirmToken = Pick<Token, 'token'>

// Define el tipo para solicitar código de confirmación (basado en userSchema)
export type RequestConfirmationCodeForm = Pick<User, 'email'>

// Define el tipo para forgot password (basado en userSchema)
export type ForgotPasswordForm = Pick<User, 'email'>

// Define el tipo para nueva contraseña (basado en userSchema)
export type NewPasswordForm = Pick<User, 'password'>

// Define el tipo para verificar contraseña (basado en userSchema)
export type CheckPasswordForm = Pick<User, 'password'>
