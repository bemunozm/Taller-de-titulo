import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/renderWithProviders'
import {
  AUDIT_ACTION_LABELS,
  AUDIT_MODULE_LABELS,
  AuditAction,
  AuditModule,
  getAuditActionLabel,
  type AuditLog,
} from '@/types/audit'
import { AuditLogsTable } from './AuditLogsTable'

/*
 * Contrato: `backend/src/audit/entities/audit-log.entity.ts` (enums `AuditModule` y `AuditAction`).
 * Copia a mano a propósito: el frontend no lee código del backend (se prueba y despliega solo).
 *
 * Cómo actualizar cuando el backend agrega, renombra o quita un valor:
 *   1. Copia los valores del enum a BACKEND_MODULES / BACKEND_ACTIONS (mismo texto, sin ordenar).
 *      Para listarlos: grep -oE "= '[A-Z_]+'" backend/src/audit/entities/audit-log.entity.ts
 *   2. Replica el cambio en `src/types/audit.ts` (AuditModule / AuditAction).
 *   3. Agrega su etiqueta en español en AUDIT_MODULE_LABELS / AUDIT_ACTION_LABELS (tsc lo exige:
 *      son `Record` exhaustivos) y, si corresponde, su color en `AuditLogsTable.tsx`.
 * Si este test falla, el frontend quedó desalineado: no se "arregla" editando solo esta lista.
 */
const BACKEND_MODULES = [
  'AUTH', 'USERS', 'ROLES', 'PERMISSIONS', 'FAMILIES', 'CAMERAS', 'STREAMS', 'VISITS',
  'VEHICLES', 'DETECTIONS', 'NOTIFICATIONS', 'DIGITAL_CONCIERGE', 'MEDIAMTX', 'PRIVACY',
]
const BACKEND_ACTIONS = [
  'CREATE', 'READ', 'UPDATE', 'DELETE',
  'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'ACCOUNT_CONFIRM',
  'PERMISSION_GRANT', 'PERMISSION_REVOKE', 'ROLE_ASSIGN', 'ROLE_UNASSIGN',
  'CAMERA_REGISTER', 'CAMERA_LPR_ENABLE', 'CAMERA_LPR_DISABLE', 'CAMERA_ACTIVATE', 'CAMERA_DEACTIVATE',
  'VISIT_APPROVE', 'VISIT_REJECT', 'VISIT_CHECK_IN', 'VISIT_CHECK_OUT', 'VISIT_QR_VALIDATE',
  'DETECTION_CREATED', 'DETECTION_MATCHED',
  'VEHICLE_REGISTER', 'VEHICLE_AUTHORIZE', 'VEHICLE_REVOKE',
  'FAMILY_MEMBER_ADD', 'FAMILY_MEMBER_REMOVE',
  'DATA_EXPORT', 'DATA_ERASURE', 'RETENTION_SWEEP',
]

function makeLog(overrides: Partial<AuditLog>): AuditLog {
  return {
    id: crypto.randomUUID(),
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    userId: 'u-1',
    user: { id: 'u-1', name: 'Ana Admin', email: 'ana@example.com' },
    description: 'Cambio',
    createdAt: '2026-10-09T12:00:00.000Z',
    ...overrides,
  }
}

describe('enums de auditoría alineados con el backend', () => {
  it('módulos y acciones son exactamente los del backend', () => {
    expect(Object.values(AuditModule).sort()).toEqual([...BACKEND_MODULES].sort())
    expect(Object.values(AuditAction).sort()).toEqual([...BACKEND_ACTIONS].sort())
  })

  it('cada valor tiene su etiqueta en español', () => {
    expect(Object.keys(AUDIT_MODULE_LABELS).sort()).toEqual([...BACKEND_MODULES].sort())
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual([...BACKEND_ACTIONS].sort())
    expect(AUDIT_MODULE_LABELS.PRIVACY).toBe('Privacidad')
    // Un valor desconocido (backend más nuevo) se muestra legible, sin romper.
    expect(getAuditActionLabel('SOMETHING_NEW')).toBe('SOMETHING NEW')
  })
})

describe('AuditLogsTable', () => {
  it('muestra los eventos de privacidad con etiquetas en español', () => {
    renderWithProviders(
      <AuditLogsTable
        logs={[
          makeLog({ module: AuditModule.PRIVACY, action: AuditAction.DATA_EXPORT }),
          makeLog({ module: AuditModule.PRIVACY, action: AuditAction.DATA_ERASURE }),
          makeLog({ module: AuditModule.PRIVACY, action: AuditAction.RETENTION_SWEEP, userId: null, user: null }),
        ]}
      />,
    )

    expect(screen.getAllByText('Privacidad')).toHaveLength(3)
    expect(screen.getByText('Exportación de datos personales')).toBeInTheDocument()
    expect(screen.getByText('Supresión de datos personales')).toBeInTheDocument()
    expect(screen.getByText('Limpieza por plazo de conservación')).toBeInTheDocument()
    expect(screen.getByText('Sistema')).toBeInTheDocument()
  })

  it('no muestra el email marcador de una cuenta anonimizada', () => {
    renderWithProviders(
      <AuditLogsTable
        logs={[
          makeLog({
            user: { id: 'u-9', name: 'Usuario eliminado', email: 'deleted+u-9@vigilia.invalid' },
          }),
        ]}
      />,
    )

    expect(screen.getByText('Usuario eliminado')).toBeInTheDocument()
    expect(screen.queryByText(/vigilia\.invalid/)).not.toBeInTheDocument()
  })

  it('los filtros ofrecen el módulo y las acciones de privacidad', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AuditLogsTable logs={[makeLog({})]} />)

    await user.click(screen.getByRole('button', { name: 'Filtros' }))

    const [moduleSelect, actionSelect] = screen.getAllByRole('combobox')
    expect(within(moduleSelect).getByRole('option', { name: 'Privacidad' })).toHaveValue('PRIVACY')
    for (const action of ['DATA_EXPORT', 'DATA_ERASURE', 'RETENTION_SWEEP'] as const) {
      expect(within(actionSelect).getByRole('option', { name: AUDIT_ACTION_LABELS[action] })).toHaveValue(action)
    }
    // Ya no se ofrecen acciones que el backend no registra.
    expect(within(actionSelect).queryByRole('option', { name: /CHECK IN|ENABLE|SYNC/ })).not.toBeInTheDocument()
  })
})
