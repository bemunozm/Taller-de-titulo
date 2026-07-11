import { motion } from 'motion/react'
import { ChevronRightIcon } from '@heroicons/react/24/outline'

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col pt-32 pb-20 overflow-hidden bg-zinc-950">
      {/* Decorative Elements */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-indigo-600/5 blur-[120px] -rotate-12 translate-x-1/4" />
      <div className="absolute top-1/2 left-0 w-1/3 h-1/2 bg-emerald-500/5 blur-[100px] -translate-x-1/2" />
      
      {/* Noise overlay */}
      <div className="absolute inset-0 noise-bg z-0 opacity-[0.03]" />

      <div className="container mx-auto px-6 relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-8">
          
          {/* Text Content */}
          <div className="flex-1 text-left">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 mb-8"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em]">Next-Gen Security SaaS</span>
            </motion.div>

            <motion.h1 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-6xl md:text-8xl lg:text-9xl font-black text-white mb-8 tracking-tighter leading-[0.85] uppercase"
            >
              SEGURIDAD <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-400">DEFINITIVA.</span>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="max-w-xl text-lg md:text-xl text-zinc-500 mb-12 font-medium leading-relaxed"
            >
              VigilIA combina visión computacional de grado militar con una experiencia de hospitalidad digital sin precedentes. La primera suite de seguridad que realmente piensa.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-6"
            >
              <button className="px-10 py-5 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-[0.2em] text-[10px] rounded-full transition-all shadow-[0_20px_40px_-10px_rgba(79,70,229,0.3)] active:scale-95">
                Solicitar Acceso Beta
              </button>
              <button className="group flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 hover:text-white transition-colors">
                Explorar Ecosistema 
                <ChevronRightIcon className="h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
            
            {/* Trust Badges */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              transition={{ delay: 0.5 }}
              className="mt-20 flex items-center gap-8 grayscale"
            >
               <span className="text-xs font-black text-white uppercase tracking-widest opacity-50 italic">Proudly Local.</span>
               <div className="h-px w-12 bg-zinc-800" />
               <span className="text-xs font-black text-white uppercase tracking-widest opacity-50">99.9% Up-time</span>
            </motion.div>
          </div>

          {/* Visual Content - Floating Mockup */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, rotate: 2 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 100, delay: 0.4 }}
            className="flex-1 relative w-full lg:w-auto"
          >
            <div className="relative z-10 p-4 bg-zinc-900/50 rounded-[60px] border border-white/10 backdrop-blur-3xl shadow-2xl overflow-hidden group">
               <div className="absolute inset-0 noise-bg opacity-[0.05] pointer-events-none" />
               <img 
                 src="/vigilia_mockup.png" 
                 alt="VigilIA Dashboard" 
                 className="w-full h-auto rounded-[48px] shadow-2xl transition-transform duration-700 group-hover:scale-[1.02]"
               />
               
               {/* Floating Info Tag */}
               <motion.div 
                 animate={{ y: [0, -10, 0] }}
                 transition={{ repeat: Infinity, duration: 4 }}
                 className="absolute -bottom-6 -left-6 p-6 bg-white rounded-3xl shadow-2xl flex items-center gap-4 z-20 border border-zinc-200"
               >
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <div className="text-left">
                    <p className="text-black font-black text-xs uppercase tracking-tighter">Amenaza Neutralizada</p>
                    <p className="text-zinc-500 text-[10px] font-bold">Respuesta en 0.4s</p>
                  </div>
               </motion.div>
            </div>

            {/* Background Glow */}
            <div className="absolute -inset-4 bg-indigo-500/20 rounded-[80px] blur-3xl -z-10 group-hover:bg-indigo-500/30 transition-colors" />
          </motion.div>

        </div>
      </div>
    </section>
  )
}
