import { useState, type FormEvent } from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { Field, Label } from '@/components/ui/Fieldset'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { kioskCredentialStore, type KioskCredential } from '@/services/kioskCredentialStore'

interface KioskUnpairPanelProps {
  credential: KioskCredential
  onCancel: () => void
}

/**
 * Confirmación de operador para desemparejar el kiosko: exige reingresar el
 * secret actual (se compara con el guardado). Sin el secret, un visitante no
 * puede dejar el kiosko fuera de servicio.
 */
export function KioskUnpairPanel({ credential, onCancel }: KioskUnpairPanelProps) {
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (secret.trim() !== credential.hubSecret) {
      setSecret('')
      setError('El secreto no coincide. El kiosko sigue emparejado.')
      return
    }

    kioskCredentialStore.clear('unpaired')
  }

  return (
    <section
      aria-labelledby="kiosk-unpair-title"
      className="mt-6 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10"
    >
      <h2 id="kiosk-unpair-title" className="text-base font-semibold text-zinc-950 dark:text-white">
        Desemparejar este kiosko
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        El kiosko dejará de atender visitas hasta que se vuelva a emparejar. Confirma con el secreto actual del
        dispositivo.
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
        <Field>
          <Label>Secreto actual del dispositivo</Label>
          <Input
            name="currentHubSecret"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono"
            autoFocus
          />
        </Field>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
          >
            <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button plain onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" color="red" disabled={secret.trim() === ''}>
            Desemparejar
          </Button>
        </div>
      </form>
    </section>
  )
}
