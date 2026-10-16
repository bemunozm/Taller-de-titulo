import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { callerMetadata, redactLogInfo, type LogInfo } from './log-redaction';

// Crear directorio de logs si no existe (vigilia-hub/logs, fuera de git).
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Fase 4 · P6.M: redacta cada registro ANTES de que llegue a cualquier
 * transporte (consola y archivos). Ver `log-redaction.ts`.
 */
const redactSensitiveFormat = winston.format((info) => {
  redactLogInfo(info as LogInfo);
  return info;
})();

/** Línea de log: fecha, nivel, servicio, mensaje, metadatos (ya redactados) y stack. */
function formatLine(info: winston.Logform.TransformableInfo): string {
  const record = info as LogInfo;
  const prefix = typeof record.service === 'string' ? `[${record.service}]` : '';
  const meta = callerMetadata(record);
  const metaText = meta ? ` ${JSON.stringify(meta)}` : '';
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : '';
  const message = typeof record.message === 'string' ? record.message : String(record.message);
  // El nivel ya viene en mayúsculas (`upperCaseLevel`) y, en consola, con color.
  const line = `${timestamp} ${String(record.level)} ${prefix} ${message}${metaText}`;
  return typeof record.stack === 'string' ? `${line}\n${record.stack}` : line;
}

/**
 * Nivel en mayúsculas ANTES de colorear: `colorize` elige el color por el
 * nivel original (símbolo interno de winston) y envuelve el texto. Antes se
 * hacía `toUpperCase()` sobre el texto ya coloreado y se rompían los códigos
 * ANSI (`[31MERROR`).
 */
const upperCaseLevel = winston.format((info) => {
  info.level = info.level.toUpperCase();
  return info;
})();

// Formato común a todos los transportes (la redacción va primero). Cada
// transporte agrega solo la línea final (y la consola, el color).
const baseFormat = winston.format.combine(
  redactSensitiveFormat,
  upperCaseLevel,
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
);
const lineFormat = winston.format.printf(formatLine);

// Crear logger. `LOG_LEVEL` se lee al importar este módulo: main.ts carga el
// `.env` (dotenv/config) antes de importarlo.
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: baseFormat,
  transports: [
    // Consola
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), lineFormat),
    }),
    // Archivo de logs generales
    new winston.transports.File({
      filename: path.join(logsDir, 'vigilia-hub.log'),
      format: lineFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Archivo de errores
    new winston.transports.File({
      filename: path.join(logsDir, 'errors.log'),
      level: 'error',
      format: lineFormat,
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

/** Metadatos estructurados de un log (se redactan antes de escribirse). */
export type LogMeta = Record<string, unknown>;

/**
 * Logger con contexto. Fase 4 · P6.M: los metadatos van como objeto
 * (`log(mensaje, { clave: valor })`) y se redactan; antes los argumentos
 * extra se esparcían como `{ 0: ..., 1: ... }`. El contenido completo
 * (eventos, transcripciones, argumentos de tools) va en `debug`.
 */
export class Logger {
  constructor(private readonly context: string) {}

  log(message: string, meta?: LogMeta): void {
    logger.info(message, { ...meta, service: this.context });
  }

  error(message: string, error?: unknown): void {
    if (error instanceof Error) {
      // El stack ya empieza con el mensaje del error: no se repite.
      logger.error(message, error.stack
        ? { service: this.context, stack: error.stack }
        : { service: this.context, error: error.message });
    } else if (error !== undefined) {
      logger.error(message, { service: this.context, error });
    } else {
      logger.error(message, { service: this.context });
    }
  }

  warn(message: string, meta?: LogMeta): void {
    logger.warn(message, { ...meta, service: this.context });
  }

  debug(message: string, meta?: LogMeta): void {
    logger.debug(message, { ...meta, service: this.context });
  }
}
