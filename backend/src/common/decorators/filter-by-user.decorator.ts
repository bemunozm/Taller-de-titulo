import { SetMetadata } from '@nestjs/common';

/**
 * Decorador para marcar endpoints que deben filtrar datos por usuario
 * cuando el usuario no tiene permisos de administrador.
 * 
 * Los administradores (Super Administrador y Administrador) ven todos los datos sin filtros.
 * Los demás roles (Residente, Conserje, Seguridad, etc.) ven solo datos filtrados.
 * 
 * @param filterType - Tipo de filtro a aplicar:
 *   - 'self': Filtra por userId (el usuario solo ve sus propios datos)
 *   - 'family': Filtra por familyId (el usuario ve datos de toda su familia)
 * 
 * @example
 * // Usuario solo ve su propio perfil
 * @FilterByUser('self')
 * @Get()
 * findAll() { ... }
 * 
 * @example
 * // Usuario ve visitas de toda su familia
 * @FilterByUser('family')
 * @Get()
 * findVisits() { ... }
 */
export const FILTER_BY_USER_KEY = 'filterByUser';

export const FilterByUser = (filterType: 'self' | 'family') =>
  SetMetadata(FILTER_BY_USER_KEY, filterType);
