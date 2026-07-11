import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'

export default function LandingNavbar() {
  return (
    <motion.nav 
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md bg-zinc-950/50 border-b border-white/5"
    >
      <div className="flex items-center gap-2">
        <div className="p-2 bg-indigo-600 rounded-lg shadow-[0_0_15px_rgba(79,70,229,0.5)]">
          <ShieldCheckIcon className="h-6 w-6 text-white" />
        </div>
        <span className="text-xl font-black text-white uppercase tracking-tighter">VigilIA</span>
      </div>

      <div className="hidden md:flex items-center gap-8">
        {['Características', 'Tecnología', 'Seguridad', 'SaaS'].map((item) => (
          <a 
            key={item} 
            href={`#${item.toLowerCase()}`} 
            className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 hover:text-white transition-colors"
          >
            {item}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <Link 
          to="/login"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 hover:text-white transition-colors"
        >
          Acceso
        </Link>
        <Link 
          to="/login"
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
        >
          Solicitar Demo
        </Link>
      </div>
    </motion.nav>
  )
}
