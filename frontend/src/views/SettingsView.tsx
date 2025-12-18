import { Heading, Subheading } from '@/components/ui/Heading'
import { Link } from 'react-router-dom'
import { 
  VideoCameraIcon, 
  UserGroupIcon, 
  DocumentTextIcon, 
  ShieldCheckIcon,
  CircleStackIcon,
  MapIcon,
  HomeModernIcon,
  UsersIcon
} from '@heroicons/react/24/outline'

interface SettingCard {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  color: string
  permission?: string
  anyRole?: string[]
}

export default function SettingsView() {
  const settings: SettingCard[] = [
    {
      id: 'cameras',
      title: 'Cámaras',
      description: 'Administra cámaras RTSP, análisis LPR y MediaMTX',
      icon: VideoCameraIcon,
      href: '/settings/cameras',
      color: 'from-blue-500/20 to-indigo-500/20 border-blue-500/30',
      permission: 'cameras.read'
    },
    {
      id: 'users',
      title: 'Usuarios',
      description: 'Gestiona usuarios, familias y permisos',
      icon: UserGroupIcon,
      href: '/settings/users',
      color: 'from-emerald-500/20 to-green-500/20 border-emerald-500/30',
      permission: 'users.read'
    },
    {
      id: 'families',
      title: 'Familias',
      description: 'Administra familias y asignación de unidades',
      icon: UsersIcon,
      href: '/settings/families',
      color: 'from-lime-500/20 to-emerald-500/20 border-lime-500/30',
      permission: 'families.read'
    },
    {
      id: 'units',
      title: 'Unidades',
      description: 'Gestiona departamentos, casas y espacios',
      icon: HomeModernIcon,
      href: '/settings/units',
      color: 'from-sky-500/20 to-blue-500/20 border-sky-500/30',
      permission: 'units.read'
    },
    {
      id: 'roles',
      title: 'Roles y Permisos',
      description: 'Configura roles y asigna permisos granulares',
      icon: ShieldCheckIcon,
      href: '/settings/roles',
      color: 'from-purple-500/20 to-pink-500/20 border-purple-500/30',
      permission: 'roles.read'
    },
    {
      id: 'logs',
      title: 'Auditoría',
      description: 'Revisa registros de auditoría y eventos del sistema',
      icon: DocumentTextIcon,
      href: '/settings/audit',
      color: 'from-orange-500/20 to-red-500/20 border-orange-500/30',
      permission: 'audit.read'
    },
    {
      id: 'system-logs',
      title: 'Logs del Sistema',
      description: 'Monitorea comunicaciones entre servicios y errores',
      icon: CircleStackIcon,
      href: '/settings/logs',
      color: 'from-indigo-500/20 to-purple-500/20 border-indigo-500/30',
      permission: 'logs.read'
    },
    {
      id: 'traceability',
      title: 'Trazabilidad',
      description: 'Rastrea intentos de acceso y detecciones del sistema',
      icon: MapIcon,
      href: '/traceability',
      color: 'from-teal-500/20 to-cyan-500/20 border-teal-500/30',
      permission: 'detections.read'
    }
  ]

  return (
    <div className="max-w-7xl mx-auto">
      <header className="mb-8">
        <Heading className="text-gray-900 dark:text-white">Configuraciones</Heading>
        <Subheading className="text-gray-600 dark:text-gray-400">
          Administra todos los aspectos del sistema desde un solo lugar
        </Subheading>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {settings.map((setting) => {
          const Icon = setting.icon
          return (
            <Link
              key={setting.id}
              to={setting.href}
              className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-6 transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-zinc-900/50"
            >
              {/* Gradient overlay */}
              <div className={`absolute inset-0 bg-gradient-to-br ${setting.color} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
              
              {/* Content */}
              <div className="relative z-10">
                <div className="mb-4 inline-flex rounded-lg bg-zinc-800/80 p-3 ring-1 ring-white/10 group-hover:ring-white/20 transition-all">
                  <Icon className="h-6 w-6 text-zinc-300 group-hover:text-white transition-colors" />
                </div>
                
                <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-white transition-colors">
                  {setting.title}
                </h3>
                
                <p className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
                  {setting.description}
                </p>
              </div>

              {/* Hover effect border */}
              <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 ring-1 ring-inset ring-white/10" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
