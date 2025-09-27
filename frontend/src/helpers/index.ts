export function formatCurrency(amount: number) {
    return new Intl.NumberFormat('es-CL', {style: 'currency', currency: 'CLP'}).format(amount)
}

export function formatDate(dateStr: string) : string {
    const dateObj = new Date(dateStr)
    const options : Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }

    return new Intl.DateTimeFormat('es-CL', options).format(dateObj)
}

export function getPeriod(dateStr: string) : string {
    const dateObj = new Date(dateStr)
    const options : Intl.DateTimeFormatOptions = {
        month: 'long',
        year: 'numeric'
    }

    const formattedDate = new Intl.DateTimeFormat('es-CL', options).format(dateObj)
    return formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)
}

// Formatear un RUT chileno a XX.XXX.XXX-X
export function formatRUT(rut: string): string {
  rut = rut.replace(/[^\dkK]/g, '').toUpperCase();
  if (rut.length < 2) return rut;
  let cuerpo = rut.slice(0, -1);
  let dv = rut.slice(-1);
  cuerpo = cuerpo.replace(/^0+/, '');
  let formatted = '';
  while (cuerpo.length > 3) {
    formatted = '.' + cuerpo.slice(-3) + formatted;
    cuerpo = cuerpo.slice(0, -3);
  }
  formatted = cuerpo + formatted + '-' + dv;
  return formatted;
}
// Validar RUT chileno
export function isValidRUT(rut: string): boolean {
  rut = rut.replace(/\./g, '').replace(/-/g, '');
  const cuerpo = rut.slice(0, -1);
  const dv = rut.slice(-1).toLowerCase();
  if (!/^\d+$/.test(cuerpo)) {
    return false;
  }
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo.charAt(i)) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const dvCalculado = 11 - (suma % 11);
  let dvEsperado;
  if (dvCalculado === 11) {
    dvEsperado = '0';
  } else if (dvCalculado === 10) {
    dvEsperado = 'k';
  } else {
    dvEsperado = dvCalculado.toString();
  }
  return dv === dvEsperado;
}

// Validar pasaporte extranjero (6-12 caracteres alfanuméricos)
export function isValidPassport(passport: string): boolean {
  // Limpiar espacios
  const cleanPassport = passport.replace(/\s/g, '');
  
  // Debe tener entre 6 y 12 caracteres
  if (cleanPassport.length < 6 || cleanPassport.length > 12) {
    return false;
  }
  
  // Debe contener solo letras, números y algunos caracteres especiales permitidos
  if (!/^[A-Z0-9\-\.]{6,12}$/i.test(cleanPassport)) {
    return false;
  }
  
  // Debe contener al menos una letra o ser completamente numérico (para DNI)
  const hasLetter = /[A-Za-z]/.test(cleanPassport);
  const isOnlyNumbers = /^\d+$/.test(cleanPassport);
  
  if (isOnlyNumbers) {
    // Si es solo números, validar como DNI (7-8 dígitos)
    return cleanPassport.length >= 7 && cleanPassport.length <= 10;
  }
  
  return hasLetter; // Los pasaportes normalmente tienen letras
}

// Detectar si un string parece ser un RUT chileno
export function looksLikeRUT(value: string): boolean {
  const cleanValue = value.replace(/[\s\.\-]/g, '');
  
  // Debe tener entre 8-9 caracteres (7-8 números + 1 dígito verificador)
  if (cleanValue.length < 8 || cleanValue.length > 9) {
    return false;
  }
  
  // Debe terminar en número o K
  const lastChar = cleanValue.slice(-1).toLowerCase();
  if (!/^[\dk]$/.test(lastChar)) {
    return false;
  }
  
  // El resto deben ser números
  const body = cleanValue.slice(0, -1);
  return /^\d+$/.test(body);
}

// Validar identificación (RUT o pasaporte)
export function isValidChileanId(id: string): boolean {
  const cleanId = id.trim();
  
  if (!cleanId) {
    return false;
  }
  
  // Si contiene guión o K, asumir que es RUT
  if (cleanId.indexOf('-') !== -1 || cleanId.toLowerCase().includes('k')) {
    return isValidRUT(cleanId);
  }
  
  // Si parece RUT por longitud y formato, validar como RUT
  if (looksLikeRUT(cleanId)) {
    return isValidRUT(cleanId);
  }
  
  // Si no, validar como pasaporte
  return isValidPassport(cleanId);
}