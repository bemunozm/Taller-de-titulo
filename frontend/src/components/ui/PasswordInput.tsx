import { Input } from './Input'
import { useState } from 'react'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/16/solid'

interface PasswordInputProps {
  name: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: boolean
  disabled?: boolean
  required?: boolean
  id?: string
  className?: string
}

export function PasswordInput({
  name,
  placeholder = "Ingresa tu contraseña",
  value,
  onChange,
  onBlur,
  error = false,
  disabled = false,
  required = false,
  id,
  className = ""
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword)
  }

  return (
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
        className={`pr-9 sm:pr-10 text-sm sm:text-base ${className}`}
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
  )
}