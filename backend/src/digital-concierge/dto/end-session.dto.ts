import { IsEnum, IsOptional } from 'class-validator';
import { SessionStatus } from '../entities/concierge-session.entity';

export class EndSessionDto {
  @IsOptional()
  @IsEnum(SessionStatus)
  finalStatus?: SessionStatus;
}

export class EndSessionResponseDto {
  sessionId: string;
  status: SessionStatus;
  duration: number; // en segundos
  visitCreated: boolean;
}
