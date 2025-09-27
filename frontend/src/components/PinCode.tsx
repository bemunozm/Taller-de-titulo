import { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'
import { Text } from '@/components/ui/Text'

interface PinCodeProps {
  length?: number
  value?: string[]
  onChange?: (values: string[], fullValue: string) => void
  onComplete?: (fullValue: string) => void
  disabled?: boolean
  loading?: boolean
  error?: boolean
  autoSubmit?: boolean
  autoSubmitDelay?: number
  className?: string
  inputClassName?: string
}

export default function PinCode({
  length = 6,
  value = [],
  onChange,
  onComplete,
  disabled = false,
  loading = false,
  error = false,
  autoSubmit = false,
  autoSubmitDelay = 800,
  className,
  inputClassName
}: PinCodeProps) {
  const [pinValues, setPinValues] = useState<string[]>(
    value.length > 0 ? value : Array(length).fill('')
  )
  const [isAutoSubmitting, setIsAutoSubmitting] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Sincronizar con el valor externo
  useEffect(() => {
    if (value.length > 0) {
      setPinValues(value)
    }
  }, [value])

  const handlePinChange = (index: number, inputValue: string) => {
    // Solo permitir números
    const numericValue = inputValue.replace(/[^0-9]/g, '')
    
    if (numericValue.length <= 1) {
      const newPinValues = [...pinValues]
      newPinValues[index] = numericValue
      setPinValues(newPinValues)
      
      // Notificar cambio al componente padre
      const fullValue = newPinValues.join('')
      onChange?.(newPinValues, fullValue)
      
      // Auto-avanzar al siguiente campo si hay un valor
      if (numericValue && index < length - 1) {
        inputRefs.current[index + 1]?.focus()
      }
      
      // Auto-submit cuando se completen todos los dígitos
      if (fullValue.length === length && autoSubmit && !disabled && !loading && !isAutoSubmitting) {
        setIsAutoSubmitting(true)
        setTimeout(() => {
          onComplete?.(fullValue)
          setIsAutoSubmitting(false)
        }, autoSubmitDelay)
      }
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Retroceder con Backspace
    if (e.key === 'Backspace' && !pinValues[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    
    // Pegar código completo
    if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      navigator.clipboard.readText().then(text => {
        const cleanText = text.replace(/[^0-9]/g, '').slice(0, length)
        if (cleanText.length === length) {
          const newPinValues = cleanText.split('')
          setPinValues(newPinValues)
          inputRefs.current[length - 1]?.focus()
          
          // Notificar cambio
          onChange?.(newPinValues, cleanText)
          
          // Auto-submit después de pegar
          if (autoSubmit && !disabled && !loading) {
            setIsAutoSubmitting(true)
            setTimeout(() => {
              onComplete?.(cleanText)
              setIsAutoSubmitting(false)
            }, autoSubmitDelay)
          }
        }
      })
    }
  }

  // Enfocar el primer campo al montar
  useEffect(() => {
    if (!disabled && !loading) {
      inputRefs.current[0]?.focus()
    }
  }, [disabled, loading])

  // Limpiar campos (función expuesta para uso externo)
  const clearFields = () => {
    const emptyValues = Array(length).fill('')
    setPinValues(emptyValues)
    onChange?.(emptyValues, '')
    inputRefs.current[0]?.focus()
  }

  // Exponer la función de limpiar campos
  useEffect(() => {
    if (window) {
      // @ts-ignore - Exposing for external use
      window.clearPinCode = clearFields
    }
  }, [])

  const isFieldDisabled = disabled || loading || isAutoSubmitting

  return (
    <div className={clsx("w-full", className)}>
      {/* PIN Code Inputs */}
      <div className="flex justify-center items-center gap-1 sm:gap-2">
        {pinValues.map((value, index) => (
          <div key={index} className="relative flex-shrink-0">
            <input
              ref={(el: HTMLInputElement | null) => {
                inputRefs.current[index] = el
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handlePinChange(index, e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(index, e)}
              className={clsx(
                // Tamaño ajustado para coincidir con el RegisterView
                "w-10 h-11",           // base (mobile first)
                "sm:w-11 sm:h-12",     // sm (640px+)
                
                // Texto simplificado
                "text-lg font-semibold",
                
                // Posicionamiento
                "text-center",
                
                // Colores base (siguiendo el design system)
                "bg-white dark:bg-zinc-900",
                "text-zinc-950 dark:text-white",
                "placeholder:text-zinc-500",
                
                // Bordes
                "border border-zinc-950/10 dark:border-white/10",
                "rounded-md sm:rounded-lg",
                
                // Estados hover
                "hover:border-zinc-950/20 dark:hover:border-white/20",
                
                // Estados focus
                "focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500",
                "sm:focus:ring-2",
                
                // Estados disabled
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-950/5 dark:disabled:bg-white/2.5",
                
                // Transiciones
                "transition-all duration-200",
                
                // Estados especiales
                isFieldDisabled && "opacity-50 cursor-not-allowed",
                value && "border-blue-500 bg-blue-500/5 dark:bg-blue-500/10",
                error && "border-red-500 bg-red-500/5 dark:bg-red-500/10",
                
                // Clase personalizada
                inputClassName
              )}
              aria-label={`Dígito ${index + 1} del código de ${length} dígitos`}
              disabled={isFieldDisabled}
              autoComplete="off"
              spellCheck="false"
            />
          </div>
        ))}
      </div>
      
      {/* Indicadores de progreso */}
      <div className="flex justify-center mt-4 sm:mt-6 md:mt-8">
        <div className="flex items-center gap-1 sm:gap-2">
          {pinValues.map((value, index) => (
            <div
              key={index}
              className={clsx(
                // Tamaño responsive de los indicadores
                "w-2 h-2 rounded-full transition-all duration-300",
                "sm:w-2.5 sm:h-2.5",
                "md:w-3 md:h-3",
                
                // Estados de color
                value 
                  ? "bg-blue-500 scale-110" 
                  : "bg-zinc-300 dark:bg-zinc-700",
                error && value && "bg-red-500"
              )}
            />
          ))}
        </div>
      </div>
      
      {/* Estado de carga */}
      {(loading || isAutoSubmitting) && (
        <div className="flex items-center justify-center gap-2 mt-4 sm:mt-5 md:mt-6">
          <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <Text className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400">
            {isAutoSubmitting ? 'Verificando código...' : 'Verificando código...'}
          </Text>
        </div>
      )}
    </div>
  )
}

// Export también una versión con ref si es necesaria en el futuro
export { PinCode }