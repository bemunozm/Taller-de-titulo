import { Heading, Subheading } from '@/components/ui/Heading'
import { Button } from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'
import { ChevronLeftIcon } from '@heroicons/react/20/solid'
import { VideoCameraIcon, PlusIcon } from '@heroicons/react/24/outline'
import CamerasPanel from '@/components/control-panel/CamerasPanel'
import { useState } from 'react'

export default function CamerasSettingsView() {
  const navigate = useNavigate()
  const [triggerNewCamera, setTriggerNewCamera] = useState(false)

  return (
    <div className="max-w-7xl mx-auto">
      <Button plain onClick={() => navigate('/settings')} className="mb-4 text-zinc-400 hover:text-white">
        <ChevronLeftIcon className="h-5 w-5" />
        Volver a Configuraciones
      </Button>
      
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <VideoCameraIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          <div>
            <Heading>Configuración de Cámaras</Heading>
            <Subheading>
              Administra cámaras RTSP, análisis LPR y registro en MediaMTX
            </Subheading>
          </div>
        </div>
        <Button color="indigo" onClick={() => setTriggerNewCamera(!triggerNewCamera)}>
          <PlusIcon className="w-5 h-5" />
          Nueva Cámara
        </Button>
      </header>

      <CamerasPanel triggerNew={triggerNewCamera} />
    </div>
  )
}
