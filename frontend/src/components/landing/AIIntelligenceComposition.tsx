import { motion, AnimatePresence } from 'motion/react'
import { useState, useEffect } from 'react'
import { 
  ShieldExclamationIcon,
  EyeIcon,
  CpuChipIcon,
  CheckBadgeIcon,
  LockClosedIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline'

/**
 * AIIntelligenceComposition
 * A fully autonomous, programmatic animation of an AI security protocol.
 * Following Remotion principles:
 * - Timeline-based sequencing (Step-driven)
 * - Purely component-based visuals
 * - Visual storytelling of a security event
 */
export default function AIIntelligenceComposition() {
  const [step, setStep] = useState(0)
  
  // The "Remotion Timeline" simulation
  // 0: Scanning
  // 1: Person Detection
  // 2: Identification & Analysis
  // 3: Alert & Protocol Trigger
  // 4: Action (Lock & Notify)
  // 5: Reset
  useEffect(() => {
    const timer = setInterval(() => {
      setStep(prev => (prev + 1) % 6)
    }, 3500)
    return () => clearInterval(timer)
  }, [])

  return (
    <section className="py-48 bg-zinc-950 overflow-hidden relative">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
          
          {/* Virtual AI Composition (The "Video Player") */}
          <div className="relative z-10 w-full group">
             {/* Main Canvas */}
             <motion.div 
                animate={{ 
                    backgroundColor: step >= 3 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(9, 9, 11, 1)',
                    borderColor: step >= 3 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.1)'
                }}
                className="aspect-video bg-zinc-950 rounded-[64px] border p-12 relative overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,1)] flex flex-col justify-between"
             >
                {/* 1. Background Grid Composition */}
                <div className="absolute inset-0 opacity-5" 
                     style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                
                {/* 2. Scanning Laser Line (Always active) */}
                <motion.div 
                  animate={{ top: ['-10%', '110%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                  className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500 to-transparent z-20 opacity-40 shadow-[0_0_20px_rgba(79,70,229,1)]"
                />

                <div className="relative h-full flex flex-col justify-between z-30">
                   {/* Top HUD */}
                   <div className="flex justify-between items-start">
                      <div className="space-y-3">
                         <div className="inline-flex gap-2 items-center px-4 py-1.5 bg-black/60 rounded-full border border-white/10 backdrop-blur-xl">
                            <span className={`w-2 h-2 rounded-full animate-pulse ${step >= 3 ? 'bg-red-500' : 'bg-emerald-500'}`} />
                            <span className={`text-[10px] font-mono font-black uppercase tracking-[0.2em] ${step >= 3 ? 'text-red-400' : 'text-emerald-400'}`}>
                               {step === 0 && 'System_Scanning...'}
                               {step === 1 && 'Object_Acquisition'}
                               {step === 2 && 'Inference_Complete'}
                               {step >= 3 && 'CRITICAL_PROTOCOL_ACTIVE'}
                            </span>
                         </div>
                         <AnimatePresence mode="wait">
                            <motion.h3 
                              key={step}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="text-4xl font-black text-white uppercase tracking-tighter"
                            >
                               {step === 0 && 'Monitorizando...'}
                               {step === 1 && 'Objetivo Detectado'}
                               {step === 2 && 'Identificado: Humano'}
                               {step >= 3 && 'Amenaza Confirmada'}
                            </motion.h3>
                         </AnimatePresence>
                      </div>
                      <CpuChipIcon className={`h-8 w-8 transition-colors duration-500 ${step >= 3 ? 'text-red-500' : 'text-zinc-700'}`} />
                   </div>

                   {/* Central AI Scene (Visual Logic) */}
                   <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="relative w-48 h-64">
                         {/* Person Silhouette (CSS Only) */}
                         <motion.div 
                            animate={{ opacity: step >= 1 ? 0.2 : 0, scale: step >= 1 ? 1 : 0.8 }}
                            className="absolute inset-0 flex flex-col items-center translate-y-8"
                         >
                            <div className="w-16 h-16 rounded-full bg-white mb-4 shadow-[0_0_30px_rgba(255,255,255,0.2)]" />
                            <div className="w-24 h-48 bg-white rounded-[40px] shadow-[0_0_40px_rgba(255,255,255,0.1)]" />
                         </motion.div>

                         {/* Bounding Box Sequence */}
                         <AnimatePresence>
                            {step >= 1 && (
                               <motion.div 
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ 
                                    opacity: 1, 
                                    scale: 1,
                                    borderColor: step >= 3 ? 'rgba(239, 68, 68, 1)' : 'rgba(79, 70, 229, 1)',
                                    boxShadow: step >= 3 ? '0 0 30px rgba(239, 68, 68, 0.4)' : '0 0 30px rgba(79, 70, 229, 0.4)'
                                  }}
                                  exit={{ opacity: 0 }}
                                  className="absolute inset-0 border-2 rounded-2xl transition-colors duration-500"
                               >
                                  {/* Corner Brackets */}
                                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 -translate-x-1 -translate-y-1 border-inherit" />
                                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 translate-x-1 -translate-y-1 border-inherit" />
                                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 -translate-x-1 translate-y-1 border-inherit" />
                                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 translate-x-1 translate-y-1 border-inherit" />

                                  {/* Data Label */}
                                  <motion.div 
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: step >= 2 ? 1 : 0, x: 0 }}
                                    className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full pb-6"
                                  >
                                    <div className={`px-4 py-1.5 rounded-lg text-[10px] font-black text-white uppercase tracking-widest shadow-2xl transition-colors duration-500 ${step >= 3 ? 'bg-red-600' : 'bg-indigo-600'}`}>
                                       CLASE: PERSONA | CONF: 0.992
                                    </div>
                                  </motion.div>
                               </motion.div>
                            )}
                         </AnimatePresence>
                      </div>
                   </div>

                   {/* Bottom Protocol HUD */}
                   <div className="grid grid-cols-4 gap-4">
                      {[
                        { label: 'VISIÓN', sub: 'ACTIVA', icon: EyeIcon, done: step >= 0 },
                        { label: 'IDENTIDAD', sub: 'HUMANO', icon: ShieldExclamationIcon, done: step >= 2 },
                        { label: 'ACCIÓN', sub: 'BLOQUEO', icon: LockClosedIcon, done: step >= 4 },
                        { label: 'NOTIFICAR', sub: 'ENVIADO', icon: ChatBubbleLeftRightIcon, done: step >= 4 }
                      ].map((prot, i) => (
                        <motion.div 
                          key={i}
                          animate={{ 
                            opacity: prot.done ? 1 : 0.2,
                            y: prot.done ? 0 : 10,
                            backgroundColor: (i >= 2 && step >= 4) ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.03)'
                          }}
                          className="p-4 rounded-3xl border border-white/5 backdrop-blur-md flex flex-col items-center text-center gap-2"
                        >
                           <prot.icon className={`h-5 w-5 ${prot.done ? (i >= 2 && step >= 4 ? 'text-red-400' : 'text-indigo-400') : 'text-zinc-700'}`} />
                           <div>
                              <p className="text-[7px] font-black text-zinc-600 uppercase tracking-widest">{prot.label}</p>
                              <p className={`text-[8px] font-black uppercase ${prot.done ? 'text-white' : 'text-zinc-800'}`}>{prot.sub}</p>
                           </div>
                        </motion.div>
                      ))}
                   </div>
                </div>

                {/* Final Protocol Overlay (Action Phase) */}
                <AnimatePresence>
                   {step === 4 && (
                     <motion.div 
                       initial={{ opacity: 0 }}
                       animate={{ opacity: 1 }}
                       exit={{ opacity: 0 }}
                       className="absolute inset-0 bg-red-600/20 backdrop-blur-[2px] z-50 flex items-center justify-center p-12"
                     >
                        <div className="p-8 bg-zinc-950 border-2 border-red-600 rounded-[40px] shadow-[0_0_100px_rgba(239,68,68,0.5)] text-center space-y-4">
                           <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center mx-auto mb-4 animate-bounce">
                              <LockClosedIcon className="h-8 w-8 text-white" />
                           </div>
                           <h4 className="text-2xl font-black text-white uppercase tracking-tighter">Protocolo_Cierre_Activo</h4>
                           <p className="text-[10px] font-mono text-red-500 uppercase tracking-widest font-black">Central de Seguridad Notificada</p>
                        </div>
                     </motion.div>
                   )}
                </AnimatePresence>
             </motion.div>

             {/* Dynamic Glow */}
             <motion.div 
               animate={{ 
                 opacity: step >= 3 ? 0.15 : 0.05,
                 scale: step >= 3 ? 1.2 : 1 
               }}
               className="absolute -inset-20 bg-indigo-500 blur-[140px] -z-10 rounded-full transition-colors duration-1000"
               style={{ backgroundColor: step >= 3 ? '#ef4444' : '#6366f1' }}
             />
          </div>

          {/* Marketing Content */}
          <div className="space-y-12">
            <motion.div
               animate={{ opacity: 1 }} // Static here for readability, but items inside move
            >
               <h2 className="text-5xl md:text-7xl font-black text-white uppercase tracking-tighter mb-8 leading-[0.85]">
                  UNA IA QUE <br />
                  <span className="text-zinc-600 italic">Nunca se Distrae.</span>
               </h2>
               <p className="text-zinc-500 text-xl font-medium leading-relaxed max-w-xl">
                  VigilIA no espera a que revises las grabaciones. Nuestro motor de inferencia autónomo detecta, analiza y ejecuta protocolos de defensa en milisegundos.
               </p>
            </motion.div>

            <div className="space-y-8">
               {[
                 { title: 'Detección Cognitiva', desc: 'Identifica patrones de merodeo antes de que ocurra el incidente.', step: 1 },
                 { title: 'Respuesta Autónoma', desc: 'Bloquea accesos y alerta a conserjería de forma inmediata.', step: 4 }
               ].map((item, i) => (
                 <motion.div 
                   key={i}
                   animate={{ opacity: step >= item.step ? 1 : 0.3 }}
                   className="flex gap-6 items-start"
                 >
                    <div className={`flex-shrink-0 w-12 h-12 rounded-2xl border flex items-center justify-center transition-colors ${step >= item.step ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-white/5 border-white/5 text-zinc-800'}`}>
                       <CheckBadgeIcon className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-white uppercase tracking-widest mb-1">{item.title}</h4>
                      <p className="text-xs text-zinc-600 font-bold leading-relaxed">{item.desc}</p>
                    </div>
                 </motion.div>
               ))}
            </div>

            <div className="pt-8 border-t border-white/5">
                <div className="flex items-center gap-4">
                   <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
                   <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Latencia de Decisión: <span className="text-white">42ms</span></p>
                </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
