import { z } from 'zod';

// Enums del backend
export const logLevelSchema = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const logTypeSchema = z.enum([
  'HTTP_REQUEST',
  'HTTP_RESPONSE',
  'MEDIAMTX_API',
  'WORKER_API',
  'OPENAI_API',
  'DATABASE',
  'WEBSOCKET',
  'STREAM',
  'DETECTION',
  'NOTIFICATION',
  'SYSTEM',
  'EXCEPTION',
]);
export type LogType = z.infer<typeof logTypeSchema>;

export const serviceNameSchema = z.enum([
  'BACKEND',
  'MEDIAMTX',
  'WORKER_PYTHON',
  'OPENAI',
  'DATABASE',
  'REDIS',
  'FRONTEND',
]);
export type ServiceName = z.infer<typeof serviceNameSchema>;

// Schema del log del sistema
export const systemLogSchema = z.object({
  id: z.string().uuid(),
  level: logLevelSchema,
  type: logTypeSchema,
  service: serviceNameSchema,
  message: z.string(),
  method: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  statusCode: z.number().nullable().optional(),
  responseTime: z.number().nullable().optional(),
  requestData: z.record(z.unknown()).nullable().optional(),
  responseData: z.record(z.unknown()).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  stackTrace: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  correlationId: z.string().nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  createdAt: z.string().transform((date) => new Date(date)),
});

export type SystemLog = z.infer<typeof systemLogSchema>;

// Query params para filtros
export const systemLogQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  level: logLevelSchema.optional(),
  type: logTypeSchema.optional(),
  service: serviceNameSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  correlationId: z.string().optional(),
});

export type SystemLogQuery = z.infer<typeof systemLogQuerySchema>;

// Respuesta paginada
export const paginatedSystemLogsSchema = z.object({
  data: z.array(systemLogSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  }),
});

export type PaginatedSystemLogs = z.infer<typeof paginatedSystemLogsSchema>;

// Estadísticas de logs
export const systemLogStatsSchema = z.object({
  totalLogs: z.number(),
  byLevel: z.record(z.number()),
  byType: z.record(z.number()),
  byService: z.record(z.number()),
  averageResponseTime: z.number().nullable().optional(),
  errorRate: z.number().nullable().optional(),
  topErrors: z.array(z.object({
    message: z.string(),
    count: z.number(),
  })).optional(),
});

export type SystemLogStats = z.infer<typeof systemLogStatsSchema>;
