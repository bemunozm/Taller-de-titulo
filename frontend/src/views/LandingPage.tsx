import LandingNavbar from '../components/landing/LandingNavbar'
import Hero from '../components/landing/Hero'
import FeatureGrid from '../components/landing/FeatureGrid'
import TechSection from '../components/landing/TechSection'
import DashboardMockup from '../components/landing/DashboardMockup'
import Pricing from '../components/landing/Pricing'
import AIIntelligenceComposition from '../components/landing/AIIntelligenceComposition'
import MobileShowcase from '../components/landing/MobileShowcase'
import { motion } from 'motion/react'
import { HeartIcon } from '@heroicons/react/24/solid'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 font-sans selection:bg-indigo-500 selection:text-white overflow-x-hidden">
      {/* Global noise overlay */}
      <div className="fixed inset-0 noise-bg z-[100] opacity-[0.02] pointer-events-none" />
      
      <LandingNavbar />
      
      <main>
        <Hero />
        
        {/* Animated Brand Stripe */}
        <section className="py-20 border-y border-white/5 bg-zinc-900/10 overflow-hidden relative">
          <div className="noise-bg absolute inset-0 opacity-[0.03]" />
          <motion.div 
            animate={{ x: [0, -1000] }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            className="flex whitespace-nowrap gap-24 items-center opacity-20 grayscale"
          >
             {[1,2,3,4,5,6].map(i => (
                <div key={i} className="flex gap-24 items-center">
                    <span className="text-2xl font-black text-white uppercase tracking-[0.6em]">VigilIA CORE</span>
                    <span className="text-2xl font-black text-white uppercase tracking-[0.6em]">EDGE AI</span>
                    <span className="text-2xl font-black text-white uppercase tracking-[0.6em]">Next-Gen LPR</span>
                </div>
             ))}
          </motion.div>
        </section>

        <FeatureGrid />
        
        <DashboardMockup />

        <AIIntelligenceComposition />

        <MobileShowcase />

        <TechSection />

        <Pricing />

        {/* CTA Final - Luxury Refactor */}
        <section className="py-48 relative overflow-hidden">
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-indigo-950/20 to-transparent" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[600px] bg-indigo-600/5 blur-[120px] rounded-full" />
            
            <div className="container mx-auto px-6 relative z-10 text-center">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    className="max-w-5xl mx-auto p-12 md:p-32 rounded-[80px] bg-white/[0.01] border border-white/5 backdrop-blur-[2px] relative overflow-hidden group shadow-3xl"
                >
                    <div className="absolute inset-0 noise-bg opacity-[0.05]" />
                    
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                    >
                        <h2 className="text-5xl md:text-8xl font-black text-white mb-10 tracking-tighter leading-[0.9] uppercase">
                            DOMINA TU <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-emerald-400">INFRAESTRUCTURA.</span>
                        </h2>
                        <p className="text-zinc-500 text-lg md:text-xl mb-16 font-medium max-w-2xl mx-auto leading-relaxed">
                            No te conformes con grabaciones pasivas. Implementa un cerebro proactivo que proteja, gestione y evolucione con tu entorno.
                        </p>
                        
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-8">
                            <button className="w-full sm:w-auto px-16 py-7 bg-white text-black font-black uppercase tracking-[0.2em] text-[10px] rounded-full shadow-[0_30px_60px_-15px_rgba(255,255,255,0.2)] hover:bg-zinc-200 transition-all active:scale-95">
                                Agendar Demo Estratégica
                            </button>
                            <button className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 hover:text-white transition-colors border-b border-zinc-800 pb-1">
                                Revisar Documentación SaaS
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            </div>
        </section>
      </main>

      <footer className="py-32 border-t border-white/5 bg-zinc-950 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="container mx-auto px-6">
           <div className="grid grid-cols-1 md:grid-cols-4 gap-20">
              <div className="col-span-2">
                 <div className="flex items-center gap-2 mb-8">
                    <span className="text-2xl font-black text-white uppercase tracking-tighter">VigilIA</span>
                 </div>
                 <p className="text-zinc-600 max-w-xs text-sm leading-relaxed mb-8">
                    Liderando la revolución de la seguridad inteligente con arquitectura Edge AI y hospitalidad digital de vanguardia.
                 </p>
              </div>
              
              <div className="space-y-6">
                 <h5 className="text-[10px] font-black text-white uppercase tracking-widest">Plataforma</h5>
                 <ul className="space-y-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                    <li className="hover:text-indigo-400 transition-colors cursor-pointer text-[9px]">Funcionalidades</li>
                    <li className="hover:text-indigo-400 transition-colors cursor-pointer text-[9px]">Seguridad Edge</li>
                    <li className="hover:text-indigo-400 transition-colors cursor-pointer text-[9px]">Hardware Hub</li>
                    <li className="hover:text-indigo-400 transition-colors cursor-pointer text-[9px]">Precios SaaS</li>
                 </ul>
              </div>

              <div className="space-y-6">
                 <h5 className="text-[10px] font-black text-white uppercase tracking-widest">Legal</h5>
                 <ul className="space-y-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                    <li className="hover:text-indigo-400 transition-colors cursor-pointer text-[9px]">Privacidad</li>
                    <li className="hover:text-indigo-400 transition-colors cursor-pointer text-[9px]">Términos</li>
                    <li className="hover:text-indigo-400 transition-colors cursor-pointer text-[9px]">Cumplimiento GDPR</li>
                 </ul>
              </div>
           </div>

           <div className="mt-32 pt-12 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-8">
              <span className="text-[10px] text-zinc-700 font-bold uppercase tracking-widest">© 2026 VigilIA IA Security - Todos los derechos reservados.</span>
              <div className="flex items-center gap-2 text-zinc-800 text-[10px] font-bold uppercase tracking-widest">
                Hecho con <HeartIcon className="h-4 w-4 text-zinc-900 mx-1" /> por el Futuro
              </div>
           </div>
        </div>
      </footer>
    </div>
  )
}
