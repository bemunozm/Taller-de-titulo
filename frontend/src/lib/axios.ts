import axios from 'axios'

// VITE_API_URL apunta a la API de negocio (prefijo global `/api/v1`, ver
// backend/src/main.ts `setGlobalPrefix`), p.ej. http://localhost:3000/api/v1.
// better-auth monta sus propias rutas en `/api/auth/*`, FUERA de ese prefijo
// (backend/src/main.ts `BETTER_AUTH_BASE_PATH`) — por eso se deriva el host
// pelado quitando el sufijo `/api/v1` para construir la baseURL de `authApi`.
const API_HOST = (import.meta.env.VITE_API_URL as string).replace(/\/api\/v1\/?$/, '')

// Tarea #20 (fase 0 auth-multitenant): auth por cookie httpOnly de
// better-auth en vez de `Authorization: Bearer` + localStorage. `withCredentials`
// hace que el navegador envíe/reciba la cookie de sesión en cada request.
const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    withCredentials: true
})

// Instancia dedicada a los endpoints nativos de better-auth
// (sign-in/email, sign-out, etc.), montados en `/api/auth/*` — un prefijo
// distinto al de `api` de arriba.
export const authApi = axios.create({
    baseURL: `${API_HOST}/api/auth`,
    withCredentials: true
})

export default api