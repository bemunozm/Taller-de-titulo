import { motion } from 'motion/react'
import { CheckIcon } from '@heroicons/react/24/solid'
import { useState } from 'react'

const pricing = [
  {
    name: 'Lite',
    price: { monthly: '49', yearly: '39' },
    desc: 'Esencial para residencias privadas.',
    features: ['1 Cámara Inteligente', 'Digital Concierge Básico', 'Alertas vía Telegram', 'Soporte 24/7'],
    cta: 'Empezar ahora',
    pro: false
  },
  {
    name: 'Pro',
    price: { monthly: '129', yearly: '99' },
    desc: 'Control total para edificios y condominios.',
    features: ['Hasta 8 Cámaras AI', 'Guardián IA Avanzado', 'Smart LPR (Matrículas)', 'Panel Administrativo', 'API Access'],
    cta: 'Probar Gratis 14 días',
    pro: true
  },
  {
    name: 'Enterprise',
    price: { monthly: 'Custom', yearly: 'Custom' },
    desc: 'Soluciones críticas para industria.',
    features: ['Cámaras Ilimitadas', 'Inferencia Edge dedicada', 'Integración con Central Receptoras', 'Manager de Cuenta Dedicado'],
    cta: 'Contactar Ventas',
    pro: false
  }
]

export default function Pricing() {
  const [isYearly, setIsYearly] = useState(true)

  return (
    <section id="pricing" className="py-32 bg-zinc-950 relative overflow-hidden">
      <div className="container mx-auto px-6 relative z-10">
        <div className="text-center mb-20">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl font-black text-white mb-6 uppercase tracking-tighter"
          >
            PLANES DE <span className="text-indigo-500">GRADO ELITE</span>
          </motion.h2>
          
          <div className="flex items-center justify-center gap-4 mt-8">
            <span className={`text-[10px] font-black uppercase tracking-widest ${!isYearly ? 'text-white' : 'text-zinc-500'}`}>Mensual</span>
            <button 
              onClick={() => setIsYearly(!isYearly)}
              className="w-12 h-6 rounded-full bg-zinc-800 border border-white/10 relative p-1 transition-colors hover:border-indigo-500"
            >
              <motion.div 
                animate={{ x: isYearly ? 24 : 0 }}
                className="w-4 h-4 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(79,70,229,0.5)]"
              />
            </button>
            <span className={`text-[10px] font-black uppercase tracking-widest ${isYearly ? 'text-white' : 'text-zinc-500'}`}>Anual (Ahorra 20%)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {pricing.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`relative p-10 rounded-[48px] border transition-all duration-500 ${
                p.pro 
                ? 'bg-zinc-900 border-indigo-500/50 shadow-[0_40px_80px_-20px_rgba(79,70,229,0.2)] scale-105 z-10' 
                : 'bg-white/[0.02] border-white/5 hover:border-white/20'
              }`}
            >
              {p.pro && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1.5 bg-indigo-600 rounded-full text-[9px] font-black text-white uppercase tracking-[0.2em] shadow-lg shadow-indigo-600/30">
                  Más Popular
                </div>
              )}
              
              <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tight">{p.name}</h3>
              <p className="text-zinc-500 text-sm mb-8 font-medium">{p.desc}</p>
              
              <div className="mb-10">
                <span className="text-5xl font-black text-white tracking-tighter">
                    {typeof p.price.monthly === 'string' && p.price.monthly !== 'Custom' ? '$' : ''}
                    {isYearly ? p.price.yearly : p.price.monthly}
                </span>
                {p.price.monthly !== 'Custom' && (
                    <span className="text-zinc-600 text-xs font-black uppercase tracking-widest ml-2">/ mes</span>
                )}
              </div>

              <ul className="space-y-4 mb-12">
                {p.features.map(f => (
                  <li key={f} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                      <CheckIcon className="h-3 w-3 text-indigo-400" />
                    </div>
                    <span className="text-sm text-zinc-400 font-medium">{f}</span>
                  </li>
                ))}
              </ul>

              <button className={`w-full py-5 rounded-[24px] text-[10px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 ${
                p.pro 
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/20' 
                : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'
              }`}>
                {p.cta}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
