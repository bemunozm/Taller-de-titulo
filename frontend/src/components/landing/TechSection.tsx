import { motion } from 'motion/react'
import { 
  CircleStackIcon, 
  GlobeAltIcon, 
  LockClosedIcon,
  SparklesIcon
} from '@heroicons/react/24/outline'

export default function TechSection() {
  return (
    <section id="tecnología" className="py-32 bg-zinc-900/20 border-y border-white/5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-1/3 h-full bg-indigo-600/5 blur-[120px] -rotate-12" />
      
      <div className="container mx-auto px-6">
        <div className="flex flex-col lg:flex-row items-center gap-20">
          <div className="flex-1">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 mb-6"
            >
              <SparklesIcon className="h-4 w-4 text-emerald-400" />
              <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Tecnología Vanguadista</span>
            </motion.div>
            
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-4xl md:text-6xl font-black text-white mb-8 tracking-tighter leading-tight"
            >
              INFRAESTRUCTURA <br />
              <span className="text-zinc-600">PRIVACY-FIRST</span>
            </motion.h2>
            
            <div className="space-y-8">
              {[
                {
                  title: 'Edge AI Processing',
                  desc: 'Inferencia local en el hub para garantizar que tus datos nunca salgan de tu red privada a menos que sea necesario.',
                  icon: CircleStackIcon
                },
                {
                  title: 'Cloud-Hybrid Sync',
                  desc: 'Sincronización inteligente para alertas globales y acceso remoto ultra-seguro desde cualquier lugar.',
                  icon: GlobeAltIcon
                },
                {
                  title: 'Encriptación de Grado Militar',
                  desc: 'Protocolos de comunicación AES-256 para cada paquete de video y datos de identidad.',
                  icon: LockClosedIcon
                }
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 + (i * 0.1) }}
                  className="flex gap-6"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center border border-white/5 group-hover:border-white/20 transition-all">
                    <item.icon className="h-6 w-6 text-zinc-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white uppercase tracking-widest mb-2">{item.title}</h4>
                    <p className="text-zinc-500 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="flex-1 w-full"
          >
             <div className="relative aspect-square max-w-lg mx-auto">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 rounded-[80px] blur-3xl animate-pulse" />
                <div className="relative h-full w-full rounded-[60px] bg-zinc-950 border border-white/10 p-12 overflow-hidden shadow-2xl flex flex-col justify-center">
                   <div className="space-y-6 opacity-60">
                      <div className="h-1 lg:h-2 w-full bg-white/5 rounded-full overflow-hidden">
                         <div className="h-full w-3/4 bg-indigo-500 animate-pulse" />
                      </div>
                      <div className="h-1 lg:h-2 w-1/2 bg-white/5 rounded-full overflow-hidden">
                         <div className="h-full w-1/2 bg-emerald-500 animate-pulse delay-75" />
                      </div>
                      <div className="h-1 lg:h-2 w-5/6 bg-white/5 rounded-full overflow-hidden">
                         <div className="h-full w-2/3 bg-indigo-500 animate-pulse delay-150" />
                      </div>
                   </div>
                   
                   <div className="mt-12 text-center">
                      <p className="text-[10px] font-mono text-zinc-600 mb-2 uppercase tracking-widest">SYSTEM_STATUS_HEALTHY</p>
                      <div className="text-6xl font-black text-white tabular-nums">99.9<span className="text-emerald-500">%</span></div>
                      <p className="text-[11px] font-black text-zinc-400 mt-4 uppercase tracking-[0.3em]">AI CONSISTENCY RATE</p>
                   </div>
                   
                   <div className="mt-12 flex justify-center gap-4">
                      {[1,2,3,4].map(i => (
                        <div key={i} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10" />
                      ))}
                   </div>
                </div>
             </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
