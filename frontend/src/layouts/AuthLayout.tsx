import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <main className="flex min-h-dvh flex-col p-2">
      <div className="flex grow items-center justify-center p-6 lg:rounded-lg lg:bg-white lg:p-10 lg:shadow-xs lg:ring-1 lg:ring-zinc-950/5 dark:lg:bg-zinc-900 dark:lg:ring-white/10">
        <div className="flex w-full max-w-md flex-col items-center gap-8">
          <img 
            src="/logo-fondo-oscuro.png" 
            alt="Logo" 
            className="h-32 w-auto"
          />
          <Outlet />
        </div>
      </div>
    </main>
  )
}
