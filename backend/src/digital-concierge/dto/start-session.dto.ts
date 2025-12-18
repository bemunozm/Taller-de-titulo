import { IsOptional, IsString } from 'class-validator';

export class StartSessionDto {
  @IsOptional()
  @IsString()
  metadata?: string; // Puede incluir info del dispositivo, ubicación del kiosco, etc.
  
  @IsOptional()
  @IsString()
  socketId?: string; // Socket ID del cliente para notificaciones en tiempo real
}

export class StartSessionResponseDto {
  sessionId: string;
  ephemeralToken: string;
  expiresAt: Date;
}
