import { UserIcon, CpuChipIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { Subheading } from '@/components/ui/Heading';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface TranscriptDisplayProps {
  messages: TranscriptMessage[];
}

export function TranscriptDisplay({ messages }: TranscriptDisplayProps) {
  if (messages.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
            <ChatBubbleLeftRightIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <Subheading>Transcripción</Subheading>
        </div>
        <Text className="text-center py-12">
          La conversación aparecerá aquí...
        </Text>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6 sticky top-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
            <ChatBubbleLeftRightIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <Subheading>Transcripción</Subheading>
        </div>
        <Badge color="zinc">{messages.length} mensajes</Badge>
      </div>

      <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
          >
            {/* Avatar del conserje (izquierda) */}
            {message.role === 'assistant' && (
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg">
                <CpuChipIcon className="w-5 h-5 text-white" />
              </div>
            )}

            {/* Burbuja de mensaje */}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-sm ${
                message.role === 'user'
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                  : 'bg-gradient-to-br from-blue-600 to-blue-700 text-white'
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
              <p
                className={`text-xs mt-2 font-mono ${
                  message.role === 'user' ? 'text-zinc-500 dark:text-zinc-400' : 'text-blue-200'
                }`}
              >
                {message.timestamp.toLocaleTimeString('es-CL', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </p>
            </div>

            {/* Avatar del usuario (derecha) */}
            {message.role === 'user' && (
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-zinc-600 to-zinc-700 dark:from-zinc-700 dark:to-zinc-800 flex items-center justify-center shadow-lg">
                <UserIcon className="w-5 h-5 text-white" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
