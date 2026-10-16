import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
        alias: {
          // Se define un alias para el directorio src
          // Esto permite importar archivos desde src sin necesidad de especificar la ruta completa
          // Ejemplo: import {DashboardView} from '@/views/DashboardView'
          '@': fileURLToPath(new URL('./src', import.meta.url))
        }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Sin procesar CSS en los tests, salvo el texto crudo de index.css: un test
    // de la política verifica qué fuentes externas carga (P7.F).
    css: { include: [/index\.css\?raw$/] },
    restoreMocks: true,
  },
})
