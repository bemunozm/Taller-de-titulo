import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listCondominiums } from '@/api/OnboardingAPI'
import { Description, Field, Label } from '@/components/ui/Fieldset'
import { Select } from '@/components/ui/Select'

const CONDOMINIUMS_QUERY_KEY = ['condominiums'] as const

type SelectProps = Omit<ComponentPropsWithoutRef<typeof Select>, 'children' | 'invalid'>

interface CondominiumSelectProps extends SelectProps {
  /** Por defecto "Condominio *" (obligatorio para el super-admin al crear). */
  label?: string
  description?: ReactNode
  /** Error de validación del formulario (p.ej. "Selecciona el condominio"). */
  errorMessage?: string
}

/**
 * Selector de condominio del super-admin (`GET /onboarding/condominiums`,
 * ordenado por nombre). Se registra como un <select> más
 * (`{...register('organizationId')}`); el formulario decide si mostrarlo con
 * `useCondominiumScope` — nunca para otro actor ni al editar.
 */
export const CondominiumSelect = forwardRef<HTMLSelectElement, CondominiumSelectProps>(function CondominiumSelect(
  { label = 'Condominio *', description, errorMessage, disabled, ...selectProps },
  ref,
) {
  const { data: condominiums = [], isLoading, isError } = useQuery({
    queryKey: CONDOMINIUMS_QUERY_KEY,
    queryFn: listCondominiums,
    staleTime: 5 * 60_000,
  })

  return (
    <Field>
      <Label>{label}</Label>
      <Select ref={ref} {...selectProps} disabled={disabled || isLoading} invalid={!!errorMessage}>
        <option value="">{isLoading ? 'Cargando condominios...' : 'Selecciona un condominio'}</option>
        {condominiums.map((condominium) => (
          <option key={condominium.id} value={condominium.id}>
            {condominium.name}
          </option>
        ))}
      </Select>
      {description ? <Description>{description}</Description> : null}
      {isError ? (
        <p role="alert" className="text-sm text-red-600 mt-1">
          No se pudieron cargar los condominios. Intenta de nuevo más tarde.
        </p>
      ) : null}
      {errorMessage ? <p className="text-sm text-red-600 mt-1">{errorMessage}</p> : null}
    </Field>
  )
})
