import {
  UserGroupIcon,
  HomeIcon,
  UserIcon,
} from '@heroicons/react/24/outline';

interface FamilyMember {
  id: string;
  name: string;
  email: string;
  rut?: string;
}

interface MyFamilyCardProps {
  family?: {
    id: string;
    name: string;
    description?: string | null;
    unit?: {
      id: string;
      identifier: string;
      block?: string | null;
      number: string;
      floor?: number | null;
      type?: string | null;
    } | null;
    active: boolean;
  } | null;
  members?: FamilyMember[];
}

export function MyFamilyCard({ family, members }: MyFamilyCardProps) {
  if (!family) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 w-full h-full flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <UserGroupIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Mi Familia
          </h3>
        </div>
        <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
          <UserGroupIcon className="h-12 w-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No estás asignado a ninguna familia
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 w-full h-full flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <UserGroupIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Mi Familia
        </h3>
      </div>

      <div className="space-y-4 flex-1 flex flex-col">
        {/* Nombre de la Familia */}
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {family.name}
          </p>
          {family.description && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {family.description}
            </p>
          )}
        </div>

        {/* Detalles */}
        <div className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          {family.unit && (
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-500/10 rounded-lg">
                <HomeIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Unidad</p>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {family.unit.identifier}
                </p>
                {family.unit.type && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {family.unit.type}
                    {family.unit.floor !== null && family.unit.floor !== undefined && (
                      <> · Piso {family.unit.floor < 0 ? `S${Math.abs(family.unit.floor)}` : family.unit.floor}</>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Estado */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${family.active ? 'bg-green-500' : 'bg-zinc-400'}`}></div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {family.active ? 'Familia activa' : 'Familia inactiva'}
            </p>
          </div>
        </div>

        {/* Miembros de la Familia */}
        {members && members.length > 0 && (
          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-3">
              <UserIcon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Miembros ({members.length})
              </p>
            </div>
            <div className="space-y-2 overflow-y-auto flex-1">
              {members.map((member) => (
                <div 
                  key={member.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50"
                >
                  <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                      {member.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {member.name}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {member.email}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Información adicional */}
        <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 mt-auto">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Para actualizar información de tu familia, contacta al administrador.
          </p>
        </div>
      </div>
    </div>
  );
}
