import { motion, AnimatePresence } from 'motion/react'
import { useState, useEffect } from 'react'
import { 
  BellAlertIcon, 
  MapPinIcon, 
  ShieldCheckIcon,
  VideoCameraIcon,
  UserIcon,
  KeyIcon,
  Bars3Icon
} from '@heroicons/react/24/outline'

/**
 * AnimatedMobileApp
 * A pure-component implementation of the VigilIA mobile app,
 * following Remotion-style sequencing for a "story" animation.
 */
function VirtualApp() {
  const [step, setStep] = useState(0)
  
  // Simulation of Remotion Timeline
  useEffect(() => {
    const timer = setInterval(() => {
      setStep(prev => (prev + 1) % 4)
    }, 4000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="w-full h-full bg-zinc-950 flex flex-col overflow-hidden font-sans">
      {/* App Header */}
      <div className="px-6 pt-12 pb-6 border-b border-white/5 flex items-center justify-between">
         <Bars3Icon className="h-5 w-5 text-zinc-500" />
         <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">VigilIA_Mobile</span>
         <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
            <UserIcon className="h-4 w-4 text-indigo-400" />
         </div>
      </div>

      <div className="flex-1 overflow-hidden p-6 space-y-6">
         {/* Live Camera Feed Mockup */}
         <div className="relative aspect-video bg-zinc-900 rounded-3xl border border-white/5 overflow-hidden group shadow-2xl">
            <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 px-2 py-1 bg-red-600 rounded-lg text-[7px] font-black text-white uppercase tracking-widest animate-pulse">
               LIVE_FEED
            </div>
            
            {/* AI Bounding Box Animation */}
            <AnimatePresence mode="wait">
               {step >= 1 && (
                 <motion.div 
                   initial={{ opacity: 0, scale: 0.8 }}
                   animate={{ opacity: 1, scale: 1 }}
                   exit={{ opacity: 0 }}
                   className="absolute top-1/4 left-1/4 w-1/3 h-1/2 border-2 border-indigo-500 rounded-xl"
                 >
                    <div className="absolute top-0 left-0 -translate-y-full pb-1">
                       <span className="bg-indigo-600 text-[6px] font-black text-white px-1.5 py-0.5 rounded uppercase tracking-tighter">
                          Persona_Detectada: 0.98
                       </span>
                    </div>
                 </motion.div>
               )}
            </AnimatePresence>

            {/* Simulated Video Static/Grain */}
            <div className="absolute inset-0 noise-bg opacity-10 pointer-events-none" />
            
            {/* Placeholder Visuals (Circles/Lines) */}
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
               <div className="w-24 h-24 border border-zinc-700 rounded-full" />
            </div>
         </div>

         {/* Event List */}
         <div className="space-y-4">
            <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest px-1">Actividad Reciente</h4>
            
            {[
              { time: '14:20', text: 'Vehículo ABC-123 Detectado', icon: MapPinIcon, active: step >= 0 },
              { time: '14:22', text: 'Visitante en Puerta Principal', icon: UserIcon, active: step >= 2 },
              { time: '14:23', text: 'Acceso Remoto Autorizado', icon: ShieldCheckIcon, active: step >= 3 }
            ].map((ev, i) => (
              <motion.div 
                key={i}
                animate={{ 
                  opacity: ev.active ? 1 : 0.3,
                  x: ev.active ? 0 : -10
                }}
                className={`p-4 rounded-2xl border flex items-center gap-4 transition-colors ${
                  ev.active ? 'bg-zinc-900/50 border-white/10' : 'bg-transparent border-white/5'
                }`}
              >
                 <div className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
                   ev.active ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-white/5 border-white/5 text-zinc-700'
                 }`}>
                    <ev.icon className="h-4 w-4" />
                 </div>
                 <div className="flex-1">
                    <p className={`text-[9px] font-bold ${ev.active ? 'text-white' : 'text-zinc-700'}`}>{ev.text}</p>
                    <p className="text-[7px] font-black text-zinc-600 uppercase tracking-tighter">{ev.time}</p>
                 </div>
              </motion.div>
            ))}
         </div>
      </div>

      {/* App Bottom Tabs */}
      <div className="px-8 py-6 border-t border-white/5 flex justify-between">
         <VideoCameraIcon className="h-5 w-5 text-indigo-500" />
         <KeyIcon className="h-5 w-5 text-zinc-700" />
         <BellAlertIcon className="h-5 w-5 text-zinc-700" />
         <MapPinIcon className="h-5 w-5 text-zinc-700" />
      </div>
    </div>
  )
}

export default function MobileShowcase() {
  return (
    <section id="mobile" className="py-32 bg-zinc-950 relative overflow-hidden">
      <div className="container mx-auto px-6 relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-20 lg:gap-32">
          
          {/* Virtual Smartphone Frame */}
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="flex-1 order-2 lg:order-1 relative group"
          >
            {/* External Device Frame (iPhone-like) */}
            <div className="relative mx-auto w-[300px] h-[620px] bg-zinc-900 rounded-[55px] p-3 border-[6px] border-zinc-800 shadow-[20px_40px_80px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-white/10 overflow-hidden">
               {/* Speaker/Camera Notch */}
               <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-zinc-900 rounded-b-2xl z-50 flex items-center justify-center gap-2">
                  <div className="w-8 h-1 bg-zinc-800 rounded-full" />
                  <div className="w-2 h-2 rounded-full bg-zinc-800" />
               </div>
               
               {/* The Simulated App */}
               <div className="w-full h-full rounded-[44px] overflow-hidden">
                  <VirtualApp />
               </div>
            </div>

            {/* Atmospheric lighting */}
            <div className="absolute -inset-20 bg-indigo-500/10 blur-[120px] rounded-full -z-10 animate-pulse" />
          </motion.div>

          {/* Marketing Content */}
          <div className="flex-1 order-1 lg:order-2">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 mb-8"
            >
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">Hardware-Agile Experience</span>
            </motion.div>

            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-5xl md:text-7xl font-black text-white mb-8 tracking-tighter leading-tight uppercase"
            >
              CONTROL <br />
              <span className="text-zinc-600 italic">Programático.</span>
            </motion.h2>

            <p className="text-lg text-zinc-500 font-medium leading-relaxed mb-12 max-w-lg">
               Hemos diseñado la app de VigilIA utilizando principios de composición de video avanzada. Cada interacción es fluida, predecible y visualmente impactante, permitiéndote gestionar tu seguridad con un solo toque.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
               {[
                 {
                   title: 'IA Reactiva móvil',
                   desc: 'Animaciones coordinadas para mostrar detecciones en tiempo real.',
                   icon: BellAlertIcon
                 },
                 {
                   title: 'Zero-Image Policy',
                   desc: 'Interfaz vectorial ligera diseñada para máxima velocidad en 5G/Edge.',
                   icon: VideoCameraIcon
                 }
               ].map((item, i) => (
                 <div key={i} className="space-y-4">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                       <item.icon className="h-5 w-5 text-indigo-400" />
                    </div>
                    <h4 className="text-[10px] font-black text-white uppercase tracking-widest">{item.title}</h4>
                    <p className="text-[11px] text-zinc-500 font-bold leading-relaxed">{item.desc}</p>
                 </div>
               ))}
            </div>
            
            <div className="mt-16 flex items-center gap-6">
               <button className="px-10 py-5 bg-white text-black font-black uppercase tracking-[0.2em] text-[10px] rounded-full shadow-2xl hover:bg-zinc-200 transition-all">
                  Explorar App
               </button>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
