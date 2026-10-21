/** Largo máximo del nombre de archivo que se acepta del servidor. */
const MAX_FILENAME_LENGTH = 120

// Comillas y caracteres reservados por los sistemas de archivos.
const UNSAFE_FILENAME_CHARS = new Set(['"', '\\', '/', ':', '*', '?', '<', '>', '|'])

/** Fuera los caracteres de control y los reservados: nada de eso llega al nombre del archivo. */
function isSafeFilenameChar(char: string): boolean {
  const code = char.charCodeAt(0)
  return code >= 0x20 && code !== 0x7f && !UNSAFE_FILENAME_CHARS.has(char)
}

function sanitizeFilename(raw: string): string | null {
  // Solo el último segmento: "../../x.json" o "C:\\x.json" quedan en "x.json".
  const basename = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = Array.from(basename).filter(isSafeFilenameChar).join('').trim().slice(0, MAX_FILENAME_LENGTH)
  if (cleaned === '' || /^\.+$/.test(cleaned)) {
    return null
  }
  return cleaned
}

/**
 * Nombre de archivo de un `Content-Disposition` (`filename*=UTF-8''…` tiene
 * prioridad sobre `filename="…"`), saneado. `null` si no trae uno usable.
 */
export function filenameFromContentDisposition(header: unknown): string | null {
  if (typeof header !== 'string' || header.trim() === '') {
    return null
  }

  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  if (extended) {
    try {
      const decoded = sanitizeFilename(decodeURIComponent(extended[2].trim().replace(/^"|"$/g, '')))
      if (decoded) {
        return decoded
      }
    } catch {
      // Codificación inválida: se intenta con `filename=`.
    }
  }

  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header)
  if (plain) {
    return sanitizeFilename((plain[1] ?? plain[2] ?? '').trim())
  }
  return null
}

/** `YYYY-MM-DD` en la hora local del dispositivo. */
export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Descarga un Blob como archivo con un `<a download>` temporal. La URL del
 * objeto se libera después del clic (liberarla antes cancela la descarga en
 * algunos navegadores).
 */
export function saveBlobAsFile(blob: Blob, filename: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob)
  const link = doc.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  doc.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
