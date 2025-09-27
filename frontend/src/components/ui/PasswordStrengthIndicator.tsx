import { Text } from './Text'
import { Input } from './Input'
import { useState } from 'react'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/16/solid'

interface PasswordRequirement {
  label: string
  met: boolean
  test: (password: string) => boolean
}

interface PasswordStrengthIndicatorProps {
  password: string
  showStrengthBar?: boolean
  showRequirementsList?: boolean
  className?: string
}

interface PasswordInputWithStrengthProps extends PasswordStrengthIndicatorProps {
  name: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: boolean
  disabled?: boolean
  required?: boolean
  id?: string
}

export function PasswordStrengthIndicator({ 
  password, 
  showStrengthBar = true, 
  showRequirementsList = true,
  className = ""
}: PasswordStrengthIndicatorProps) {
  const requirements: PasswordRequirement[] = [
    { 
      label: 'Mínimo 8 caracteres', 
      met: password.length >= 8,
      test: (pwd: string) => pwd.length >= 8
    },
    { 
      label: 'Una letra mayúscula (A-Z)', 
      met: /[A-Z]/.test(password),
      test: (pwd: string) => /[A-Z]/.test(pwd)
    },
    { 
      label: 'Una letra minúscula (a-z)', 
      met: /[a-z]/.test(password),
      test: (pwd: string) => /[a-z]/.test(pwd)
    },
    { 
      label: 'Un número (0-9)', 
      met: /\d/.test(password),
      test: (pwd: string) => /\d/.test(pwd)
    },
    { 
      label: 'Un carácter especial (!@#$%^&*)', 
      met: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(password),
      test: (pwd: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(pwd)
    },
    { 
      label: 'Sin espacios en blanco', 
      met: password.length > 0 ? !/\s/.test(password) : false,
      test: (pwd: string) => pwd.length > 0 ? !/\s/.test(pwd) : false
    }
  ]

  const metCount = requirements.filter(req => req.met).length
  const totalCount = requirements.length
  const strengthPercentage = (metCount / totalCount) * 100
  
  let strengthLevel = 'Muy débil'
  let strengthColor = 'bg-red-500'
  let strengthTextColor = 'text-red-600 dark:text-red-400'
  
  if (strengthPercentage >= 83) { // 5-6 requisitos
    strengthLevel = 'Fuerte'
    strengthColor = 'bg-green-500'
    strengthTextColor = 'text-green-600 dark:text-green-400'
  } else if (strengthPercentage >= 66) { // 4 requisitos
    strengthLevel = 'Buena'
    strengthColor = 'bg-yellow-500'
    strengthTextColor = 'text-yellow-600 dark:text-yellow-400'
  } else if (strengthPercentage >= 33) { // 2-3 requisitos
    strengthLevel = 'Débil'
    strengthColor = 'bg-orange-500'
    strengthTextColor = 'text-orange-600 dark:text-orange-400'
  }

  // No mostrar nada si no hay contraseña
  if (password.length === 0) {
    return null
  }

  return (
    <div className={`space-y-1.5 sm:space-y-2 ${className}`}>
      {/* Barra de fortaleza */}
      {showStrengthBar && (
        <div className="space-y-1 sm:space-y-1.5">
          <div className="flex justify-between items-center">
            <Text className="text-xs sm:text-xs text-zinc-600 dark:text-zinc-400">
              Fortaleza de la contraseña
            </Text>
            <Text className={`text-xs sm:text-xs font-medium ${strengthTextColor}`}>
              {strengthLevel}
            </Text>
          </div>
          <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5 sm:h-2">
            <div 
              className={`h-1.5 sm:h-2 rounded-full transition-all duration-300 ${strengthColor}`}
              style={{ width: `${strengthPercentage}%` }}
            />
          </div>
        </div>
      )}
      
      {/* Lista de requisitos */}
      {showRequirementsList && (
        <div className="space-y-1 sm:space-y-1.5">
          <Text className="text-xs sm:text-xs text-zinc-600 dark:text-zinc-400 font-medium">
            Requisitos de la contraseña:
          </Text>
          <div className="space-y-0.5 sm:space-y-1">
            {requirements.map((req, index) => (
              <div key={index} className="flex items-center gap-1.5 sm:gap-2">
                <span className={`text-xs sm:text-xs flex-shrink-0 ${req.met ? 'text-green-600 dark:text-green-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
                  {req.met ? '✓' : '○'}
                </span>
                <Text className={`text-xs sm:text-xs leading-tight ${req.met ? 'text-green-600 dark:text-green-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  {req.label}
                </Text>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Hook personalizado para obtener la validación de la contraseña
export function usePasswordStrength(password: string) {
  const requirements = [
    { 
      key: 'minLength',
      label: 'Mínimo 8 caracteres', 
      met: password.length >= 8,
      test: (pwd: string) => pwd.length >= 8
    },
    { 
      key: 'uppercase',
      label: 'Una letra mayúscula (A-Z)', 
      met: /[A-Z]/.test(password),
      test: (pwd: string) => /[A-Z]/.test(pwd)
    },
    { 
      key: 'lowercase',
      label: 'Una letra minúscula (a-z)', 
      met: /[a-z]/.test(password),
      test: (pwd: string) => /[a-z]/.test(pwd)
    },
    { 
      key: 'number',
      label: 'Un número (0-9)', 
      met: /\d/.test(password),
      test: (pwd: string) => /\d/.test(pwd)
    },
    { 
      key: 'special',
      label: 'Un carácter especial (!@#$%^&*)', 
      met: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(password),
      test: (pwd: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(pwd)
    },
    { 
      key: 'noSpaces',
      label: 'Sin espacios en blanco', 
      met: password.length > 0 ? !/\s/.test(password) : false,
      test: (pwd: string) => pwd.length > 0 ? !/\s/.test(pwd) : false
    }
  ]

  const metCount = requirements.filter(req => req.met).length
  const totalCount = requirements.length
  const strengthPercentage = (metCount / totalCount) * 100
  const isValid = metCount === totalCount

  let strengthLevel: 'Muy débil' | 'Débil' | 'Buena' | 'Fuerte' = 'Muy débil'
  
  if (strengthPercentage >= 83) { // 5-6 requisitos
    strengthLevel = 'Fuerte'
  } else if (strengthPercentage >= 66) { // 4 requisitos
    strengthLevel = 'Buena'
  } else if (strengthPercentage >= 33) { // 2-3 requisitos
    strengthLevel = 'Débil'
  }

  return {
    requirements,
    metCount,
    totalCount,
    strengthPercentage,
    strengthLevel,
    isValid
  }
}

// Componente de Input de contraseña con indicador de fortaleza
export function PasswordInputWithStrength({
  name,
  placeholder = "Ingresa tu contraseña",
  value,
  onChange,
  onBlur,
  error = false,
  disabled = false,
  required = false,
  id,
  showStrengthBar = true,
  showRequirementsList = true,
  className = ""
}: PasswordInputWithStrengthProps) {
  const [showPassword, setShowPassword] = useState(false)

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword)
  }

  return (
    <div className="space-y-1.5 sm:space-y-2">
      {/* Input de contraseña con icono de ojo */}
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={showPassword ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          invalid={error}
          disabled={disabled}
          required={required}
          className="pr-9 sm:pr-10 text-sm sm:text-base"
        />
        <button
          type="button"
          onClick={togglePasswordVisibility}
          className="absolute inset-y-0 right-0 flex items-center pr-2.5 sm:pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 focus:outline-none transition-colors"
          tabIndex={-1}
          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {showPassword ? (
            <EyeSlashIcon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
          ) : (
            <EyeIcon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Indicador de fortaleza */}
      <PasswordStrengthIndicator
        password={value}
        showStrengthBar={showStrengthBar}
        showRequirementsList={showRequirementsList}
        className={className}
      />
    </div>
  )
}