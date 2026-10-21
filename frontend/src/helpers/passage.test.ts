import { describe, expect, it } from 'vitest'
import { parseAttemptPassage, type AttemptPassage } from '@/api/DetectionsAPI'
import {
  countPassageCameras,
  getDirectionSourceLabel,
  getPassageDirectionLabel,
  resolveCameraName,
  sightingImageSource,
  sortedSightings,
} from './passage'
import { resolveDetectionImage } from './detectionImage'

const SNAPSHOT_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/'

const RAW_PASSAGE = {
  id: 'pas-1',
  direction: 'exit',
  directionSource: 'line',
  firstSeenAt: '2026-10-21T12:00:00.000Z',
  lastSeenAt: '2026-10-21T12:00:08.000Z',
  sightingCount: 2,
  sightings: [
    {
      detectionId: 'det-2',
      cameraId: 'cam-b',
      at: '2026-10-21T12:00:08.000Z',
      direction: 'unknown',
      directionSource: 'none',
      full_frame_path: null,
      snapshot_jpeg_b64: SNAPSHOT_B64,
    },
    {
      detectionId: 'det-1',
      cameraId: 'cam-a',
      at: '2026-10-21T12:00:00.000Z',
      direction: 'exit',
      directionSource: 'line',
      full_frame_path: 'https://cdn.example.cl/frames/1.jpg',
      snapshot_jpeg_b64: null,
    },
  ],
}

describe('parseAttemptPassage', () => {
  it.each([undefined, null, 'x', 42, {}, { id: 'p' }])('devuelve null con %o (datos antiguos o malformados)', (raw) => {
    expect(parseAttemptPassage(raw)).toBeNull()
  })

  it('parsea una pasada completa', () => {
    const passage = parseAttemptPassage(RAW_PASSAGE)

    expect(passage?.direction).toBe('exit')
    expect(passage?.directionSource).toBe('line')
    expect(passage?.sightings).toHaveLength(2)
  })

  it('un valor desconocido de dirección o fuente cae en unknown / none en vez de romper', () => {
    const passage = parseAttemptPassage({ ...RAW_PASSAGE, direction: 'sideways', directionSource: 'telepathy' })

    expect(passage?.direction).toBe('unknown')
    expect(passage?.directionSource).toBe('none')
  })

  it('descarta solo el avistamiento roto, no la pasada', () => {
    const passage = parseAttemptPassage({ ...RAW_PASSAGE, sightings: [RAW_PASSAGE.sightings[0], { foo: 1 }, 7] })

    expect(passage?.sightings).toHaveLength(1)
    expect(passage?.sightings[0]?.detectionId).toBe('det-2')
  })

  it('sightings ausente queda como lista vacía', () => {
    const { sightings: _omit, ...withoutSightings } = RAW_PASSAGE
    void _omit

    expect(parseAttemptPassage(withoutSightings)?.sightings).toEqual([])
  })
})

describe('etiquetas', () => {
  it('traduce la fuente a lenguaje humano', () => {
    expect(getDirectionSourceLabel('line')).toBe('cruce de línea')
    expect(getDirectionSourceLabel('camera')).toBe('cámara de entrada/salida')
    expect(getDirectionSourceLabel('motion')).toBe('movimiento')
    expect(getDirectionSourceLabel('width')).toBe('tamaño de la patente')
    expect(getDirectionSourceLabel('none')).toBe('sin determinar')
  })

  it('traduce la dirección', () => {
    expect(getPassageDirectionLabel('entry')).toBe('Entrada')
    expect(getPassageDirectionLabel('exit')).toBe('Salida')
    expect(getPassageDirectionLabel('unknown')).toBe('Sin determinar')
  })
})

describe('avistamientos', () => {
  const passage = parseAttemptPassage(RAW_PASSAGE) as AttemptPassage

  it('los ordena por hora sin mutar la pasada', () => {
    expect(sortedSightings(passage).map((s) => s.detectionId)).toEqual(['det-1', 'det-2'])
    expect(passage.sightings.map((s) => s.detectionId)).toEqual(['det-2', 'det-1'])
  })

  it('se adaptan a resolveDetectionImage sin duplicar la validación', () => {
    const [first, second] = sortedSightings(passage)

    expect(resolveDetectionImage(sightingImageSource(first!))).toEqual({
      fullFrameUrl: 'https://cdn.example.cl/frames/1.jpg',
      snapshotDataUrl: null,
    })
    expect(resolveDetectionImage(sightingImageSource(second!))).toEqual({
      fullFrameUrl: null,
      snapshotDataUrl: `data:image/jpeg;base64,${SNAPSHOT_B64}`,
    })
  })

  it('resuelve el nombre de cámara y cae al id si no está en la lista', () => {
    const cameras = [{ id: 'cam-a', name: 'Portón HD' }, { id: 'cam-c', name: '', location: 'Acceso sur' }]

    expect(resolveCameraName('cam-a', cameras)).toBe('Portón HD')
    expect(resolveCameraName('cam-c', cameras)).toBe('Acceso sur')
    expect(resolveCameraName('cam-z', cameras)).toBe('cam-z')
  })

  it('cuenta cámaras distintas, no avistamientos', () => {
    const sameCamera = parseAttemptPassage({
      ...RAW_PASSAGE,
      sightings: [RAW_PASSAGE.sightings[0], { ...RAW_PASSAGE.sightings[0], detectionId: 'det-3' }],
    })

    expect(countPassageCameras(passage)).toBe(2)
    expect(countPassageCameras(sameCamera)).toBe(1)
    expect(countPassageCameras(parseAttemptPassage({ ...RAW_PASSAGE, sightings: [] }))).toBe(2)
    expect(countPassageCameras(null)).toBe(0)
  })
})
