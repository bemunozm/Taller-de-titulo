import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import type { AppNotification } from '@/types/index'
import { PENDING_ALREADY_RESPONDED_MESSAGE } from '@/api/PendingDetectionsAPI'
import { renderWithProviders } from '@/test/renderWithProviders'
import { UnknownVehicleApprovalDialog } from './UnknownVehicleApprovalDialog'

// API real de detecciones pendientes sobre un axios simulado.
const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const notificationsState = vi.hoisted(() => ({
  notifications: [] as AppNotification[],
  markAsRead: vi.fn(),
}))
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: notificationsState.notifications,
    markAsRead: notificationsState.markAsRead,
  }),
}))

function httpError(status: number, data: unknown): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111'
const NOTIFICATION_ID = 'notif-1'

function unknownVehicleNotification(): AppNotification {
  return {
    id: NOTIFICATION_ID,
    read: false,
    receivedAt: new Date(),
    payload: {
      title: 'Vehículo no reconocido',
      message: 'Patente ABCD12',
      type: 'UNKNOWN_VEHICLE',
      timestamp: new Date(),
      data: {
        requiresAction: true,
        attemptId: ATTEMPT_ID,
        detectionId: 'det-1',
        plate: 'ABCD12',
        reason: 'Patente sin registro',
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  notificationsState.notifications = [unknownVehicleNotification()]
  apiMock.get.mockResolvedValue({ data: { active: true } })
})

describe('UnknownVehicleApprovalDialog: detección ya respondida (409)', () => {
  it('muestra el motivo, deshabilita las acciones, marca la notificación y refresca las detecciones', async () => {
    apiMock.patch.mockRejectedValueOnce(httpError(409, { message: 'Conflict' }))
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(<UnknownVehicleApprovalDialog />)
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const approve = await screen.findByRole('button', { name: 'Aprobar Acceso' })
    await waitFor(() => expect(approve).toBeEnabled())
    await user.click(approve)

    expect((await screen.findAllByText(PENDING_ALREADY_RESPONDED_MESSAGE)).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aprobar Acceso' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Rechazar Acceso' })).toBeDisabled()
    expect(notificationsState.markAsRead).toHaveBeenCalledWith(NOTIFICATION_ID)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['detections'] })
  })

  it('otro error (vencida, 400) se muestra pero no marca la notificación', async () => {
    apiMock.patch.mockRejectedValueOnce(httpError(400, { message: 'La detección expiró' }))
    const user = userEvent.setup()
    renderWithProviders(<UnknownVehicleApprovalDialog />)

    const reject = await screen.findByRole('button', { name: 'Rechazar Acceso' })
    await waitFor(() => expect(reject).toBeEnabled())
    await user.click(reject)

    expect(await screen.findByText('La detección expiró')).toBeInTheDocument()
    expect(notificationsState.markAsRead).not.toHaveBeenCalled()
  })
})
