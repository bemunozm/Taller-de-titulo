import { z } from 'zod'
import {
  LPR_ACTIONS,
  LPR_DETECTOR_IMGSZ_VALUES,
  LPR_DIRECTIONS,
  LPR_MIN_CONFIRM_READS_ACCESS,
  directionLineSchema,
  zonePolygonsSchema,
  type LprAction,
  type LprCropSettings,
  type LprDirection,
  type LprSettings,
  type ZonePoint,
} from '@/types/index'

type DetectorImgsz = (typeof LPR_DETECTOR_IMGSZ_VALUES)[number]

/**
 * Defaults del worker LPR (lpr/settings.py) que se muestran como placeholder.
 * Son informativos: el valor real lo resuelve el worker cuando el campo no se
 * envía, y puede variar si el host LPR define otro en su `.env`.
 */
export const LPR_WORKER_DEFAULTS = {
  detectorImgsz: 640,
  sampleFps: 1,
  minWidth: 30,
  minRatio: 2,
  maxRatio: 12,
  confirmReads: 3,
} as const

/** Debajo de este número de lecturas el voto deja de proteger contra falsas lecturas. */
export const LPR_RECOMMENDED_MIN_CONFIRM_READS = LPR_MIN_CONFIRM_READS_ACCESS

export const LPR_ACTION_LABELS: Record<LprAction, string> = {
  register: 'Solo registrar',
  access: 'Control de acceso',
}

export const LPR_DIRECTION_LABELS: Record<LprDirection, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  both: 'Ambas',
}

function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

interface NumberFieldOptions {
  label: string
  min: number
  max: number
  integer?: boolean
}

