import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
  registerDecorator,
} from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { MAX_GUARDIAN_ZONES } from './update-guardian-zones.dto';
import {
  MAX_POINTS_PER_ZONE,
  MIN_POINTS_PER_ZONE,
  ZonePointDto,
} from './zone-point.dto';
import {
  LPR_ACTIONS,
  LPR_DETECTOR_IMGSZ_VALUES,
  LPR_DIRECTIONS,
  LPR_EXIT_SIDES,
  MIN_DIRECTION_LINE_LENGTH,
} from '../lpr-settings';
import type {
  LprAction,
  LprCropSettings,
  LprDirection,
  LprDirectionLine,
  LprExitSide,
  LprPoint,
  LprSettings,
} from '../lpr-settings';

/**
 * Body de `PATCH /cameras/:id/lpr-settings` (plan LPR por cámara, F2).
 *
 * Todos los campos son opcionales y el body REEMPLAZA la configuración
 * guardada (no hace merge): `{}` la resetea a `null` (= defaults del worker).
 * Las propiedades desconocidas se rechazan (whitelist + forbidNonWhitelisted
 * del ValidationPipe global). `null` NO equivale a "ausente": se rechaza
 * (salvo `crop.maxWidth`, donde `null` = sin tope).
 *
 * `zone` reutiliza los límites del Guardián (hasta 20 polígonos de 3 a 100
 * puntos): es el mismo editor y la misma geometría.
 */

const FINITE = { allowNaN: false, allowInfinity: false } as const;

/** Omite los validadores de la propiedad solo cuando falta (undefined). */
function IfDefined(): PropertyDecorator {
  return ValidateIf((_object: unknown, value: unknown) => value !== undefined);
}

/**
 * Valida que el valor sea >= al de otra propiedad del mismo objeto. Si
 * cualquiera de los dos falta (o es null) no hay nada que cruzar.
 */
function IsNotLessThanSibling(
  sibling: string,
  message: string,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isNotLessThanSibling',
      target: target.constructor,
      propertyName: String(propertyKey),
      constraints: [sibling],
      options: { message },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [siblingName] = args.constraints as [string];
          const other = (args.object as Record<string, unknown>)[siblingName];
          if (typeof value !== 'number' || typeof other !== 'number') {
            return true;
          }
          return value >= other;
        },
      },
    });
  };
}

/**
 * Los pares del recorte van juntos: si viene uno, el otro es obligatorio
 * (`null` cuenta como presente). Se aplica junto con un ValidateIf que
 * mantiene activos los validadores cuando falta el campo pero llegó su par.
 */
function RequiredWithSibling(
  sibling: string,
  message: string,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'requiredWithSibling',
      target: target.constructor,
      propertyName: String(propertyKey),
      constraints: [sibling],
      options: { message },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [siblingName] = args.constraints as [string];
          const other = (args.object as Record<string, unknown>)[siblingName];
          return value !== undefined || other === undefined;
        },
      },
    });
  };
}

/** Activo si el campo viene, o si viene su par (para exigir el par). */
function IfPresentOrPaired(
  sibling: string,
  nullable: boolean,
): PropertyDecorator {
  return ValidateIf((object: unknown, value: unknown) => {
    const other = (object as Record<string, unknown>)[sibling];
    if (value === undefined) return other !== undefined;
    return !(nullable && value === null);
  });
}

/** Mínimo de lecturas concordantes cuando la acción es de acceso. */
export const MIN_CONFIRM_READS_FOR_ACCESS = 3;

function IsMinReadsForAccess(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isMinReadsForAccess',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message: `confirmReads debe ser al menos ${MIN_CONFIRM_READS_FOR_ACCESS} cuando la acción es "access" (o no se indica): una sola lectura no basta para abrir el portón`,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (typeof value !== 'number') return true;
          const { action } = args.object as { action?: unknown };
          const isAccess = action === undefined || action === 'access';
          return !isAccess || value >= MIN_CONFIRM_READS_FOR_ACCESS;
        },
      },
    });
  };
}

/**
 * Punto de la línea de dirección: coordenadas 0..1 ESTRICTAS (a diferencia de
 * las zonas, no se recortan: una línea mal dibujada se rechaza, no se
 * deforma en silencio).
 */
export class DirectionPointDto implements LprPoint {
  @ApiPropertyOptional({ minimum: 0, maximum: 1, example: 0.2 })
  @IsNumber(FINITE, { message: 'x debe ser un número' })
  @Min(0)
  @Max(1)
  x: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, example: 0.7 })
  @IsNumber(FINITE, { message: 'y debe ser un número' })
  @Min(0)
  @Max(1)
  y: number;
}

