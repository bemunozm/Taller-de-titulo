import { useMemo, useState } from 'react'
import { Heading, Subheading } from '@/components/ui/Heading'
import CamerasPanel from '@/components/control-panel/CamerasPanel'

export default function SettingsView() {
  const menu = useMemo(
    () => [
      { id: 'cameras', label: 'Administrar cámaras' },
      { id: 'credentials', label: 'Credenciales' },
      { id: 'integrations', label: 'Integraciones' },
    ],
    []
  )

  const [activeMenu, setActiveMenu] = useState('cameras')

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <Heading className="text-gray-900 dark:text-white">Configuraciones</Heading>
        <Subheading className="text-gray-600 dark:text-gray-400">Ajustes del sistema y administración</Subheading>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="rounded-lg bg-zinc-900 p-4 shadow-sm ring-1 ring-white/5">
          <ul className="space-y-2">
            {menu.map((m) => (
              <li key={m.id}>
                <button
                  className={`w-full text-left rounded-md px-3 py-2 ${activeMenu === m.id ? 'bg-zinc-800 text-white font-semibold' : 'text-gray-300 hover:text-white'}`}
                  onClick={() => setActiveMenu(m.id)}
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-6 shadow-sm ring-1 ring-white/5">
          {activeMenu === 'cameras' && (
            <section>
              <CamerasPanel />
            </section>
          )}

          {activeMenu === 'credentials' && (
            <section>
              <h3 className="text-lg font-semibold dark:text-white">Credenciales</h3>
              <p className="text-sm text-gray-400 mt-2">Administrar credenciales y accesos (placeholder)</p>
            </section>
          )}

          {activeMenu === 'integrations' && (
            <section>
              <h3 className="text-lg font-semibold dark:text-white">Integraciones</h3>
              <p className="text-sm text-gray-400 mt-2">Configura integraciones externas (placeholder)</p>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
