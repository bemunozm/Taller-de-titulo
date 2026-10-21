import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { z } from 'zod'
import { renderWithProviders } from '@/test/renderWithProviders'
import { dashboardSummarySchema, type DashboardSummary } from '@/types/dashboard'
import DashboardView from './DashboardView'

type RawDashboardSummary = z.input<typeof dashboardSummarySchema>

const dashboardApi = vi.hoisted(() => ({
  getSummary: vi.fn<() => Promise<DashboardSummary>>(),
  getVisitsTrend: vi.fn(async () => []),
  getRecentActivity: vi.fn(async () => []),
  getLatestDetections: vi.fn(async () => []),
}))
vi.mock('@/api/DashboardAPI', () => ({ default: dashboardApi }))

// Paneles ajenos a este test (gráficos con recharts, tablas): fuera.
vi.mock('@/components/dashboard/VisitsTrendChart', () => ({ VisitsTrendChart: () => null }))
vi.mock('@/components/dashboard/SystemHealthPanel', () => ({ SystemHealthPanel: () => null }))
vi.mock('@/components/dashboard/RecentActivityFeed', () => ({ RecentActivityFeed: () => null }))
vi.mock('@/components/dashboard/DetectionsTable', () => ({ DetectionsTable: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
})

function makeRawSummary(security: Partial<RawDashboardSummary['security']> = {}): RawDashboardSummary {
  return {
    security: {
      detectionsToday: 0,
      detectionsWeek: 0,
      detectionsMonth: 0,
      activeVisits: 4,
      pendingVisits: 5,
      completedVisitsToday: 0,
      unauthorizedVehicles: 0,
      alertsPending: 0,
      avgVisitDuration: 0,
      ...security,
    },
    systemHealth: {
      camerasActive: 0,
      camerasTotal: 0,
      camerasInactive: 0,
      errorRateLast24h: 0,
      avgResponseTime: 0,
      totalLogsToday: 0,
      criticalErrorsToday: 0,
      services: [],
    },
    userActivity: {
      activeFamilies: 0,
      totalFamilies: 0,
      totalUsers: 0,
      activeUsersToday: 0,
      activeUsersWeek: 0,
      newUsersThisWeek: 0,
      topAuditActions: [],
      notificationsSentToday: 0,
      conciergeSessionsToday: 0,
    },
    lastUpdated: '2026-10-08T15:00:00Z',
  }
}

describe('dashboardSummarySchema', () => {
  it('usa 0 para awaitingApprovalVisits si el backend aún no lo envía', () => {
    const summary = dashboardSummarySchema.parse(makeRawSummary())
    expect(summary.security.awaitingApprovalVisits).toBe(0)
  })

  it('respeta awaitingApprovalVisits cuando viene', () => {
    const summary = dashboardSummarySchema.parse(makeRawSummary({ awaitingApprovalVisits: 3 }))
    expect(summary.security.awaitingApprovalVisits).toBe(3)
  })
})

describe('DashboardView: tarjeta de visitas', () => {
  it('muestra aparte las que esperan ingreso y las que esperan aprobación', async () => {
    dashboardApi.getSummary.mockResolvedValue(
      dashboardSummarySchema.parse(makeRawSummary({ pendingVisits: 5, awaitingApprovalVisits: 2 })),
    )
    renderWithProviders(<DashboardView />)

    expect(
      await screen.findByText('5 esperando ingreso · 2 esperando aprobación'),
    ).toBeInTheDocument()
  })

  it('muestra 0 esperando aprobación si el backend aún no envía el campo', async () => {
    dashboardApi.getSummary.mockResolvedValue(dashboardSummarySchema.parse(makeRawSummary({ pendingVisits: 5 })))
    renderWithProviders(<DashboardView />)

    expect(
      await screen.findByText('5 esperando ingreso · 0 esperando aprobación'),
    ).toBeInTheDocument()
  })
})
