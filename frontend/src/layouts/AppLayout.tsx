import { useAuth } from '@/hooks/useAuth'
import { Navigate, Outlet } from 'react-router-dom'

export default function AppLayout() {
  const { data, isError, isLoading} = useAuth()
    if(isLoading) return 'Cargando...'
    if(isError) {
        return <Navigate to='/auth/login' />
    }

    if(data) return (
    <>
      <header className="p-4 bg-gray-800 text-white">
        <h1 className="text-2xl font-bold">App Header</h1>
      </header>

      <main className="p-4">
        <Outlet/>
      </main>

      <footer className="p-4 bg-gray-800 text-white mt-auto">
        <p className="text-center">&copy; 2024 My Application</p>
      </footer>
    </>
  )
}
