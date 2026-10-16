import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { Input } from './Input'

type PhoneTextInputProps = ComponentPropsWithoutRef<typeof Input>

/**
 * `inputComponent` de `react-phone-number-input` con el estilo de `Input`.
 * Vive a nivel de módulo para que su identidad sea estable entre renders (si
 * se creara en cada render, el input se desmontaría y perdería el foco). El
 * estado de error llega como prop `invalid`, que PhoneInput reenvía.
 */
export const PhoneTextInput = forwardRef<HTMLInputElement, PhoneTextInputProps>(function PhoneTextInput(
  props,
  ref,
) {
  return <Input {...props} ref={ref} />
})
