import { Heading, Subheading } from '@/components/ui/Heading'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Text } from '@/components/ui/Text'

export default function DashboardView() {
  // Datos estáticos de ejemplo — se pueden reemplazar por datos reales
  const stats = {
    camerasOnline: 3,
    camerasOffline: 1,
    alertsToday: 2,
  }

  const recentEvents = [
    { id: 1, when: 'Hace 5 min', text: 'Movimiento detectado en Cámara 2' },
    { id: 2, when: 'Hace 23 min', text: 'Cámara 4 desconectada' },
    { id: 3, when: 'Ayer', text: 'Acceso confirmado - Residente: María P.' },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading className="text-gray-900 dark:text-white">Panel de control</Heading>
          <Subheading className="text-gray-600 dark:text-gray-400">Visión general de cámaras y actividad reciente</Subheading>
        </div>

        <div className="flex items-center gap-3">
          <Badge color="green">Producción</Badge>
          <Button color="indigo" href="/residente">Ir a Residente</Button>
          <Button outline onClick={() => alert('Abrir configuración (placeholder)')}>Configuración</Button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-6">
        <article className="rounded-lg bg-zinc-900 p-4 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-center justify-between">
            <Text className="text-sm/6 font-medium text-zinc-100">Cámaras online</Text>
            <div className="text-2xl font-semibold">{stats.camerasOnline}</div>
          </div>
          <div className="mt-3 text-xs text-gray-400">Monitorizando transmisiones activas</div>
        </article>

        <article className="rounded-lg bg-zinc-900 p-4 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-center justify-between">
            <Text className="text-sm/6 font-medium text-zinc-100">Cámaras offline</Text>
            <div className="text-2xl font-semibold text-amber-600">{stats.camerasOffline}</div>
          </div>
          <div className="mt-3 text-xs text-gray-400">Verifica la conectividad de las cámaras</div>
        </article>

        <article className="rounded-lg bg-zinc-900 p-4 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-center justify-between">
            <Text className="text-sm/6 font-medium text-zinc-100">Alertas hoy</Text>
            <div className="text-2xl font-semibold text-red-600">{stats.alertsToday}</div>
          </div>
          <div className="mt-3 text-xs text-gray-400">Revisa eventos críticos o notificaciones</div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg bg-zinc-900 p-6 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Cámaras - vista rápida</h3>
              <p className="text-sm text-gray-400 mt-1">Accede a tus transmisiones desde aquí</p>
            </div>
            <div className="flex items-center gap-3">
              <Button color="blue" href="/conserje">Ver mosaico</Button>
              <Button outline onClick={() => alert('Switch camera (placeholder)')}>Cambiar cámara</Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Mini previews estáticos como placeholder */}
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-video rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sm text-gray-400">
                Preview {i + 1}
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-lg bg-zinc-900 p-4 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-center gap-3">
            <Avatar initials="MA" />
            <div>
              <div className="font-semibold text-zinc-100">María Alvarez</div>
              <div className="text-sm text-gray-400">Administrador</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <Text className="text-sm/6 text-zinc-100">Últimos eventos</Text>
              <Button plain href="/events">Ver todos</Button>
            </div>

            <ul className="mt-3 space-y-3">
              {recentEvents.map((ev) => (
                <li key={ev.id} className="flex items-start gap-3">
                  <Badge color={ev.id === 2 ? 'amber' : ev.id === 1 ? 'red' : 'zinc'}>{ev.when}</Badge>
                  <div>
                    <div className="text-sm text-zinc-100">{ev.text}</div>
                    <div className="text-xs text-gray-400">Detalle breve del evento</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </div>
  )
}
