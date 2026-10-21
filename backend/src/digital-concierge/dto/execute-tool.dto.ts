import {
  IsString,
  IsObject,
  IsNotEmpty,
  MaxLength,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

/**
 * Corrección P7 (cyber A1): tope de `parameters` de `execute-tool`. Los
 * inputs reales de las tools son de pocos campos cortos (el mayor,
 * `guardar_datos_visitante`, ronda los 400 bytes); el body admite hasta
 * 10 MB por las imágenes del LPR, así que sin este tope un cliente podía
 * mandar megabytes al dispatcher y a la auditoría.
 */
export const MAX_TOOL_PARAMETERS_BYTES = 8 * 1024;

/** Profundidad máxima de `parameters` (el objeto raíz es el nivel 1). */
export const MAX_TOOL_PARAMETERS_DEPTH = 4;

/** Largo máximo del nombre de la tool (los del catálogo son < 40). */
export const MAX_TOOL_NAME_LENGTH = 64;

/**
 * ¿`value` cabe en `maxBytes` serializado a JSON y no pasa de `maxDepth`
 * niveles? Recorrido iterativo que se corta apenas se pasa de cualquiera de
 * los dos límites (no serializa megabytes para descubrir que sobran). La
 * estimación cuenta claves y valores; si cabe, se confirma con el largo real
 * en UTF-8 de `JSON.stringify`, que ya es de a lo más unos KB.
 */
export function isWithinJsonLimits(
  value: unknown,
  maxBytes: number,
  maxDepth: number,
): boolean {
  let estimatedBytes = 0;
  const pending: Array<{ node: unknown; depth: number }> = [
    { node: value, depth: 1 },
  ];
  const fits = (bytes: number): boolean => {
    estimatedBytes += bytes;
    return estimatedBytes <= maxBytes;
  };
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { node, depth } = item;
    if (typeof node === 'object' && node !== null) {
      if (depth > maxDepth || !fits(2)) {
        return false;
      }
      // Sin copiar las entradas: se corta en la primera que no cabe.
      if (Array.isArray(node)) {
        for (const child of node as unknown[]) {
          if (!fits(1)) {
            return false;
          }
          pending.push({ node: child, depth: depth + 1 });
        }
        continue;
      }
      const record = node as Record<string, unknown>;
      for (const key in record) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
          continue;
        }
        if (!fits(key.length + 4)) {
          return false;
        }
        pending.push({ node: record[key], depth: depth + 1 });
      }
    } else if (!fits(typeof node === 'string' ? node.length : 8)) {
      return false;
    }
  }
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') <= maxBytes;
}

/** `parameters` dentro de `MAX_TOOL_PARAMETERS_BYTES` y `..._DEPTH`. */
export function IsBoundedToolParameters(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isBoundedToolParameters',
      validator: {
        validate: (value: unknown): boolean =>
          isWithinJsonLimits(
            value,
            MAX_TOOL_PARAMETERS_BYTES,
            MAX_TOOL_PARAMETERS_DEPTH,
          ),
        defaultMessage: (): string =>
          `parameters no puede superar ${MAX_TOOL_PARAMETERS_BYTES} bytes ni ${MAX_TOOL_PARAMETERS_DEPTH} niveles de profundidad`,
      },
    },
    options,
  );
}

export class ExecuteToolDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(MAX_TOOL_NAME_LENGTH)
  toolName: string;

  @IsNotEmpty()
  @IsObject()
  @IsBoundedToolParameters()
  parameters: Record<string, unknown>;
}

export class ToolResultDto {
  success: boolean;
  data?: unknown;
  error?: string;
}
