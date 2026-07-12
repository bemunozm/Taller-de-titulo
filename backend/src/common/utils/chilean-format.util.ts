/**
 * Validación y normalización de datos chilenos declarados por voz por un
 * visitante (Fase 1 → Fase 2, cierre de brecha — docs/modulos/agente-cerebro.md
 * §7/§10.2). Al adelgazar el frontend en Fase 1 esta lógica se perdió: el
 * cliente ya no valida ni formatea antes de mandar el dato, y
 * `DigitalConciergeService.saveVisitorData` lo guarda tal cual. Este archivo
 * la revive en el dominio (backend), que es quien debe ser la autoridad —
 * el frontend nunca debería ser la única línea de defensa para la calidad
 * de un dato de negocio.
 *
 * RUT/pasaporte: `formatRut`/`isValidRut`/`looksLikeRut`/`isValidPassport` son
 * un port TEXTUAL de la lógica que vivía en `frontend/src/helpers/index.ts`
 * (funciones homónimas en camelCase-JS: `formatRUT`, `isValidRUT`,
 * `looksLikeRUT`, `isValidPassport`, `isValidChileanId`) — mismo algoritmo de
 * módulo 11, misma heurística para distinguir RUT de pasaporte extranjero
 * (el campo `rut` de `guardar_datos_visitante` acepta ambos, ver su
 * `inputSchema`).
 *
 * Teléfono y patente NO tenían un equivalente exacto en el frontend (la
 * patente solo se uppercase-limpiaba en `VisitForm`/`VehicleForm`, sin
 * validar formato; el teléfono se delegaba a `react-phone-number-input`).
 * Se agregan acá con el mismo espíritu: normalizar antes de guardar y
 * validar contra el formato chileno real, documentando explícitamente los
 * supuestos (ver docstrings de cada función) para que sean fáciles de
 * ajustar si la realidad de terreno los contradice.
 */

/**
 * Formatea un RUT chileno a su forma canónica `XX.XXX.XXX-X`.
 * Port textual de `formatRUT` (frontend/src/helpers/index.ts:29).
 */
export function formatRut(rut: string): string {
  const cleaned = rut.replace(/[^\dkK]/g, '').toUpperCase();
  if (cleaned.length < 2) return cleaned;

  let cuerpo = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  cuerpo = cuerpo.replace(/^0+/, '');

  let formatted = '';
  while (cuerpo.length > 3) {
    formatted = '.' + cuerpo.slice(-3) + formatted;
    cuerpo = cuerpo.slice(0, -3);
  }
  return cuerpo + formatted + '-' + dv;
}

/**
 * Valida el dígito verificador de un RUT chileno (algoritmo módulo 11).
 * Port textual de `isValidRUT` (frontend/src/helpers/index.ts:44).
 */
export function isValidRut(rut: string): boolean {
  const clean = rut.replace(/\./g, '').replace(/-/g, '');
  const cuerpo = clean.slice(0, -1);
  const dv = clean.slice(-1).toLowerCase();

  if (!/^\d+$/.test(cuerpo)) {
    return false;
  }

  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo.charAt(i), 10) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }

  const dvCalculado = 11 - (suma % 11);
  let dvEsperado: string;
  if (dvCalculado === 11) {
    dvEsperado = '0';
  } else if (dvCalculado === 10) {
    dvEsperado = 'k';
  } else {
    dvEsperado = dvCalculado.toString();
  }

  return dv === dvEsperado;
}

/**
 * Heurística para detectar si un string dictado por voz "parece" un RUT
 * chileno (8-9 caracteres, termina en dígito o K) en vez de un pasaporte.
 * Port textual de `looksLikeRUT` (frontend/src/helpers/index.ts:97).
 */
export function looksLikeRut(value: string): boolean {
  const cleanValue = value.replace(/[\s.-]/g, '');

  if (cleanValue.length < 8 || cleanValue.length > 9) {
    return false;
  }

  const lastChar = cleanValue.slice(-1).toLowerCase();
  if (!/^[\dk]$/.test(lastChar)) {
    return false;
  }

  const body = cleanValue.slice(0, -1);
  return /^\d+$/.test(body);
}

