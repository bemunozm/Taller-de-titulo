import api, { authApi } from "@/lib/axios";
import { isAxiosError } from "axios";
import { userSchema } from "@/types/index";
import type { CheckPasswordForm, ConfirmToken, ForgotPasswordForm, NewPasswordForm, RequestConfirmationCodeForm, UserLoginForm, UserRegistrationForm } from "@/types/index";

// Shape de error nativo de better-auth (`/api/auth/*`) — distinto del shape
// `{ message, error, statusCode }` que usan los endpoints propios de Nest.
interface BetterAuthErrorBody {
    message?: string
    code?: string
}

function getBetterAuthErrorMessage(error: unknown, fallback: string): string {
    if (isAxiosError<BetterAuthErrorBody>(error) && error.response?.data?.message) {
        return error.response.data.message
    }
    return fallback
}

export async function createAccount(formData: UserRegistrationForm) {
    try {
        const url = '/auth/create-account'
        const { data } = await api.post<string>(url, formData)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
    }
}

export async function confirmAccount(formData: ConfirmToken) {
    try {
        const url = '/auth/confirm-account'
        const { data } = await api.post<string>(url, formData)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
    }
}

export async function requestConfirmationCode(formData: RequestConfirmationCodeForm) {
    try {
        const url = '/auth/request-code'
        const { data } = await api.post<string>(url, formData)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
    }
}

/**
 * Tarea #20: login vía better-auth (`POST /api/auth/sign-in/email`) — setea
 * la cookie de sesión httpOnly automáticamente (withCredentials en `authApi`),
 * ya no devuelve/guarda un JWT en localStorage.
 */
export async function authenticateUser(formData: UserLoginForm) {
    try {
        const url = '/sign-in/email'
        const { data } = await authApi.post(url, formData)
        return data
    } catch (error) {
        throw new Error(getBetterAuthErrorMessage(error, 'Credenciales inválidas'))
    }
}

/** Tarea #20: cierra la sesión de better-auth (limpia la cookie httpOnly en el servidor). */
export async function signOutUser() {
    try {
        await authApi.post('/sign-out')
    } catch (error) {
        // Best-effort: si la llamada de red falla, igual se limpia el estado
        // local (ver useAuth.logout) — no bloqueamos el cierre de sesión local.
        console.error('Error al cerrar sesión en el servidor:', error)
    }
}

export async function forgotPassword(formData: ForgotPasswordForm) {
    try {
        const url = '/auth/forgot-password'
        const { data } = await api.post<string>(url, formData)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
    }
}

export async function validateToken(formData: ConfirmToken) {
    try {
        const url = '/auth/validate-token'
        const { data } = await api.post<string>(url, formData)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
    }
}

export async function updatePasswordWithToken({formData, token}: {formData: NewPasswordForm, token: ConfirmToken['token']}) {
    try {
        
        const url = `/auth/reset-password`
        const { data } = await api.post<string>(url, { token: token, password: formData.password })
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
    }
}

export async function getUser() {
    try {
        const { data } = await api('/auth/user')
        const response = userSchema.safeParse(data)
        if(response.success) {
            return response.data
        }
        throw new Error('Error al validar los datos del usuario')
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw error
    }
}

export async function checkPassword(formData: CheckPasswordForm) {
    try {
        const url = '/auth/check-password'
        const { data } = await api.post<string>(url, formData)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
    }
}

export async function updateProfile(formData: { name: string; phone?: string; age?: number }) {
    try {
        const url = '/auth/profile'
        const { data } = await api.post<string>(url, formData)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al actualizar el perfil')
    }
}

export async function updateCurrentUserPassword(formData: { current_password: string; password: string }) {
    try {
        const url = '/auth/update-password'
        const { data } = await api.post<string>(url, formData)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al actualizar la contraseña')
    }
}

export async function uploadProfilePicture(file: File) {
    try {
        const formData = new FormData()
        formData.append('file', file)
        
        const url = '/auth/upload-profile-picture'
        const { data } = await api.post<{ url: string }>(url, formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        })
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al subir la imagen de perfil')
    }
}

export async function deleteProfilePicture() {
    try {
        const url = '/auth/delete-profile-picture'
        const { data } = await api.delete<string>(url)
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al eliminar la imagen de perfil')
    }
}

// Obtener todos los usuarios
export async function getUsers() {
    try {
        const { data } = await api.get('/users')
        return data
    } catch (error) {
        if(isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener los usuarios')
    }
}