/** Campo numérico de texto: vacío = no enviado (`undefined`); si hay texto, debe cumplir el rango. */
function optionalNumber({ label, min, max, integer = false }: NumberFieldOptions) {
  return z
    .string()
    .superRefine((raw, ctx) => {
      if (raw.trim() === '') return
      const value = parseNumber(raw)
      if (value === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: ingresa un número` })
        return
      }
      if (integer && !Number.isInteger(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: debe ser un número entero` })
        return
      }
      if (value < min || value > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: debe estar entre ${min} y ${max}` })
      }
    })
    .transform((raw): number | undefined => parseNumber(raw) ?? undefined)
}

function emptyToUndefined<T extends string>(value: '' | T): T | undefined {
  return value === '' ? undefined : value
}

const IMGSZ_FIELD_VALUES = ['', ...LPR_DETECTOR_IMGSZ_VALUES.map(String)] as [string, ...string[]]

/**
 * Esquema del formulario "Visión LPR". Los campos de entrada son texto (lo que
 * escribe la persona) y la salida ya es tipada. Los rangos y cruces replican
 * los del backend (`lpr-settings.dto.ts`) para avisar antes del PATCH.
 */
export const lprFormSchema = z
  .object({
    action: z.enum(LPR_ACTIONS),
    direction: z.enum(['', ...LPR_DIRECTIONS] as const).transform(emptyToUndefined),
    detectorImgsz: z.enum(IMGSZ_FIELD_VALUES).transform((value): DetectorImgsz | undefined => {
      const parsed = LPR_DETECTOR_IMGSZ_VALUES.find((size) => String(size) === value)
      return parsed
    }),
    sampleFps: optionalNumber({ label: 'FPS de muestreo', min: 1, max: 15 }),
    minWidth: optionalNumber({ label: 'Ancho mínimo', min: 0, max: 2000, integer: true }),
    maxWidth: optionalNumber({ label: 'Ancho máximo', min: 1, max: 4000, integer: true }),
    unlimitedMaxWidth: z.boolean(),
    minRatio: optionalNumber({ label: 'Relación mínima', min: 0.1, max: 20 }),
    maxRatio: optionalNumber({ label: 'Relación máxima', min: 0.1, max: 20 }),
    confirmReads: optionalNumber({ label: 'Lecturas para confirmar', min: 1, max: 10, integer: true }),
    zone: zonePolygonsSchema,
    directionLine: directionLineSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    // Pares de recorte obligatorios (contrato): uno sin el otro lo rechaza el backend.
    const hasMaxWidth = value.unlimitedMaxWidth || value.maxWidth !== undefined
    if (value.minWidth !== undefined && !hasMaxWidth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxWidth'],
        message: 'Indica también el ancho máximo (o marca "Sin tope")',
      })
    }
    if (hasMaxWidth && value.minWidth === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minWidth'],
        message: 'Indica también el ancho mínimo',
      })
    }
    if (value.minRatio !== undefined && value.maxRatio === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxRatio'], message: 'Indica también la relación máxima' })
    }
    if (value.maxRatio !== undefined && value.minRatio === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minRatio'], message: 'Indica también la relación mínima' })
    }
    if (
      value.action === 'access' &&
      typeof value.confirmReads === 'number' &&
      value.confirmReads < LPR_MIN_CONFIRM_READS_ACCESS
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmReads'],
        message: `Con control de acceso se requieren al menos ${LPR_MIN_CONFIRM_READS_ACCESS} lecturas`,
      })
    }
    if (
      !value.unlimitedMaxWidth &&
      typeof value.minWidth === 'number' &&
      typeof value.maxWidth === 'number' &&
      value.maxWidth < value.minWidth
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxWidth'],
        message: 'El ancho máximo no puede ser menor que el mínimo',
      })
    }
    if (
      typeof value.minRatio === 'number' &&
      typeof value.maxRatio === 'number' &&
      value.maxRatio < value.minRatio
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxRatio'],
        message: 'La relación máxima no puede ser menor que la mínima',
      })
    }
  })

export type LprFormValues = z.input<typeof lprFormSchema>
export type LprFormOutput = z.output<typeof lprFormSchema>

function numberToField(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

/** Valores iniciales del formulario a partir de la configuración guardada (`null` = defaults). */
export function toLprFormValues(settings: LprSettings | null): LprFormValues {
  const crop = settings?.crop
  return {
    // Sin `action` el backend aplica control de acceso: se muestra explícito.
    action: settings?.action ?? 'access',
    direction: settings?.direction ?? '',
    detectorImgsz: settings?.detectorImgsz === undefined ? '' : String(settings.detectorImgsz),
    sampleFps: numberToField(settings?.sampleFps),
    minWidth: numberToField(crop?.minWidth),
    maxWidth: numberToField(crop?.maxWidth ?? undefined),
    unlimitedMaxWidth: crop?.maxWidth === null,
    minRatio: numberToField(crop?.minRatio),
    maxRatio: numberToField(crop?.maxRatio),
    confirmReads: numberToField(settings?.confirmReads),
    zone: settings?.zone ?? [],
    directionLine: settings?.directionLine ?? null,
  }
}

/**
 * Body de `PATCH /cameras/:id/lpr-settings`. El backend REEMPLAZA la
 * configuración, así que siempre se envía el objeto completo; los campos
 * vacíos se omiten (el worker usa su default). `{}` equivale a restablecer.
 */
export function toLprSettingsPayload(values: LprFormOutput): LprSettings {
  const payload: LprSettings = { action: values.action }
  if (values.direction !== undefined) payload.direction = values.direction
  if (values.detectorImgsz !== undefined) payload.detectorImgsz = values.detectorImgsz
  if (values.sampleFps !== undefined) payload.sampleFps = values.sampleFps
  if (values.confirmReads !== undefined) payload.confirmReads = values.confirmReads
  if (values.zone.length > 0) payload.zone = values.zone
  if (values.directionLine) payload.directionLine = values.directionLine

  const crop: LprCropSettings = {}
  if (values.minWidth !== undefined) crop.minWidth = values.minWidth
  if (values.unlimitedMaxWidth) crop.maxWidth = null
  else if (values.maxWidth !== undefined) crop.maxWidth = values.maxWidth
  if (values.minRatio !== undefined) crop.minRatio = values.minRatio
  if (values.maxRatio !== undefined) crop.maxRatio = values.maxRatio
  if (Object.keys(crop).length > 0) payload.crop = crop

  return payload
}

/** Resumen corto de la zona dibujada, para el formulario. */
export function describeZone(zone: ReadonlyArray<ReadonlyArray<ZonePoint>>): string {
  if (zone.length === 0) return 'Sin zona: se analiza todo el cuadro.'
  return zone.length === 1 ? '1 zona definida.' : `${zone.length} zonas definidas.`
}

/**
 * Valores validados con la cámara del portón para leer patentes de autos en
 * movimiento (requieren GPU). Se aplican al formulario como texto; no incluyen
 * modo, dirección, zona ni línea de dirección.
 */
export const LPR_RECOMMENDED_PLATE_VALUES = {
  detectorImgsz: 1920,
  sampleFps: 8,
  minWidth: 60,
  maxWidth: 250,
  minRatio: 0.8,
  maxRatio: 6,
  confirmReads: 3,
} as const

type RecommendedFormFields = Pick<
  LprFormValues,
  'detectorImgsz' | 'sampleFps' | 'minWidth' | 'maxWidth' | 'unlimitedMaxWidth' | 'minRatio' | 'maxRatio' | 'confirmReads'
>

/** Campos del formulario que cambia "Usar valores recomendados para patentes". */
export function recommendedPlateFormValues(): RecommendedFormFields {
  const recommended = LPR_RECOMMENDED_PLATE_VALUES
  return {
    detectorImgsz: String(recommended.detectorImgsz),
    sampleFps: String(recommended.sampleFps),
    minWidth: String(recommended.minWidth),
    maxWidth: String(recommended.maxWidth),
    unlimitedMaxWidth: false,
    minRatio: String(recommended.minRatio),
    maxRatio: String(recommended.maxRatio),
    confirmReads: String(recommended.confirmReads),
  }
}

type DefaultsCheckFields = Pick<
  LprFormValues,
  'detectorImgsz' | 'sampleFps' | 'minWidth' | 'maxWidth' | 'unlimitedMaxWidth' | 'minRatio' | 'maxRatio'
>

/**
 * ¿La cámara cae en los defaults del worker (640 px, 1 fps, proporción >= 2)?
 * Cierto si la resolución o los FPS están vacíos, o si no hay ningún recorte
 * (ni anchos ni proporciones). Con eso no suele leer patentes en movimiento.
 */
export function usesWorkerDetectionDefaults(values: DefaultsCheckFields): boolean {
  const noCrop =
    values.minWidth.trim() === '' &&
    values.maxWidth.trim() === '' &&
    !values.unlimitedMaxWidth &&
    values.minRatio.trim() === '' &&
    values.maxRatio.trim() === ''
  return values.detectorImgsz === '' || values.sampleFps.trim() === '' || noCrop
}

/** Clave de react-query de `GET /cameras/:id/lpr-settings`. */
export const lprSettingsQueryKey = (cameraId: string) => ['camera-lpr-settings', cameraId] as const