/** El extremo `to` debe distar al menos MIN_DIRECTION_LINE_LENGTH de `from`. */
function IsFarFromSibling(sibling: string, message: string): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isFarFromSibling',
      target: target.constructor,
      propertyName: String(propertyKey),
      constraints: [sibling],
      options: { message },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [siblingName] = args.constraints as [string];
          const other = (args.object as Record<string, unknown>)[siblingName];
          if (!isPoint(value) || !isPoint(other)) return true;
          return (
            Math.hypot(value.x - other.x, value.y - other.y) >=
            MIN_DIRECTION_LINE_LENGTH
          );
        },
      },
    });
  };
}

function isPoint(value: unknown): value is LprPoint {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === 'number' && typeof y === 'number';
}

export class LprDirectionLineDto implements LprDirectionLine {
  @ApiPropertyOptional({ type: () => DirectionPointDto })
  @IsDefined({ message: 'directionLine.from es obligatorio' })
  @IsObject()
  @ValidateNested()
  @Type(() => DirectionPointDto)
  from: DirectionPointDto;

  @ApiPropertyOptional({ type: () => DirectionPointDto })
  @IsDefined({ message: 'directionLine.to es obligatorio' })
  @IsObject()
  @ValidateNested()
  @Type(() => DirectionPointDto)
  @IsFarFromSibling(
    'from',
    `directionLine debe medir al menos ${MIN_DIRECTION_LINE_LENGTH} (coordenadas normalizadas)`,
  )
  to: DirectionPointDto;

  @ApiPropertyOptional({
    enum: LPR_EXIT_SIDES,
    description:
      'Lado hacia el que se mueve el vehículo al SALIR, mirando de from a to',
  })
  @IsDefined({ message: 'directionLine.exitSide es obligatorio' })
  @IsIn(LPR_EXIT_SIDES)
  exitSide: LprExitSide;
}

export class LprCropDto implements LprCropSettings {
  @ApiPropertyOptional({
    description: 'Ancho mínimo del recorte (px)',
    minimum: 0,
    maximum: 2000,
    example: 60,
  })
  @IfPresentOrPaired('maxWidth', false)
  @RequiredWithSibling(
    'maxWidth',
    'crop.minWidth es obligatorio cuando se envía crop.maxWidth',
  )
  @IsInt()
  @Min(0)
  @Max(2000)
  minWidth?: number;

  @ApiPropertyOptional({
    description: 'Ancho máximo del recorte (px); null = sin tope',
    minimum: 1,
    maximum: 4000,
    nullable: true,
    example: 250,
  })
  @IfPresentOrPaired('minWidth', true)
  @RequiredWithSibling(
    'minWidth',
    'crop.maxWidth es obligatorio cuando se envía crop.minWidth',
  )
  @IsInt()
  @Min(1)
  @Max(4000)
  @IsNotLessThanSibling(
    'minWidth',
    'crop.maxWidth no puede ser menor que crop.minWidth',
  )
  maxWidth?: number | null;

  @ApiPropertyOptional({
    description: 'Relación ancho/alto mínima',
    minimum: 0.1,
    maximum: 20,
    example: 0.8,
  })
  @IfPresentOrPaired('maxRatio', false)
  @RequiredWithSibling(
    'maxRatio',
    'crop.minRatio es obligatorio cuando se envía crop.maxRatio',
  )
  @IsNumber(FINITE)
  @Min(0.1)
  @Max(20)
  minRatio?: number;

  @ApiPropertyOptional({
    description: 'Relación ancho/alto máxima',
    minimum: 0.1,
    maximum: 20,
    example: 6,
  })
  @IfPresentOrPaired('minRatio', false)
  @RequiredWithSibling(
    'minRatio',
    'crop.maxRatio es obligatorio cuando se envía crop.minRatio',
  )
  @IsNumber(FINITE)
  @Min(0.1)
  @Max(20)
  @IsNotLessThanSibling(
    'minRatio',
    'crop.maxRatio no puede ser menor que crop.minRatio',
  )
  maxRatio?: number;
}

export class LprSettingsDto {
  @ApiPropertyOptional({
    enum: LPR_ACTIONS,
    description:
      '"register" solo registra la lectura (no abre el portón ni escala al conserje); "access" controla el acceso',
  })
  @IfDefined()
  @IsIn(LPR_ACTIONS)
  action?: LprAction;

