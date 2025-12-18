import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  UserCircleIcon, 
  KeyIcon, 
  BellIcon,
  ShieldCheckIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';
import { Heading, Subheading } from '@/components/ui/Heading';
import { Avatar } from '@/components/ui/Avatar';
import { getUser } from '@/api/AuthAPI';
import { PersonalInfoSection } from '@/components/profile/PersonalInfoSection';
import { SecuritySection } from '@/components/profile/SecuritySection';
import { NotificationPreferencesSection } from '@/components/profile/NotificationPreferencesSection';
import { AccountInfoSection } from '@/components/profile/AccountInfoSection';
import type { UserWithFamily } from '@/types/index';

type ActiveSection = 'personal' | 'security' | 'notifications' | 'account';

export default function ProfileView() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('personal');

  const { data: user, isLoading } = useQuery<UserWithFamily>({
    queryKey: ['currentUser'],
    queryFn: getUser,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando perfil...
        </span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 dark:text-zinc-400">
          No se pudo cargar la información del perfil
        </p>
      </div>
    );
  }

  const sections = [
    {
      id: 'personal' as ActiveSection,
      name: 'Información Personal',
      icon: UserCircleIcon,
      description: 'Datos personales y de contacto',
    },
    {
      id: 'security' as ActiveSection,
      name: 'Seguridad',
      icon: KeyIcon,
      description: 'Contraseña y opciones de seguridad',
    },
    {
      id: 'notifications' as ActiveSection,
      name: 'Notificaciones',
      icon: BellIcon,
      description: 'Preferencias de notificaciones',
    },
    {
      id: 'account' as ActiveSection,
      name: 'Información de Cuenta',
      icon: ShieldCheckIcon,
      description: 'Roles, permisos y estado de cuenta',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-3">
          <Avatar 
            src={user.profilePicture}
            initials={user.name.charAt(0).toUpperCase()}
            alt={user.name}
            className="size-16 bg-indigo-600 text-white dark:bg-indigo-500 ring-4 ring-indigo-100 dark:ring-indigo-900"
          />
          <div>
            <Heading>{user.name}</Heading>
            <Subheading>{user.email}</Subheading>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1">
          <nav className="space-y-1">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors
                    ${isActive 
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400' 
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }
                  `}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{section.name}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {section.description}
                    </div>
                  </div>
                  {isActive && <ChevronRightIcon className="w-4 h-4 flex-shrink-0" />}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6">
            {activeSection === 'personal' && <PersonalInfoSection user={user} />}
            {activeSection === 'security' && <SecuritySection />}
            {activeSection === 'notifications' && <NotificationPreferencesSection />}
            {activeSection === 'account' && <AccountInfoSection user={user} />}
          </div>
        </div>
      </div>
    </div>
  );
}
