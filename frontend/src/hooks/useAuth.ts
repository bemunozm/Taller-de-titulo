import {useQuery, useQueryClient} from '@tanstack/react-query'
import { getUser, signOutUser } from "@/api/AuthAPI";
import { useCallback } from 'react'
import { webSocketService } from '@/services/WebSocketService'

export const useAuth = () => {
    const queryClient = useQueryClient()
    const { data, isError, isLoading } = useQuery({
        queryKey: ['user'],
        queryFn: getUser,
        retry: 1,
        refetchOnWindowFocus: false
    });

    const logout = useCallback(async () => {
        // El socket de la sesión se cierra ya, sin esperar a que el cambio
        // de usuario llegue a `RealtimeConnection` (P6).
        webSocketService.disconnect()
        // Tarea #20: cierra la sesión de better-auth (limpia la cookie httpOnly
        // en el servidor) y luego limpia el cache local del usuario.
        await signOutUser()
        try {
            queryClient.removeQueries({ queryKey: ['user'] })
            // optionally clear all queries: queryClient.clear()
        } catch {
            // ignore
        }
    }, [queryClient])

    return { data, isError, isLoading, logout }
}
