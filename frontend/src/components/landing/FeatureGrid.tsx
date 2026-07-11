import { motion } from 'motion/react'
import { 
  UserGroupIcon, 
  EyeIcon, 
  HashtagIcon, 
  CpuChipIcon,
  FingerPrintIcon,
  SignalIcon
} from '@heroicons/react/24/outline'

const features = [
  {
    title: 'Digital Concierge',
    desc: 'Interacción de voz humanizada para recepción de visitas y gestión de paquetería.',
    icon: UserGroupIcon,
    color: 'bg-indigo-500',
    delay: 0.1
  },
  {
    title: 'Guardian AI',
    desc: 'Detección proactiva de anomalías y comportamiento sospechoso en tiempo real.',
    icon: EyeIcon,
    color: 'bg-emerald-500',
    delay: 0.2
  },
  {
    title: 'Next-Gen LPR',
    desc: 'Reconocimiento de matrículas con precisión militar para accesos automatizados.',
    icon: HashtagIcon,
    color: 'bg-indigo-500',
    delay: 0.3
  },
  {
    title: 'Edge AI Computing',
    desc: 'Procesamiento en el origen del video para latencia cero y máxima privacidad.',
    icon: CpuChipIcon,
    color: 'bg-zinc-500',
    delay: 0.4
  },
  {
    title: 'Control Biométrico',
    desc: 'Sincronización con dispositivos de acceso para un ecosistema unificado.',
    icon: FingerPrintIcon,
    color: 'bg-indigo-500',
    delay: 0.5
  },
  {
    title: 'Visión Multidimensional',
    desc: 'Integración total de cámaras CCTV bajo un solo cerebro centralizado.',
    icon: SignalIcon,
    color: 'bg-emerald-500',
    delay: 0.6
  }
]

export default function FeatureGrid() {
  return (
    <section id="características" className="py-32 bg-zinc-950">
      <div className="container mx-auto px-6">
        <div className="text-center mb-24">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-black text-white mb-6 tracking-tight"
          >
            TECNOLOGÍA QUE <span className="italic">Transforma</span> LA SEGURIDAD
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-zinc-500 max-w-xl mx-auto uppercase tracking-widest text-[10px] font-black"
          >
            Una infraestructura de software diseñada para la excelencia operativa.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: f.delay }}
              className="group p-8 md:p-10 rounded-[40px] bg-white/[0.02] border border-white/5 hover:border-indigo-500/30 transition-all duration-500"
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 border transition-transform group-hover:scale-110 ${
                f.color === 'bg-indigo-500' 
                ? 'bg-indigo-500/10 border-indigo-500/20' 
                : f.color === 'bg-emerald-500' 
                ? 'bg-emerald-500/10 border-emerald-500/20' 
                : 'bg-zinc-500/10 border-zinc-500/20'
              }`}>
                <f.icon className={`h-7 w-7 ${
                  f.color === 'bg-indigo-500' ? 'text-indigo-400' : f.color === 'bg-emerald-500' ? 'text-emerald-400' : 'text-zinc-400'
                }`} />
              </div>
              <h3 className="text-xl font-black text-white mb-4 uppercase tracking-tighter">{f.title}</h3>
              <p className="text-zinc-500 leading-relaxed font-medium">
                {f.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
