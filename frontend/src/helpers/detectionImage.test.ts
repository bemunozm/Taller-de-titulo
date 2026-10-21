import { describe, expect, it } from 'vitest'
import { MAX_SNAPSHOT_B64_LENGTH, hasDetectionImage, resolveDetectionImage } from './detectionImage'

// "/9j/" + relleno: base64 válido con la firma de un JPEG (no es una imagen real).
const VALID_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/'

describe('resolveDetectionImage: cuadro completo', () => {
  it('acepta https', () => {
    expect(resolveDetectionImage({ full_frame_path: 'https://res.cloudinary.com/x/a.jpg' }).fullFrameUrl).toBe(
      'https://res.cloudinary.com/x/a.jpg',
    )
  })

  it.each(['http://localhost:3000/a.jpg', 'http://127.0.0.1/a.jpg'])('acepta http solo en local: %s', (url) => {
    expect(resolveDetectionImage({ full_frame_path: url }).fullFrameUrl).toBe(url)
  })

  it.each([
    'http://example.com/a.jpg',
    String.raw`C:\lpr\detecciones\frame.jpg`,
    '/var/lpr/frame.jpg',
    './frame.jpg',
    'javascript:alert(1)',
    'file:///C:/lpr/frame.jpg',
    'data:image/jpeg;base64,AAAA',
    '',
    '   ',
    null,
    undefined,
  ])('rechaza %o', (value) => {
    expect(resolveDetectionImage({ full_frame_path: value }).fullFrameUrl).toBeNull()
  })

  it('rechaza una URL desmesurada', () => {
    expect(resolveDetectionImage({ full_frame_path: `https://a.cl/${'x'.repeat(3000)}` }).fullFrameUrl).toBeNull()
  })
})

describe('resolveDetectionImage: recorte de la patente', () => {
  it('arma el data URL con un base64 JPEG válido', () => {
    expect(resolveDetectionImage({ meta: { snapshot_jpeg_b64: VALID_B64 } }).snapshotDataUrl).toBe(
      `data:image/jpeg;base64,${VALID_B64}`,
    )
  })

  it.each([
    ['vacío', ''],
    ['con caracteres ajenos', '/9j/<script>alert(1)</script>'],
    ['sin firma JPEG', 'AAAAAAAAAAAAAAAA'],
    ['largo no múltiplo de 4', '/9j/4AAQS'],
    ['con comillas', '/9j/4AAQ"onerror="x'],
    ['no es string', 123],
    ['null', null],
  ])('rechaza base64 %s', (_name, value) => {
    expect(resolveDetectionImage({ meta: { snapshot_jpeg_b64: value } }).snapshotDataUrl).toBeNull()
  })

  it('no procesa un base64 enorme', () => {
    const huge = `/9j/${'A'.repeat(MAX_SNAPSHOT_B64_LENGTH)}`
    expect(resolveDetectionImage({ meta: { snapshot_jpeg_b64: huge } }).snapshotDataUrl).toBeNull()
  })

  it('tolera meta ausente o no objeto', () => {
    expect(resolveDetectionImage({ meta: null }).snapshotDataUrl).toBeNull()
    expect(resolveDetectionImage({ meta: 'texto' }).snapshotDataUrl).toBeNull()
    expect(resolveDetectionImage(undefined)).toEqual({ fullFrameUrl: null, snapshotDataUrl: null })
  })
})

describe('hasDetectionImage', () => {
  it('es verdadero con cualquiera de las dos fuentes', () => {
    expect(hasDetectionImage({ full_frame_path: 'https://a.cl/x.jpg' })).toBe(true)
    expect(hasDetectionImage({ meta: { snapshot_jpeg_b64: VALID_B64 } })).toBe(true)
  })

  it('es falso con una ruta de disco y sin recorte', () => {
    expect(hasDetectionImage({ full_frame_path: String.raw`C:\lpr\frame.jpg` })).toBe(false)
  })
})
