import { applyDecorators } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Casa o departamento marcado en el citófono (Fase 4 · P4.B, cyber B8). El
 * prompt de Sofía lo interpola tal cual, así que se acota a un identificador
 * corto con la forma de `Unit.identifier` (`${BLOCK}-${number}` o `number`,
 * que el admin tipea y puede traer espacios): palabras alfanuméricas
 * separadas por UN espacio o guion (p. ej. "1203", "A-303", "Casa 5"). Sin
 * espacios al inicio o al final, sin dobles, sin saltos de línea ni
 * puntuación.
 */
export const HOUSE_NUMBER_MAX_LENGTH = 32;
export const HOUSE_NUMBER_PATTERN = /^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/;

export const HOUSE_NUMBER_MESSAGE = `houseNumber debe tener hasta ${HOUSE_NUMBER_MAX_LENGTH} caracteres: letras y números, separados por un espacio o guion`;

/** Validación de `houseNumber` para DTOs (body o params). */
export function IsHouseNumber(): PropertyDecorator {
  return applyDecorators(
    IsString({ message: HOUSE_NUMBER_MESSAGE }),
    IsNotEmpty({ message: HOUSE_NUMBER_MESSAGE }),
    MaxLength(HOUSE_NUMBER_MAX_LENGTH, { message: HOUSE_NUMBER_MESSAGE }),
    Matches(HOUSE_NUMBER_PATTERN, { message: HOUSE_NUMBER_MESSAGE }),
  );
}

/** Params de `agent-config/:houseNumber` y `context/:houseNumber`. */
export class HouseNumberParamDto {
  @IsHouseNumber()
  houseNumber: string;
}