/**
 * Valida un pasaporte/DNI extranjero (6-12 caracteres alfanuméricos).
 * Port textual de `isValidPassport` (frontend/src/helpers/index.ts:70).
 */
export function isValidPassport(passport: string): boolean {
  const cleanPassport = passport.replace(/\s/g, '');

  if (cleanPassport.length < 6 || cleanPassport.length > 12) {
    return false;
  }

  if (!/^[A-Z0-9.-]{6,12}$/i.test(cleanPassport)) {
    return false;
  }

  const hasLetter = /[A-Za-z]/.test(cleanPassport);
  const isOnlyNumbers = /^\d+$/.test(cleanPassport);

  if (isOnlyNumbers) {
    return cleanPassport.length >= 7 && cleanPassport.length <= 10;
  }

  return hasLetter;
}

/**
 * Normaliza un teléfono declarado por voz a formato E.164 chileno
 * (`+56XXXXXXXXX`, 9 dígitos nacionales — el esquema unificado móvil/fijo
 * vigente en Chile desde 2012).
 *
 * Heurísticas (documentadas para poder ajustarlas si la realidad de campo
 * las contradice):
 * - Si ya trae el código de país (`56` + 9 dígitos, con o sin `+`), se
 *   respeta tal cual.
 * - Si son 9 dígitos nacionales (p.ej. "912345678"), se antepone `+56`.
 * - Si son 8 dígitos (p.ej. un visitante que dicta su celular sin el `9`
 *   inicial, un patrón común al hablar), se asume celular y se antepone
 *   `+569` — es una suposición, no una certeza; por eso la validación
 *   posterior (`isValidChileanPhone`) sigue siendo la que decide si el
 *   resultado es aceptable.
 * - Cualquier otro largo se devuelve solo limpio (dígitos + `+` si venía),
 *   sin inventar un código de país — `isValidChileanPhone` lo rechazará.
 */
export function normalizeChileanPhone(rawPhone: string): string {
  const trimmed = rawPhone.trim();
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) {
    return trimmed;
  }

  if (digits.startsWith('56') && digits.length === 11) {
    return `+${digits}`;
  }

  if (digits.length === 9) {
    return `+56${digits}`;
  }

  if (digits.length === 8) {
    return `+569${digits}`;
  }

  return hadPlus ? `+${digits}` : digits;
}

/**
 * Valida que un teléfono ya normalizado calce con el formato E.164 chileno:
 * `+56` seguido de 9 dígitos nacionales.
 */
export function isValidChileanPhone(phone: string): boolean {
  return /^\+56\d{9}$/.test(phone);
}

/**
 * Normaliza una patente chilena: mayúsculas, sin espacios/guiones/símbolos.
 */
export function normalizeChileanPlate(rawPlate: string): string {
  return rawPlate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Valida el formato de una patente chilena ya normalizada. Cubre los dos
 * formatos vigentes en circulación:
 * - Actual (vehículos patentados desde 2007): 4 letras + 2 dígitos
 *   (`BBBB99`, p.ej. "BBCD12").
 * - Anterior (vehículos patentados antes de 2007, todavía en circulación):
 *   2 letras + 4 dígitos (`AA9999`, p.ej. "AB1234").
 */
export function isValidChileanPlate(plate: string): boolean {
  const currentFormat = /^[A-Z]{4}\d{2}$/;
  const legacyFormat = /^[A-Z]{2}\d{4}$/;
  return currentFormat.test(plate) || legacyFormat.test(plate);
}

/**
 * Valida una identificación de visitante (RUT o pasaporte), replicando la
 * heurística de `isValidChileanId` (frontend/src/helpers/index.ts:117): si
 * el valor "parece" RUT (contiene guión/K, o calza en largo/formato), se
 * valida como RUT; si no, se valida como pasaporte extranjero.
 */
export function isValidIdentityDocument(id: string): boolean {
  const cleanId = id.trim();
  if (!cleanId) {
    return false;
  }

  if (cleanId.includes('-') || cleanId.toLowerCase().includes('k')) {
    return isValidRut(cleanId);
  }

  if (looksLikeRut(cleanId)) {
    return isValidRut(cleanId);
  }

  return isValidPassport(cleanId);
}