  @ApiPropertyOptional({ enum: LPR_DIRECTIONS })
  @IfDefined()
  @IsIn(LPR_DIRECTIONS)
  direction?: LprDirection;

  @ApiPropertyOptional({
    description: `Polígonos de detección (coordenadas normalizadas 0 a 1): hasta ${MAX_GUARDIAN_ZONES} zonas de ${MIN_POINTS_PER_ZONE} a ${MAX_POINTS_PER_ZONE} puntos. [] = sin zona.`,
    type: 'array',
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  })
  @IfDefined()
  @IsArray({ message: 'zone debe ser una lista de zonas' })
  @ArrayMaxSize(MAX_GUARDIAN_ZONES, {
    message: `zone admite como máximo ${MAX_GUARDIAN_ZONES} zonas`,
  })
  @IsArray({ each: true, message: 'cada zona debe ser una lista de puntos' })
  @ArrayMinSize(MIN_POINTS_PER_ZONE, {
    each: true,
    message: `cada zona necesita al menos ${MIN_POINTS_PER_ZONE} puntos`,
  })
  @ArrayMaxSize(MAX_POINTS_PER_ZONE, {
    each: true,
    message: `cada zona admite como máximo ${MAX_POINTS_PER_ZONE} puntos`,
  })
  @ValidateNested({ each: true })
  @Type(() => ZonePointDto)
  zone?: ZonePointDto[][];

  @ApiPropertyOptional({
    enum: LPR_DETECTOR_IMGSZ_VALUES,
    description: 'Resolución de entrada del detector',
  })
  @IfDefined()
  @IsIn(LPR_DETECTOR_IMGSZ_VALUES)
  detectorImgsz?: (typeof LPR_DETECTOR_IMGSZ_VALUES)[number];

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 15,
    description: 'Cuadros por segundo que procesa el worker',
  })
  @IfDefined()
  @IsNumber(FINITE)
  @Min(1)
  @Max(15)
  sampleFps?: number;

  @ApiPropertyOptional({ type: () => LprCropDto })
  @IfDefined()
  @ValidateNested()
  @Type(() => LprCropDto)
  crop?: LprCropDto;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10,
    description: 'Lecturas concordantes para confirmar',
  })
  @IfDefined()
  @IsInt()
  @Min(1)
  @Max(10)
  @IsMinReadsForAccess()
  confirmReads?: number;

  @ApiPropertyOptional({
    type: () => LprDirectionLineDto,
    description:
      'Línea de cruce (coordenadas 0..1, longitud >= 0.05) que decide entrada/salida',
  })
  @IfDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => LprDirectionLineDto)
  directionLine?: LprDirectionLineDto;
}

/** Body de `PATCH /cameras/:id/lpr-settings`. */
export class UpdateLprSettingsDto extends LprSettingsDto {}

/**
 * Forma persistible de un body ya validado: solo las claves presentes, con
 * los puntos reducidos a `{x, y}`. Un body sin ninguna clave (`{}`) devuelve
 * `null` (= defaults del worker). `zone: []` y `crop: {}` se descartan.
 */
export function toStoredLprSettings(dto: LprSettingsDto): LprSettings | null {
  const out: LprSettings = {};
  if (dto.action !== undefined) out.action = dto.action;
  if (dto.direction !== undefined) out.direction = dto.direction;
  if (dto.zone !== undefined && dto.zone.length > 0) {
    out.zone = dto.zone.map((polygon) => polygon.map(({ x, y }) => ({ x, y })));
  }
  if (dto.detectorImgsz !== undefined) out.detectorImgsz = dto.detectorImgsz;
  if (dto.sampleFps !== undefined) out.sampleFps = dto.sampleFps;
  if (dto.crop !== undefined) {
    const crop: LprCropSettings = {};
    if (dto.crop.minWidth !== undefined) crop.minWidth = dto.crop.minWidth;
    if (dto.crop.maxWidth !== undefined) crop.maxWidth = dto.crop.maxWidth;
    if (dto.crop.minRatio !== undefined) crop.minRatio = dto.crop.minRatio;
    if (dto.crop.maxRatio !== undefined) crop.maxRatio = dto.crop.maxRatio;
    if (Object.keys(crop).length > 0) out.crop = crop;
  }
  if (dto.confirmReads !== undefined) out.confirmReads = dto.confirmReads;
  if (dto.directionLine !== undefined) {
    const { from, to, exitSide } = dto.directionLine;
    out.directionLine = {
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      exitSide,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}
