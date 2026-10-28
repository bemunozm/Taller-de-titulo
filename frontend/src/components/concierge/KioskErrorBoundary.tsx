import { Component, type ReactNode } from 'react'
import { KioskCrashScreen } from '@/components/concierge/KioskCrashScreen'

function reloadPage(): void {
  window.location.reload()
}

interface KioskErrorBoundaryProps {
  children: ReactNode
  /** Recarga de la página; se inyecta en los tests. */
  onReload?: () => void
}

interface KioskErrorBoundaryState {
  hasError: boolean
}

/**
 * Último recurso del kiosko: si un componente lanza al renderizar, nadie va a
 * tocar el equipo para arreglarlo. Muestra una pantalla propia y recarga la
 * página a los 10 s (al volver, el kiosko arranca limpio en el inicio).
 *
 * Sin registro en consola (dispositivo público: el error podría arrastrar
 * datos de la sesión). Los errores en eventos y promesas no llegan aquí; esos
 * los cubren el vigía y la conectividad de la vista.
 */
export class KioskErrorBoundary extends Component<KioskErrorBoundaryProps, KioskErrorBoundaryState> {
  state: KioskErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): KioskErrorBoundaryState {
    return { hasError: true }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <KioskCrashScreen onReload={this.props.onReload ?? reloadPage} />
    }
    return this.props.children
  }
}
