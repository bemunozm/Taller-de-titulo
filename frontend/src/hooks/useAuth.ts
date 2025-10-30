import {useQuery, useQueryClient} from '@tanstack/react-query'
import { getUser } from "@/api/AuthAPI";
import { useCallback } from 'react'

export const useAuth = () => {
    const queryClient = useQueryClient()
    const { data, isError, isLoading } = useQuery({
        queryKey: ['user'],
        queryFn: getUser,
        retry: 1,
        refetchOnWindowFocus: false
    });

    const logout = useCallback(() => {
        try {
            localStorage.removeItem('AUTH_TOKEN')
        } catch (e) {
            // ignore
        }
        try {
            // remove user query and clear cache to force refetch when needed
            queryClient.removeQueries({ queryKey: ['user'] })
            // optionally clear all queries: queryClient.clear()
        } catch (e) {
            // ignore
        }
    }, [queryClient])

    return { data, isError, isLoading, logout }
}