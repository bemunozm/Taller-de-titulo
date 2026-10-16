import { useLocation } from 'react-router-dom'
import { VisitorApprovalDialog } from '@/components/VisitorApprovalDialog'
import { UnknownVehicleApprovalDialog } from '@/components/UnknownVehicleApprovalDialog'
import { isKioskRoute } from '@/helpers/kiosk'

/**
 * Diálogos globales de aprobación (residentes y conserjes). No se montan en
 * el kiosko: es un dispositivo público frente al visitante y, aunque el
 * navegador tuviera una sesión humana abierta, ahí no se aprueba nada.
 */
export function GlobalApprovalDialogs() {
  const { pathname } = useLocation()

  if (isKioskRoute(pathname)) {
    return null
  }

  return (
    <>
      <VisitorApprovalDialog />
      <UnknownVehicleApprovalDialog />
    </>
  )
}
