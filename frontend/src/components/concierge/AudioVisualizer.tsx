import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  state?: 'listening' | 'speaking' | 'idle';
}

export function AudioVisualizer({ isActive, state = 'idle' }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);
  const amplitudesRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const bars = 60; // Más barras para una visualización más suave
    const barWidth = width / bars;

    // Detectar si estamos en dark mode
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Colores según el estado
    const colors = {
      listening: {
        primary: '#3B82F6',    // Blue-600
        secondary: '#60A5FA',   // Blue-400
        bg: isDarkMode ? '#18181B' : '#DBEAFE'  // Zinc-900 dark / Blue-100 light
      },
      speaking: {
        primary: '#10B981',    // Green-600
        secondary: '#34D399',   // Green-400
        bg: isDarkMode ? '#18181B' : '#D1FAE5'  // Zinc-900 dark / Green-100 light
      },
      idle: {
        primary: '#71717A',    // Zinc-500
        secondary: '#A1A1AA',   // Zinc-400
        bg: isDarkMode ? '#18181B' : '#F4F4F5'  // Zinc-900 dark / Zinc-100 light
      }
    };

    const currentColors = colors[state];

    // Inicializar amplitudes si es necesario
    if (amplitudesRef.current.length !== bars) {
      amplitudesRef.current = Array(bars).fill(0.1);
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Fondo sutil
      ctx.fillStyle = currentColors.bg;
      ctx.fillRect(0, 0, width, height);

      timeRef.current += 0.05;

      if (!isActive) {
        // Animación de latido suave cuando está inactivo
        for (let i = 0; i < bars; i++) {
          const targetAmplitude = 0.05 + Math.sin(timeRef.current * 2) * 0.02;
          amplitudesRef.current[i] += (targetAmplitude - amplitudesRef.current[i]) * 0.1;

          const barHeight = amplitudesRef.current[i] * height;
          const x = i * barWidth;
          const y = (height - barHeight) / 2;

          ctx.fillStyle = currentColors.secondary + '40'; // 25% opacity
          ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
        }
      } else {
        // Visualización activa basada en ondas
        for (let i = 0; i < bars; i++) {
          const normalizedPosition = i / bars;
          
          let targetAmplitude;
          if (state === 'listening') {
            // Patrón de onda para escuchar (de afuera hacia adentro)
            const wave1 = Math.sin((normalizedPosition * Math.PI * 4) + timeRef.current * 3) * 0.3;
            const wave2 = Math.sin((normalizedPosition * Math.PI * 2) - timeRef.current * 2) * 0.2;
            targetAmplitude = 0.2 + Math.abs(wave1 + wave2);
          } else {
            // Patrón de onda para hablar (más errático y energético)
            const wave1 = Math.sin((normalizedPosition * Math.PI * 6) + timeRef.current * 4) * 0.25;
            const wave2 = Math.cos((normalizedPosition * Math.PI * 3) - timeRef.current * 3) * 0.2;
            const random = (Math.random() - 0.5) * 0.15;
            targetAmplitude = 0.3 + Math.abs(wave1 + wave2) + random;
          }

          // Suavizar transiciones
          amplitudesRef.current[i] += (targetAmplitude - amplitudesRef.current[i]) * 0.15;

          const barHeight = amplitudesRef.current[i] * height * 0.8;
          const x = i * barWidth;
          const y = (height - barHeight) / 2;

          // Gradiente dinámico
          const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
          gradient.addColorStop(0, currentColors.secondary + '60');
          gradient.addColorStop(0.5, currentColors.primary);
          gradient.addColorStop(1, currentColors.secondary + '60');

          ctx.fillStyle = gradient;
          
          // Barras redondeadas
          const radius = Math.min(barWidth / 2, 2);
          ctx.beginPath();
          ctx.roundRect(x + 1, y, barWidth - 2, barHeight, radius);
          ctx.fill();

          // Efecto de brillo en las barras más altas
          if (amplitudesRef.current[i] > 0.5) {
            ctx.fillStyle = currentColors.secondary + '30';
            ctx.beginPath();
            ctx.roundRect(x + 1, y, barWidth - 2, barHeight * 0.3, radius);
            ctx.fill();
          }
        }
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, state]);

  // Texto indicativo del estado
  const getStatusText = () => {
    if (!isActive) return 'En espera';
    if (state === 'listening') return 'Escuchando tu voz...';
    if (state === 'speaking') return 'El conserje está hablando...';
    return '';
  };

  const getStatusColor = () => {
    if (!isActive) return 'text-zinc-500 dark:text-zinc-400';
    if (state === 'listening') return 'text-blue-600 dark:text-blue-400';
    if (state === 'speaking') return 'text-green-600 dark:text-green-400';
    return 'text-zinc-500';
  };

  return (
    <div className="w-full">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-inner border border-zinc-200 dark:border-zinc-800 p-4 overflow-hidden">
        <canvas
          ref={canvasRef}
          width={1200}
          height={100}
          className="w-full h-[100px]"
        />
      </div>
      <div className="text-center mt-3">
        <p className={`text-sm font-medium transition-colors ${getStatusColor()}`}>
          {getStatusText()}
        </p>
      </div>
    </div>
  );
}
