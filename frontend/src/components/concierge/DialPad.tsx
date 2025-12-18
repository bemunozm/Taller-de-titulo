import { useState } from 'react';
import { BackspaceIcon, HashtagIcon, PhoneIcon } from '@heroicons/react/24/outline';
import { Heading } from '@/components/ui/Heading';
import { Text } from '@/components/ui/Text';

interface DialPadProps {
  onCall: (houseNumber: string) => void;
  disabled?: boolean;
}

/**
 * Componente de teclado numérico tipo citófono
 * Permite ingresar el número de casa antes de iniciar la llamada
 */
export function DialPad({ onCall, disabled = false }: DialPadProps) {
  const [input, setInput] = useState('');

  const handleNumberClick = (num: string) => {
    setInput((prev) => prev + num);
  };

  const handleDelete = () => {
    setInput((prev) => prev.slice(0, -1));
  };

  const handleCall = () => {
    if (input.trim()) {
      onCall(input.trim());
    }
  };

  const buttons = [
    { value: '1', display: '1', type: 'number' as const },
    { value: '2', display: '2', type: 'number' as const },
    { value: '3', display: '3', type: 'number' as const },
    { value: '4', display: '4', type: 'number' as const },
    { value: '5', display: '5', type: 'number' as const },
    { value: '6', display: '6', type: 'number' as const },
    { value: '7', display: '7', type: 'number' as const },
    { value: '8', display: '8', type: 'number' as const },
    { value: '9', display: '9', type: 'number' as const },
    { value: 'clear', display: 'C', type: 'action' as const },
    { value: '0', display: '0', type: 'number' as const },
    { value: 'call', display: <PhoneIcon className="w-6 h-6" />, type: 'action' as const },
  ];

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="flex justify-center mb-4">
          <div className="p-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg">
            <HashtagIcon className="w-10 h-10 text-white" />
          </div>
        </div>
        <Heading level={2} className="mb-2">
          Marcar Casa/Departamento
        </Heading>
        <Text>
          Ingresa el número o código de la casa que deseas visitar
        </Text>
      </div>

      {/* Display */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 mb-6 border border-zinc-200 dark:border-zinc-800">
        <div className="relative">
          <input
            type="text"
            value={input}
            readOnly
            placeholder="Ej: 15"
            className="w-full text-center text-4xl font-mono font-bold text-zinc-950 dark:text-white bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 rounded-xl py-5 px-6 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
          />
          {input && (
            <button
              onClick={handleDelete}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-all"
              aria-label="Borrar último carácter"
            >
              <BackspaceIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Indicador de formato */}
        <div className="mt-4 text-center">
          <Text className="text-xs">
            Ingresa el número de la casa o departamento
          </Text>
        </div>
      </div>

      {/* Teclado Numérico */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-4 mb-3 border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-3 gap-3">
          {buttons.map((btn) => {
            const isNumber = btn.type === 'number';
            const isClear = btn.value === 'clear';
            const isCall = btn.value === 'call';
            
            const handleClick = () => {
              if (isClear) {
                handleDelete();
              } else if (isCall) {
                handleCall();
              } else {
                handleNumberClick(btn.value);
              }
            };

            // Estilos base para números
            let buttonClass = "aspect-square bg-gradient-to-br active:scale-95 border rounded-xl font-bold shadow-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100";
            
            if (isNumber) {
              buttonClass += " from-zinc-50 to-zinc-100 dark:from-zinc-800 dark:to-zinc-700 hover:from-zinc-100 hover:to-zinc-200 dark:hover:from-zinc-700 dark:hover:to-zinc-600 border-zinc-200 dark:border-zinc-600 text-2xl text-zinc-900 dark:text-white";
            } else if (isClear) {
              buttonClass += " from-red-50 to-red-100 dark:from-red-900/30 dark:to-red-800/30 hover:from-red-100 hover:to-red-200 dark:hover:from-red-800/40 dark:hover:to-red-700/40 border-red-200 dark:border-red-700 text-xl text-red-700 dark:text-red-300";
            } else if (isCall) {
              buttonClass += " from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/30 hover:from-green-100 hover:to-green-200 dark:hover:from-green-800/40 dark:hover:to-green-700/40 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300";
            }

            return (
              <button
                key={btn.value}
                onClick={handleClick}
                disabled={disabled || (isCall && !input.trim())}
                className={`${buttonClass} ${isCall ? 'flex items-center justify-center' : ''}`}
                aria-label={isClear ? 'Borrar' : isCall ? 'Llamar' : `Número ${btn.value}`}
              >
                {btn.display}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
