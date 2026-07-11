import { motion } from 'motion/react'

export default function DashboardMockup() {
  return (
    <section className="py-32 bg-zinc-950 px-6">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <motion.h2 
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase"
          >
            PRECISIÓN <span className="text-zinc-600">Visual</span> SIN PRECEDENTES
          </motion.h2>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative max-w-6xl mx-auto rounded-[60px] border border-white/10 bg-zinc-900/50 p-4 md:p-8 backdrop-blur-3xl shadow-2xl group overflow-hidden"
        >
          {/* Noise effect layer */}
          <div className="absolute inset-0 noise-bg z-0" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-8 px-4">
               <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/50" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                  <div className="w-3 h-3 rounded-full bg-indigo-500/50" />
               </div>
               <div className="h-px flex-1 bg-white/5 mx-4" />
               <div className="text-[10px] font-mono text-zinc-600 tracking-widest uppercase">VigilIA_CORE_v2.0_INTERFACE</div>
            </div>

            <div className="grid grid-cols-12 gap-6">
              {/* Sidebar Mockup */}
              <div className="hidden md:block col-span-2 space-y-6">
                 {[1,2,3,4,5].map(i => (
                   <div key={i} className="h-10 w-full bg-white/[0.03] rounded-2xl border border-white/5 animate-pulse" />
                 ))}
              </div>

              {/* Main Content Mockup */}
              <div className="col-span-12 md:col-span-10 space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Camera Feed 1 */}
                    <div className="aspect-video relative rounded-[40px] border border-white/5 bg-black overflow-hidden group/card shadow-2xl">
                       <div className="absolute top-6 left-6 z-20 flex items-center gap-2 px-3 py-1 bg-indigo-600 rounded-full text-[8px] font-black text-white uppercase tracking-widest animate-pulse">
                          LIVE ENGINE
                       </div>
                       <div className="absolute inset-0 bg-indigo-500/5 animate-pulse" />
                       <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-32 h-32 border border-indigo-500/20 rounded-full rotate-45 border-dashed" />
                          <div className="absolute inset-0 p-12 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent" />
                          <div className="relative z-10 w-1/2 h-1/2 border-2 border-indigo-400/40 rounded-3xl" />
                       </div>
                    </div>
                    {/* Analytics Card */}
                    <div className="p-8 rounded-[40px] border border-white/5 bg-zinc-900/80 shadow-inner flex flex-col justify-between">
                       <div>
                          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Visitor Analytics</p>
                          <h4 className="text-2xl font-black text-white tracking-tighter">+420% Accuracy</h4>
                       </div>
                       <div className="flex items-end gap-1 h-32 mt-8">
                          {[40, 60, 45, 80, 55, 90, 70].map((h, i) => (
                            <motion.div 
                              key={i}
                              initial={{ height: 0 }}
                              whileInView={{ height: `${h}%` }}
                              className="flex-1 bg-gradient-to-t from-indigo-600/30 to-indigo-500 rounded-lg"
                            />
                          ))}
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
