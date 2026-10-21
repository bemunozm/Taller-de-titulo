import { Button } from '@/components/ui/Button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/Dialog'
import { PRIVACY_POLICY_EFFECTIVE_DATE_LABEL, PRIVACY_POLICY_VERSION } from '@/helpers/privacyPolicy'
import { PrivacyPolicyContent } from './PrivacyPolicyContent'

interface PrivacyPolicyDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * La política completa sin salir de la pantalla: para el kiosko, donde
 * navegar a otra ruta dejaría al visitante fuera del citófono.
 */
export function PrivacyPolicyDialog({ open, onClose }: PrivacyPolicyDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} size="4xl">
      <DialogTitle>Aviso de privacidad</DialogTitle>
      <DialogDescription>
        Versión {PRIVACY_POLICY_VERSION}, vigente desde el {PRIVACY_POLICY_EFFECTIVE_DATE_LABEL}.
      </DialogDescription>
      <DialogBody>
        <PrivacyPolicyContent embedded />
      </DialogBody>
      <DialogActions>
        <Button color="indigo" onClick={onClose} className="min-h-12 min-w-32 items-center!">
          Cerrar
        </Button>
      </DialogActions>
    </Dialog>
  )
}
