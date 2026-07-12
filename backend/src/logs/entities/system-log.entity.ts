import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  FATAL = 'FATAL',
}

export enum LogType {
  HTTP_REQUEST = 'HTTP_REQUEST',
  HTTP_RESPONSE = 'HTTP_RESPONSE',
  MEDIAMTX_API = 'MEDIAMTX_API',
  WORKER_API = 'WORKER_API',
  OPENAI_API = 'OPENAI_API',
  DATABASE = 'DATABASE',
  WEBSOCKET = 'WEBSOCKET',
  STREAM = 'STREAM',
  DETECTION = 'DETECTION',
  NOTIFICATION = 'NOTIFICATION',
  SYSTEM = 'SYSTEM',
  EXCEPTION = 'EXCEPTION',
  // Fase 1, Bloque A2a (docs/modulos/agente-cerebro.md §5, regla dura #4):
  // cada ejecución de una VigiliaTool queda auditada con este tipo — ver
  // ToolDispatcherService.
  AGENT_TOOL_CALL = 'AGENT_TOOL_CALL',
}

export enum ServiceName {
  BACKEND = 'BACKEND',
  MEDIAMTX = 'MEDIAMTX',
  WORKER_PYTHON = 'WORKER_PYTHON',
  OPENAI = 'OPENAI',
  DATABASE = 'DATABASE',
  REDIS = 'REDIS',
  FRONTEND = 'FRONTEND',
}

@Entity('system_logs')
@Index(['level', 'createdAt'])
@Index(['type', 'createdAt'])
@Index(['service', 'createdAt'])
@Index(['statusCode'])
export class SystemLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: LogLevel,
    default: LogLevel.INFO,
  })
  level: LogLevel;

  @Column({
    type: 'enum',
    enum: LogType,
  })
  type: LogType;

  @Column({
    type: 'enum',
    enum: ServiceName,
  })
  service: ServiceName;

  @Column({ type: 'varchar', length: 500 })
  message: string;

  // HTTP/API specific fields
  @Column({ type: 'varchar', length: 10, nullable: true })
  method: string; // GET, POST, PUT, DELETE

  @Column({ type: 'text', nullable: true })
  url: string;

  @Column({ type: 'int', nullable: true })
  statusCode: number;

  @Column({ type: 'int', nullable: true })
  responseTime: number; // in milliseconds

  // Request/Response data
  @Column({ type: 'jsonb', nullable: true })
  requestData: any;

  @Column({ type: 'jsonb', nullable: true })
  responseData: any;

  // Error information
  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'text', nullable: true })
  stackTrace: string;

  // Additional metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  // Correlation for tracking request chains
  @Column({ type: 'varchar', nullable: true })
  @Index()
  correlationId: string;

  // IP and user agent for HTTP requests
  @Column({ type: 'varchar', nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
