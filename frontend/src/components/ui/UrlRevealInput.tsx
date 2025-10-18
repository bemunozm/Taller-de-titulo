import { Input } from './Input'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/16/solid'

interface UrlRevealInputProps {
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
  onReveal?: () => void
  loading?: boolean
  revealed?: boolean
}

export default function UrlRevealInput({
  name,
  placeholder = 'URL RTSP',
  value,
  onChange,
  onBlur,
  error = false,
  disabled = false,
  required = false,
  id,
  className = '',
  onReveal,
  loading = false,
  revealed = false,
}: UrlRevealInputProps) {
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type="text"
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
        onClick={onReveal}
        className="absolute inset-y-0 right-0 flex items-center pr-2.5 sm:pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 focus:outline-none transition-colors"
        tabIndex={-1}
        aria-label={loading ? 'Cargando URL' : (revealed ? 'Ocultar URL' : 'Mostrar URL')}
        disabled={loading}
      >
        {/** show Eye when hidden, EyeSlash when revealed */}
        {/** caller should pass revealed state by setting value to real URL and managing state; we also accept revealed prop */}
        {revealed ? (
          <EyeSlashIcon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
        ) : (
          <EyeIcon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
