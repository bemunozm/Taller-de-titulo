import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { AccessAttempt, AttemptPassage } from '@/api/DetectionsAPI'
import AttemptDetails from './AttemptDetails'

const PASSAGE: AttemptPassage = {
  id: 'pas-1',
  direction: 'entry',
  directionSource: 'camera',
  firstSeenAt: '2026-10-21T12:00:00.000Z',
  lastSeenAt: '2026-10-21T12:00:03.000Z',
  sightingCount: 2,
  sightings: [
    {
      detectionId: 'det-1',
      cameraId: 'cam-a',
      at: '2026-10-21T12:00:00.000Z',
      direction: 'entry',
      directionSource: 'camera',
      full_frame_path: null,
      snapshot_jpeg_b64: null,
    },
    {
      detectionId: 'det-2',
      cameraId: 'cam-b',
      at: '2026-10-21T12:00:03.000Z',
      direction: 'unknown',
      directionSource: 'none',
      full_frame_path: null,
      snapshot_jpeg_b64: null,
    },
  ],
}

function makeAttempt(passage?: AttemptPassage | null): AccessAttempt {
  return {
    id: 'att-1',
    decision: 'Registrado',
    method: 'Patente - Salida',
    createdAt: '2026-10-21T12:00:00.000Z',
    detection: { id: 'det-1', cameraId: 'cam-a', plate: 'ZZZZ99', createdAt: '2026-10-21T12:00:00.000Z' },
    ...(passage === undefined ? {} : { passage }),
  }
}

describe('AttemptDetails: pasada', () => {
  it('prefiere la dirección de la pasada sobre el sufijo del método y muestra su fuente', () => {
    render(<AttemptDetails attempt={makeAttempt(PASSAGE)} onClose={vi.fn()} />)

    expect(screen.getByText('Dirección').nextElementSibling).toHaveTextContent('Entrada')
    expect(screen.getByText('Fuente de la dirección').nextElementSibling).toHaveTextContent('cámara de entrada/salida')
  })

  it('muestra las cámaras de la pasada con su nombre cuando se las entrega', () => {
    render(
      <AttemptDetails
        attempt={makeAttempt(PASSAGE)}
        onClose={vi.fn()}
        cameras={[{ id: 'cam-a', name: 'Portón HD' }, { id: 'cam-b', name: 'Estacionamiento 03' }]}
      />,
    )

    const section = screen.getByRole('region', { name: 'Cámaras que vieron este paso' })
    expect(within(section).getAllByRole('listitem')).toHaveLength(2)
    expect(within(section).getByText('Portón HD')).toBeInTheDocument()
    expect(within(section).getByText('Estacionamiento 03')).toBeInTheDocument()
  })

  it('sin pasada conserva el comportamiento previo (dirección del método, sin fuente ni cámaras)', () => {
    render(<AttemptDetails attempt={makeAttempt(null)} onClose={vi.fn()} />)

    expect(screen.getByText('Dirección').nextElementSibling).toHaveTextContent('Salida')
    expect(screen.queryByText('Fuente de la dirección')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Cámaras que vieron este paso' })).not.toBeInTheDocument()
  })
})
