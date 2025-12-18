import { MicrophoneIcon, SpeakerWaveIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { Strong } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';

export type ConversationState = 'idle' | 'listening' | 'speaking' | 'processing' | 'error';

interface ConversationStatusProps {
  state: ConversationState;
  isConnected: boolean;
}

export function ConversationStatus({ state, isConnected }: ConversationStatusProps) {
  const getStatusConfig = () => {
    switch (state) {
      case 'idle':
        return {
          icon: <MicrophoneIcon className="w-12 h-12" />,
          text: 'Esperando...',
          color: 'text-zinc-400 dark:text-zinc-500',
          bgColor: 'bg-zinc-100 dark:bg-zinc-800',
          pulseColor: '',
        };
      case 'listening':
        return {
          icon: <MicrophoneIcon className="w-12 h-12" />,
          text: 'Escuchando...',
          color: 'text-blue-600 dark:text-blue-400',
          bgColor: 'bg-blue-100 dark:bg-blue-900/30',
          pulseColor: 'animate-pulse',
        };
      case 'speaking':
        return {
          icon: <SpeakerWaveIcon className="w-12 h-12" />,
          text: 'Hablando...',
          color: 'text-green-600 dark:text-green-400',
          bgColor: 'bg-green-100 dark:bg-green-900/30',
          pulseColor: 'animate-pulse',
        };
      case 'processing':
        return {
          icon: <ArrowPathIcon className="w-12 h-12 animate-spin" />,
          text: 'Procesando...',
          color: 'text-indigo-600 dark:text-indigo-400',
          bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
          pulseColor: '',
        };
      case 'error':
        return {
          icon: <MicrophoneIcon className="w-12 h-12" />,
          text: 'Error de conexión',
          color: 'text-red-600 dark:text-red-400',
          bgColor: 'bg-red-100 dark:bg-red-900/30',
          pulseColor: '',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className="flex flex-col items-center space-y-6">
      {/* Indicador de estado */}
      <div
        className={`rounded-full p-8 ${config.bgColor} ${config.pulseColor} transition-all duration-300 shadow-lg`}
      >
        <div className={config.color}>{config.icon}</div>
      </div>

      {/* Texto de estado */}
      <div className="text-center space-y-3">
        <Strong className={`text-2xl ${config.color}`}>{config.text}</Strong>
        
        {isConnected ? (
          <Badge color="lime" className="flex items-center gap-2 mx-auto w-fit">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            Conectado
          </Badge>
        ) : (
          <Badge color="red" className="flex items-center gap-2 mx-auto w-fit">
            <span className="w-2 h-2 bg-red-500 rounded-full"></span>
            Desconectado
          </Badge>
        )}
      </div>
    </div>
  );
}
