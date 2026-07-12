import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Mensaje del canal de TEXTO (Fase 1, Bloque A2a — endpoint verificable del
 * agente-cerebro). Deliberadamente simple: `role`/`content` de texto plano,
 * sin partes multimodales ni tool-calls serializados — el historial de
 * tool-calls lo reconstruye el propio AI SDK dentro de un turno; entre
 * turnos, el cliente reenvía la conversación completa (persistir el
 * historial del lado del backend es trabajo del próximo bloque, ver §10.2
 * paso 6 del doc — "resolver la señal de fin de llamada").
 */
export class AgentChatMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  // Revisión de calidad (FIX 3): acota el tamaño de cada mensaje — sin esto,
  // un `content` arbitrariamente largo (por mensaje, y el cliente reenvía
  // TODO el historial en cada turno) infla el prompt enviado al proveedor
  // del modelo (costo por token) sin ningún límite.
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

export class AgentChatRequestDto {
  /**
   * Casa/departamento de destino (ya conocida por el flujo del DialPad —
   * ver Sofía prompt §"INFORMACIÓN INICIAL"). Requerida porque el system
   * prompt la interpola directamente.
   */
  @IsString()
  @IsNotEmpty()
  houseNumber: string;

  // Revisión de calidad (FIX 3): acota el largo del historial — el cliente
  // reenvía la conversación completa en cada turno (ver docstring de la
  // clase), así que sin un tope el payload (y el costo del turno contra el
  // proveedor del modelo) crece sin límite con conversaciones largas.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AgentChatMessageDto)
  messages: AgentChatMessageDto[];
}
