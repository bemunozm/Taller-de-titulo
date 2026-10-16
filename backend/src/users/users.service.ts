import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateAccountByAdminDto } from './dto/create-account-by-admin.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from '../roles/entities/role.entity';
import { Family } from '../families/entities/family.entity';
import { In, Raw, Repository } from 'typeorm';
import { OrganizationMembershipService } from '../organization-membership/organization-membership.service';
import {
  canViewWholeCondominium,
  type TenantActor,
} from '../common/tenant/tenant-actor';
import { hasPlatformSuperAdminRole } from '../common/tenant/tenant-context.util';
import { PLATFORM_SUPER_ADMIN_ROLE } from '../common/tenant/tenant-context.types';
import {
  assertPolicyAllowed,
  assertRoleAssignmentAllowed,
  evaluateTargetHierarchy,
  evaluateTargetUser,
  type AssignableRole,
  type PolicyTarget,
} from '../roles/role-assignment.policy';
import { isForeignKeyViolation } from '../common/utils/unique-violation.util';
import { canSeeUserDetail } from './user-summary';
import {
  userFieldConflict,
  userUniqueConflictFrom,
} from './user-unique-conflict';
import {
  DELETED_USER_NAME,
  deletedUserEmail,
} from '../privacy/privacy-identifiers';
import { rowsOf } from '../privacy/sql-rows';
import { CONDOMINIUM_VIEW_ALL_PERMISSION } from '../common/constants/default-permissions.constant';
import { getUserPermissionNames } from '../auth/utils/permissions.util';

export { canSeeUserDetail, USERS_DETAIL_PERMISSION } from './user-summary';

/**
 * Proyección mínima de un usuario para quien no tiene
 * `USERS_DETAIL_PERMISSION` (Fase 4 · P5.C): lo justo para elegir un
 * anfitrión o un propietario. Sin email, RUT, teléfono ni roles.
 */
export interface UserDirectoryEntry {
  id: string;
  name: string;
  family: { id: string; name: string } | null;
}

/**
 * Estado de una cuenta para anonimizarla (Fase 4 · P7.R): si está
 * deshabilitada, si ya se anonimizó y sus fotos (URL de Cloudinary o null).
 */
export interface AnonymizationTarget {
  id: string;
  disabled: boolean;
  anonymizedAt: Date | null;
  profilePicture: string | null;
  image: string | null;
}

/**
 * Lo que `update` acepta internamente: el DTO HTTP más la foto de perfil, que
 * solo escribe el endpoint dedicado de subida (`AuthService`). Corrección P7
 * (cyber B1): `profilePicture` salió de `UpdateUserDto`; una URL cualquiera
 * en la foto de otro usuario terminaba borrándose en Cloudinary al
 * anonimizarlo.
 */
export interface UserUpdateInput extends UpdateUserDto {
  profilePicture?: string | null;
}

/**
 * Permisos de una cuenta de PERSONAL del condominio (Conserje, Seguridad,
 * Administrador...). Anonimizarla borra el rastro de quién operó: solo la
 * plataforma (super-admin) puede hacerlo (corrección P7, cyber M1).
 */
export const STAFF_ACCOUNT_PERMISSIONS: readonly string[] = Object.freeze([
  CONDOMINIUM_VIEW_ALL_PERMISSION,
  'users.update',
]);

export const STAFF_ACCOUNT_ANONYMIZATION_FORBIDDEN =
  'Solo la plataforma (super-admin) puede anonimizar una cuenta de personal del condominio';

export const ONLY_DISABLED_USERS_CAN_BE_ANONYMIZED =
  'Solo se anonimiza una cuenta deshabilitada: deshabilítala primero (PATCH /users/:id/disable)';

export const ANONYMIZED_USER_CANNOT_BE_ENABLED =
  'La cuenta fue anonimizada (Ley 21.719) y no se puede volver a habilitar: crea una cuenta nueva';

/** Usuario completo o su proyección mínima, según el actor. */
export type UserView = User | UserDirectoryEntry;

export function toUserDirectoryEntry(user: User): UserDirectoryEntry {
  return {
    id: user.id,
    name: user.name,
    family: user.family ? { id: user.family.id, name: user.family.name } : null,
  };
}

/** Datos propios de una cuenta nueva (roles, familia y condominio van aparte). */
export type NewAccountData = Pick<
  CreateAccountByAdminDto,
  'rut' | 'name' | 'email' | 'phone' | 'age'
>;

/** Rol con sus permisos, en la forma que usa `RoleAssignmentPolicy`. */
function toAssignableRole(role: Role): AssignableRole {
  return {
    id: role.id,
    name: role.name,
    permissionNames: (role.permissions ?? []).map(
      (permission) => permission.name,
    ),
  };
}

function userNotFound(id: string): NotFoundException {
  return new NotFoundException(`Usuario con ID ${id} no encontrado`);
}

function sameIdSet(
  current: readonly string[],
  next: readonly string[],
): boolean {
  const currentIds = new Set(current);
  const nextIds = new Set(next);
  return (
    currentIds.size === nextIds.size &&
    [...nextIds].every((id) => currentIds.has(id))
  );
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  //CONSTRUCTOR
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(Role) private roleRepository: Repository<Role>,
    @InjectRepository(Family) private familyRepository: Repository<Family>,
    private readonly configService: ConfigService,
    // Tarea #18 (docs/modulos/auth-multitenant.md §7b/§18): la activación de
    // cuentas creadas por admin reusa el flujo nativo de password-reset de
    // better-auth (ver sendActivationEmail). Disponible por DI porque
    // BetterAuthModule.forRoot(...) es global (app.module.ts) — mismo patrón
    // que src/auth/auth.guard.ts.
    private readonly betterAuthService: BetterAuthService,
    // Fase 4 · P5 (D11): membresías de condominio (`member` de better-auth).
    private readonly membershipService: OrganizationMembershipService,
  ) {}

  //METODOS

  /**
   * Alta de una cuenta por un administrador (`POST /users/create-by-admin` y
   * `POST /onboarding/members`). Fase 4 · P5 (D10/D11):
   *  1. Condominio de la cuenta: el del actor. Solo el super-admin indica uno
   *     explícito (`organizationId`, validado); sin él, solo crea cuentas de
   *     plataforma (rol "Super Administrador", sin condominio).
   *  2. `RoleAssignmentPolicy` sobre los roles que se otorgan.
   *  3. La familia, si viene, debe ser de ese condominio (si no → 403).
   *  4. Crea el usuario y su membresía; si la membresía falla, COMPENSA
   *     (borra el usuario recién creado) y responde 500.
   *  5. Recién entonces envía el email de activación.
   */
  async createAccountByAdmin(
    createAccountByAdminDto: CreateAccountByAdminDto,
    actor: TenantActor,
  ): Promise<User> {
    try {
      const {
        organizationId: requestedOrganizationId,
        roleIds,
        familyId,
        ...accountData
      } = createAccountByAdminDto;

      const roles = await this.findRolesWithPermissions(roleIds ?? []);
      const organizationId = await this.resolveNewAccountOrganization(
        requestedOrganizationId,
        actor,
        roles,
      );
      assertRoleAssignmentAllowed({
        actor,
        target: { userId: null, organizationId, isSuperAdmin: false },
        rolesToGrant: roles.map(toAssignableRole),
        changesRoles: true,
      });
      const family = familyId
        ? await this.findFamilyInOrganization(familyId, organizationId)
        : null;

      const savedUser = await this.provisionAccount(accountData, roles, family);
      if (organizationId) {
        await this.addMembershipOrDiscard(savedUser, organizationId);
      }
      await this.sendActivationEmail(savedUser);
      return savedUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const conflict = userUniqueConflictFrom(error);
      if (conflict) {
        throw conflict;
      }
      this.logger.error(
        'Error al crear cuenta por admin',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Error al crear la cuenta');
    }
  }

  /**
   * Crea el usuario (sin contraseña ni membresía) con sus roles y familia ya
   * resueltos. Lo usan `createAccountByAdmin` y el onboarding de un
   * condominio nuevo, que después crean la membresía y, si falla, llaman a
   * `discardProvisionedAccount`.
   */
  async provisionAccount(
    accountData: NewAccountData,
    roles: Role[],
    family: Family | null,
  ): Promise<User> {
    const existingUser = await this.findByEmail(accountData.email);
    if (existingUser) {
      throw userFieldConflict('email');
    }

    // Sin contraseña: el usuario la define al activar la cuenta con el link
    // de better-auth (`resetPassword` crea su cuenta `credential`).
    const newUser = this.userRepository.create({
      rut: accountData.rut,
      name: accountData.name,
      email: accountData.email,
      phone: accountData.phone,
      age: accountData.age,
      emailVerified: false, // El usuario debe confirmar su cuenta
    });
    newUser.roles = roles;
    newUser.family = family;

    try {
      return await this.userRepository.save(newUser);
    } catch (error) {
      // Corrección P5 (QA): 409 con el campo exacto (email, RUT o teléfono).
      throw userUniqueConflictFrom(error) ?? error;
    }
  }

  /**
   * Compensación: borra una cuenta recién creada cuya membresía no se pudo
   * crear. Nunca lanza (el llamador ya está respondiendo un error); si falla,
   * queda en el log con el id para limpiarla a mano.
   */
  async discardProvisionedAccount(userId: string): Promise<void> {
    try {
      await this.userRepository.delete(userId);
    } catch (error) {
      this.logger.error(
        `No se pudo revertir la cuenta ${userId}: quedó sin membresía de condominio`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Tarea #18: activar la cuenta = establecer contraseña por primera vez,
   * vía el flujo nativo de better-auth (reemplaza el token de 6 dígitos +
   * sendAccountCreatedByAdminEmail). Dispara el hook `sendResetPassword` de
   * better-auth.ts, que detecta "cuenta nueva" (sin `account` credential
   * todavía) y manda el copy de bienvenida. No lanza: un fallo de envío no
   * aborta el alta (el usuario puede usar "olvidé mi contraseña").
   */
  async sendActivationEmail(user: Pick<User, 'email'>): Promise<void> {
    try {
      const frontendUrl =
        this.configService.get<string>('FRONTEND_URL') ||
        'http://localhost:5173';
      await this.betterAuthService.api.requestPasswordReset({
        body: {
          email: user.email,
          redirectTo: `${frontendUrl}/auth/new-password`,
        },
      });
    } catch (error) {
      this.logger.error(
        'Error al enviar email de activación de cuenta (better-auth)',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Roles por id con sus permisos; 400 si alguno no existe. */
  async findRolesWithPermissions(roleIds: readonly string[]): Promise<Role[]> {
    const uniqueIds = [...new Set(roleIds)];
    if (uniqueIds.length === 0) {
      return [];
    }
    const roles = await this.roleRepository.find({
      where: { id: In(uniqueIds) },
      relations: ['permissions'],
    });
    if (roles.length !== uniqueIds.length) {
      throw new BadRequestException('Uno o más roles no son válidos');
    }
    return roles;
  }

  /** Condominio donde se crea la membresía de una cuenta nueva (`null` = cuenta de plataforma). */
  private async resolveNewAccountOrganization(
    requestedOrganizationId: string | undefined,
    actor: TenantActor,
    roles: readonly Role[],
  ): Promise<string | null> {
    if (!actor.isSuperAdmin) {
      if (requestedOrganizationId !== undefined) {
        throw new ForbiddenException(
          'Solo la plataforma (super-admin) puede indicar el condominio de la cuenta',
        );
      }
      if (!actor.organizationId) {
        throw new ForbiddenException(
          'Tu cuenta no pertenece a ningún condominio',
        );
      }
      return actor.organizationId;
    }

    const isPlatformAccount = roles.some(
      (role) => role.name === PLATFORM_SUPER_ADMIN_ROLE,
    );
    if (!requestedOrganizationId) {
      if (isPlatformAccount) {
        return null;
      }
      throw new BadRequestException(
        'Indica el condominio (organizationId) de la cuenta',
      );
    }
    if (isPlatformAccount) {
      throw new BadRequestException(
        'Una cuenta de la plataforma (super-administrador) no pertenece a un condominio',
      );
    }
    if (
      !(await this.membershipService.organizationExists(
        requestedOrganizationId,
      ))
    ) {
      throw new BadRequestException('El condominio indicado no existe');
    }
    return requestedOrganizationId;
  }

  /** Familia por id que debe pertenecer al condominio `organizationId` (si no → 403). */
  private async findFamilyInOrganization(
    familyId: string,
    organizationId: string | null,
  ): Promise<Family> {
    const family = await this.familyRepository.findOne({
      where: { id: familyId },
    });
    if (!family) {
      throw new BadRequestException('La familia especificada no existe');
    }
    if ((family.organizationId ?? null) !== organizationId) {
      throw new ForbiddenException(
        'La familia no pertenece al condominio del usuario',
      );
    }
    return family;
  }

  /** Crea la membresía; si falla, borra la cuenta recién creada y responde 500. */
  private async addMembershipOrDiscard(
    user: User,
    organizationId: string,
  ): Promise<void> {
    try {
      await this.membershipService.addMember(user.id, organizationId);
    } catch (error) {
      this.logger.error(
        `No se pudo crear la membresía de la cuenta ${user.id} en el condominio ${organizationId}; se revierte la cuenta`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.discardProvisionedAccount(user.id);
      throw new InternalServerErrorException(
        'No fue posible asociar la cuenta al condominio. La cuenta no se creó; inténtalo de nuevo.',
      );
    }
  }

  async findAll(userId?: string) {
    try {
      // Con userId (actor sin `condominium.view-all`, ver findAllForActor),
      // devolver solo ese usuario
      if (userId) {
        const user = await this.userRepository.findOne({
          where: { id: userId },
          relations: ['roles', 'family'],
          withDeleted: true,
        });
        return user ? [user] : [];
      }

      // Sin userId: todos los usuarios de la plataforma (solo super-admin
      // desde la API, ver findAllForActor)
      return await this.userRepository.find({
        relations: ['roles', 'family'],
        withDeleted: true,
      });
    } catch {
      throw new InternalServerErrorException(
        'Error al obtener todos los usuarios',
      );
    }
  }

  async findOne(id: string) {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
        relations: ['roles', 'roles.permissions', 'family'],
      });
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al buscar el usuario');
    }
  }

  async findByEmail(email: string) {
    try {
      return await this.userRepository.findOne({
        where: { email: email.toLowerCase() },
      });
    } catch {
      throw new InternalServerErrorException(
        'Error al buscar usuario por email',
      );
    }
  }

  /**
   * Actualiza el usuario. `options.resetEmailVerification` (corrección P5,
   * cyber B2): si otro actor le cambió el email, queda sin verificar.
   */
  async update(
    id: string,
    updateUserDto: UserUpdateInput,
    options: { resetEmailVerification?: boolean } = {},
  ) {
    try {
      // Buscar el usuario primero
      const user = await this.userRepository.findOne({
        where: { id },
        relations: ['roles', 'family'],
      });

      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }

      // Actualizar roles si se proporcionaron
      if (updateUserDto.roleIds !== undefined) {
        if (updateUserDto.roleIds && updateUserDto.roleIds.length > 0) {
          const roles = await this.roleRepository.findBy({
            id: In(updateUserDto.roleIds),
          });
          if (roles.length !== updateUserDto.roleIds.length) {
            throw new BadRequestException('Uno o más roles no son válidos');
          }
          user.roles = roles;
        } else {
          user.roles = [];
        }
      }

      // Actualizar familia si se proporcionó
      if (updateUserDto.familyId !== undefined) {
        if (updateUserDto.familyId) {
          const family = await this.familyRepository.findOne({
            where: { id: updateUserDto.familyId },
          });
          if (!family) {
            throw new BadRequestException('La familia especificada no existe');
          }
          user.family = family;
        } else {
          user.family = null;
        }
      }

      // Actualizar otros campos (roles y familia ya se resolvieron arriba)
      const otherFields: Partial<UserUpdateInput> = { ...updateUserDto };
      delete otherFields.roleIds;
      delete otherFields.familyId;
      Object.assign(user, otherFields);
      if (options.resetEmailVerification) {
        user.emailVerified = false;
      }

      // Guardar usuario actualizado
      const updatedUser = await this.userRepository.save(user);
      return updatedUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const conflict = userUniqueConflictFrom(error);
      if (conflict) {
        throw conflict;
      }
      throw new InternalServerErrorException('Error al actualizar el usuario');
    }
  }

  async save(user: User) {
    try {
      return await this.userRepository.save(user);
    } catch (error) {
      const conflict = userUniqueConflictFrom(error);
      if (conflict) {
        throw conflict;
      }
      throw new InternalServerErrorException('Error al guardar el usuario');
    }
  }

  /**
   * Cierra TODAS las sesiones del usuario (corrección P5, cyber B2). Usa la
   * API server-side de better-auth (`internalAdapter.deleteUserSessions`,
   * que también limpia el secondary storage y corre los hooks de sesión); si
   * no está disponible, borra las filas de `session`. Si las dos fallan, 500
   * con `failureMessage`: el cambio ya quedó guardado, pero las sesiones
   * siguen abiertas.
   *
   * Por better-auth corre `session.delete.after` por cada sesión, que corta
   * al instante los sockets de tiempo real con `session:ended { revoked }`
   * (Fase 4 · P6.R). El respaldo por SQL no dispara el hook: esos sockets
   * caen en la revalidación del gateway (≤5 min).
   */
  private async revokeUserSessions(
    userId: string,
    failureMessage = 'El usuario se actualizó, pero no se pudieron cerrar sus sesiones. Vuelve a intentarlo o deshabilítalo.',
  ): Promise<void> {
    try {
      const context = await this.betterAuthService.instance.$context;
      await context.internalAdapter.deleteUserSessions(userId);
      return;
    } catch (error) {
      this.logger.warn(
        `No se pudieron cerrar las sesiones de ${userId} con better-auth; se borran de la tabla session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      await this.userRepository.manager.query(
        'DELETE FROM "session" WHERE "userId" = $1',
        [userId],
      );
    } catch (error) {
      this.logger.error(
        `No se pudieron cerrar las sesiones del usuario ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(failureMessage);
    }
  }

  async findOneWithFamily(id: string) {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
        relations: ['family', 'family.members'],
      });
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error al buscar usuario con familia',
      );
    }
  }

  async findByRole(roleName: string) {
    try {
      return await this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.roles', 'role')
        .where('role.name = :roleName', { roleName })
        .getMany();
    } catch {
      throw new InternalServerErrorException(
        'Error al buscar usuarios por rol',
      );
    }
  }

  async findByFamily(familyId: string) {
    try {
      return await this.userRepository.find({
        where: { family: { id: familyId } },
        relations: ['roles'],
      });
    } catch {
      throw new InternalServerErrorException(
        'Error al buscar usuarios por familia',
      );
    }
  }

  /**
   * Borrado definitivo. Corrección P6: ANTES de borrar cierra todas las
   * sesiones con better-auth, para que el hook de borrado de sesión corte sus
   * sockets al instante (`revoked`). La FK `session.userId` es `ON DELETE
   * CASCADE`: si solo se borrara el usuario, Postgres eliminaría las sesiones
   * sin pasar por el hook y el socket seguiría hasta la revalidación (≤5 min).
   * Si el borrado falla después (409 por registros asociados), el usuario
   * sigue existiendo pero tiene que volver a iniciar sesión.
   */
  async remove(id: string) {
    await this.revokeUserSessions(
      id,
      'No se pudieron cerrar las sesiones del usuario; no se eliminó. Vuelve a intentarlo.',
    );
    try {
      const result = await this.userRepository.delete(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Fase 4 · P5.C: un usuario con registros asociados (visitas como
      // anfitrión, vehículos, auditoría...) no se puede borrar: antes 500.
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'No se puede eliminar el usuario porque tiene registros asociados (visitas, vehículos u otros). Deshabilítalo en su lugar.',
        );
      }
      throw new InternalServerErrorException('Error al eliminar el usuario');
    }
  }

  /**
   * Deshabilita la cuenta (soft-delete) y cierra TODAS sus sesiones.
   *
   * Corrección P6 (cyber+QA): antes solo hacía el soft-delete; el socket de
   * un conserje deshabilitado seguía recibiendo el feed de seguridad hasta la
   * revalidación (≤5 min) y sus filas de `session` seguían vivas. Ahora el
   * hook de borrado de sesión corta sus sockets al instante (`revoked`).
   * Primero el soft-delete: una sesión que se cree entre medio ya no sirve
   * (la API y el WebSocket rechazan al usuario deshabilitado) y `enable` la
   * cierra igual.
   */
  async disable(id: string) {
    let affected: number | undefined;
    try {
      const user = await this.userRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }

      const result = await this.userRepository.softDelete(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      affected = result.affected;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error al deshabilitar el usuario',
      );
    }

    await this.revokeUserSessions(
      id,
      'El usuario quedó deshabilitado, pero no se pudieron cerrar sus sesiones abiertas. No puede usarlas mientras esté deshabilitado y se cerrarán al volver a habilitarlo.',
    );
    return {
      message: 'Usuario deshabilitado exitosamente',
      affected,
    };
  }

  async enable(id: string) {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
        withDeleted: true,
      });

      if (!user) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }

      if (!user.deletedAt) {
        throw new BadRequestException('El usuario ya está habilitado');
      }

      // Fase 4 · P7.R: una cuenta anonimizada ya no tiene identidad (nombre,
      // email, RUT ni credencial): habilitarla dejaría una cuenta fantasma.
      if (user.anonymizedAt) {
        throw new ConflictException(ANONYMIZED_USER_CANNOT_BE_ENABLED);
      }

      // Corrección P6 (cyber+QA): ninguna sesión anterior a la habilitación
      // vuelve a servir (las que quedaron si falló el cierre al deshabilitar,
      // o las que better-auth abrió con un login mientras estaba
      // deshabilitado). Antes de restaurar: si falla, la cuenta sigue
      // deshabilitada y se puede reintentar.
      await this.revokeUserSessions(
        id,
        'No se pudieron cerrar las sesiones anteriores del usuario; sigue deshabilitado. Vuelve a intentarlo.',
      );

      const result = await this.userRepository.restore(id);
      if (result.affected === 0) {
        throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
      }
      return {
        message: 'Usuario habilitado exitosamente',
        affected: result.affected,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Error al habilitar el usuario');
    }
  }

  // ===========================================================================
  // Anonimización de cuentas deshabilitadas (Fase 4 · P7.R, Ley 21.719,
  // docs/modulos/privacidad-ley-21719.md §3/§4). La orquesta privacy/
  // (`DisabledUserAnonymizer`): la retención a los RETENTION_DISABLED_USERS_DAYS
  // de la baja y la supresión inmediata (`POST /privacy/erasure` con userId).
  // ===========================================================================

  /** Estado de la cuenta para decidir si se anonimiza (incluye deshabilitadas). */
  async findAnonymizationTarget(id: string): Promise<AnonymizationTarget> {
    const user = await this.userRepository.findOne({
      where: { id },
      withDeleted: true,
      loadEagerRelations: false,
      select: {
        id: true,
        deletedAt: true,
        anonymizedAt: true,
        profilePicture: true,
        image: true,
      },
    });
    if (!user) {
      throw userNotFound(id);
    }
    return {
      id: user.id,
      disabled: Boolean(user.deletedAt),
      anonymizedAt: user.anonymizedAt ?? null,
      profilePicture: user.profilePicture ?? null,
      image: user.image ?? null,
    };
  }

  /**
   * Anonimiza una cuenta DESHABILITADA (409 si está activa): nombre "Usuario
   * eliminado", email no entregable y único, RUT, teléfono y edad a null; las
   * fotos a null salvo `keepPictures` (su archivo sigue en Cloudinary y se
   * reintenta borrarlo). Borra sus credenciales (`account`), sesiones,
   * tokens de 6 dígitos, verificaciones y notificaciones (copian datos de
   * visitantes) y sus VEHÍCULOS (la patente lo identifica; corrección P7, QA
   * B1): antes suelta `vehicleId` en las visitas que los usan. Las demás FK
   * (visitas como anfitrión, auditoría, membresía) quedan intactas.
   * Idempotente: repetirla deja lo mismo y conserva el `anonymizedAt`
   * original.
   *
   * Las sesiones se cierran primero con better-auth (corta sus sockets, ver
   * `revokeUserSessions`); si eso falla, no se anonimiza (500, se reintenta).
   */
  async anonymizeDisabledUser(
    id: string,
    options: { keepPictures: boolean },
  ): Promise<void> {
    const target = await this.findAnonymizationTarget(id);
    if (!target.disabled) {
      throw new ConflictException(ONLY_DISABLED_USERS_CAN_BE_ANONYMIZED);
    }
    await this.revokeUserSessions(
      id,
      'No se pudieron cerrar las sesiones del usuario; no se anonimizó. Vuelve a intentarlo.',
    );

    await this.userRepository.manager.transaction(async (manager) => {
      const [locked] = rowsOf(
        await manager.query(
          'SELECT "deletedAt", "email" FROM "user" WHERE "id" = $1 FOR UPDATE',
          [id],
        ),
      );
      if (!locked) {
        throw userNotFound(id);
      }
      // Revalidación bajo el lock: un `enable` concurrente gana.
      if (locked.deletedAt === null || locked.deletedAt === undefined) {
        throw new ConflictException(ONLY_DISABLED_USERS_CAN_BE_ANONYMIZED);
      }
      const previousEmail =
        typeof locked.email === 'string' ? locked.email : null;

      await manager.update(
        User,
        { id },
        {
          name: DELETED_USER_NAME,
          email: deletedUserEmail(id),
          emailVerified: false,
          rut: null,
          phone: null,
          age: null,
          ...(options.keepPictures
            ? {}
            : { image: null, profilePicture: null }),
          anonymizedAt: () => 'COALESCE("anonymizedAt", now())',
        },
      );
      await manager.query('DELETE FROM "account" WHERE "userId" = $1', [id]);
      await manager.query('DELETE FROM "session" WHERE "userId" = $1', [id]);
      await manager.query('DELETE FROM "token" WHERE "userId" = $1', [id]);
      await manager.query(
        'DELETE FROM "verification" WHERE "value" = $1 OR "identifier" = $2',
        [id, previousEmail ?? deletedUserEmail(id)],
      );
      await manager.query(
        'DELETE FROM "notifications" WHERE "recipientId" = $1',
        [id],
      );
      await manager.query(
        'UPDATE "visits" SET "vehicleId" = NULL WHERE "vehicleId" IN (SELECT "id" FROM "vehicles" WHERE "ownerId" = $1)',
        [id],
      );
      await manager.query('DELETE FROM "vehicles" WHERE "ownerId" = $1', [id]);
    });
  }

  /**
   * ¿El actor puede anonimizar a este usuario? (supresión por la
   * administración). Mismas reglas que deshabilitar: dentro de su alcance
   * (404 si no), nunca a sí mismo, solo el super-admin a otro super-admin y
   * con jerarquía de permisos (403). Además, una cuenta de personal
   * (`STAFF_ACCOUNT_PERMISSIONS`) solo la anonimiza el super-admin (403).
   */
  async assertCanAnonymizeForActor(
    id: string,
    actor: TenantActor,
  ): Promise<void> {
    await this.assertVisibleToActor(id, actor);
    await this.assertCanDeactivate(id, actor, 'anonimizar');
    if (actor.isSuperAdmin) {
      return;
    }
    const target = await this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'roles.permissions'],
      withDeleted: true,
    });
    const permissions = new Set(getUserPermissionNames(target));
    if (STAFF_ACCOUNT_PERMISSIONS.some((name) => permissions.has(name))) {
      throw new ForbiddenException(STAFF_ACCOUNT_ANONYMIZATION_FORBIDDEN);
    }
  }

  // ===========================================================================
  // Variantes por actor (Fase 4 · P5, D12). Las usa UsersController; los
  // métodos de arriba siguen siendo los internos (visits, digital-concierge,
  // detections, auth, ...) y no cambian.
  //
  // Alcance de un actor sobre los usuarios:
  //  - super-admin: todos;
  //  - con `condominium.view-all`: los usuarios con membresía en SU condominio
  //    (sin condominio: ninguno);
  //  - sin ese permiso: solo él mismo.
  // Un usuario fuera del alcance responde 404 (no se revela que existe).
  // ===========================================================================

  /**
   * Usuario tal como lo ve el actor (Fase 4 · P5.C): el detalle completo si
   * tiene `USERS_DETAIL_PERMISSION` (o es super-admin) o si es él mismo; si
   * no, `UserDirectoryEntry`.
   */
  private viewForActor(user: User, actor: TenantActor): UserView {
    return canSeeUserDetail(actor) || user.id === actor.userId
      ? user
      : toUserDirectoryEntry(user);
  }

  /**
   * `GET /users`. Alcance: ver arriba. Fase 4 · P5.C: cada usuario va con el
   * detalle o la proyección mínima según `viewForActor`.
   */
  async findAllForActor(actor: TenantActor): Promise<UserView[]> {
    const users = await this.findUsersInActorScope(actor);
    const seesDetail = canSeeUserDetail(actor);
    return (
      users
        // Corrección P5 (QA): la vista proyectada (para elegir anfitrión o
        // propietario) no lista usuarios deshabilitados; la completa sí,
        // con `deletedAt`, para poder habilitarlos.
        .filter((user) => seesDetail || !user.deletedAt)
        .map((user) => this.viewForActor(user, actor))
    );
  }

  private async findUsersInActorScope(actor: TenantActor): Promise<User[]> {
    if (actor.isSuperAdmin) {
      return this.findAll();
    }
    if (!canViewWholeCondominium(actor)) {
      return this.findAll(actor.userId);
    }
    if (!actor.organizationId) {
      return [];
    }
    try {
      return await this.userRepository.find({
        where: {
          id: Raw(
            (alias) =>
              `${alias} IN (SELECT m."userId" FROM member m WHERE m."organizationId" = :memberOrganizationId)`,
            { memberOrganizationId: actor.organizationId },
          ),
        },
        relations: ['roles', 'family'],
        withDeleted: true,
      });
    } catch (error) {
      this.logger.error(
        'Error al obtener los usuarios del condominio',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al obtener todos los usuarios',
      );
    }
  }

  /** `GET /users/:id` (detalle o proyección mínima, ver `viewForActor`). */
  async findOneForActor(id: string, actor: TenantActor): Promise<UserView> {
    await this.assertVisibleToActor(id, actor);
    return this.viewForActor(await this.findOne(id), actor);
  }

  /**
   * `PATCH /users/:id`. Si cambian los roles aplica `RoleAssignmentPolicy`
   * (sobre los roles que se agregan); la familia, si viene, debe ser del
   * condominio del usuario. Un actor que no es super-admin no modifica a un
   * super-admin ni a usuarios de otro condominio.
   */
  async updateForActor(
    id: string,
    updateUserDto: UpdateUserDto,
    actor: TenantActor,
  ) {
    await this.assertVisibleToActor(id, actor);
    const target = await this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'roles.permissions'],
    });
    if (!target) {
      throw userNotFound(id);
    }

    const targetRef: PolicyTarget = {
      userId: id,
      organizationId: await this.membershipService.getOrganizationIdForUser(id),
      isSuperAdmin: hasPlatformSuperAdminRole(target),
    };
    assertPolicyAllowed(evaluateTargetUser(actor, targetRef));
    // Corrección P5 (cyber N1): jerarquía sobre los roles ACTUALES del destino.
    this.assertActorOutranks(target, actor);
    // Corrección P5 (residual de B2): el email de OTRO usuario solo lo cambia
    // la plataforma (el propio, desde el perfil). Cierra la toma de cuenta
    // entre pares (p. ej. dos Administradores: cambio de email + reset).
    const changesOthersEmail =
      id !== actor.userId &&
      updateUserDto.email !== undefined &&
      updateUserDto.email.toLowerCase() !== (target.email ?? '').toLowerCase();
    if (changesOthersEmail && !actor.isSuperAdmin) {
      throw new ForbiddenException(
        'Solo la plataforma (super-admin) puede cambiar el email de otro usuario',
      );
    }

    const nextRoleIds = updateUserDto.roleIds;
    const currentRoleIds = (target.roles ?? []).map((role) => role.id);
    if (nextRoleIds !== undefined && !sameIdSet(currentRoleIds, nextRoleIds)) {
      const grantedRoles = await this.findRolesWithPermissions(
        nextRoleIds.filter((roleId) => !currentRoleIds.includes(roleId)),
      );
      assertRoleAssignmentAllowed({
        actor,
        target: targetRef,
        rolesToGrant: grantedRoles.map(toAssignableRole),
        changesRoles: true,
      });
    }

    if (updateUserDto.familyId) {
      await this.findFamilyInOrganization(
        updateUserDto.familyId,
        targetRef.organizationId,
      );
    }

    // Corrección P5 (cyber B2, toma de cuentas): si el super-admin cambia el
    // email de OTRO usuario, el email nuevo queda sin verificar y se cierran
    // todas las sesiones del usuario (el email es la identidad de login).
    const updated = await this.update(id, updateUserDto, {
      resetEmailVerification: changesOthersEmail,
    });
    if (changesOthersEmail) {
      await this.revokeUserSessions(id);
    }
    return updated;
  }

  /** `DELETE /users/:id` (borrado definitivo). */
  async removeForActor(id: string, actor: TenantActor) {
    await this.assertVisibleToActor(id, actor);
    await this.assertCanDeactivate(id, actor, 'eliminar');
    return this.remove(id);
  }

  /** `PATCH /users/:id/disable`. */
  async disableForActor(id: string, actor: TenantActor) {
    await this.assertVisibleToActor(id, actor);
    await this.assertCanDeactivate(id, actor, 'deshabilitar');
    return this.disable(id);
  }

  /** `PATCH /users/:id/enable`. */
  async enableForActor(id: string, actor: TenantActor) {
    await this.assertVisibleToActor(id, actor);
    await this.assertNotPlatformAccount(id, actor, 'habilitar');
    return this.enable(id);
  }

  /**
   * Corrección P5 (cyber N1): 403 si el destino (OTRO usuario) tiene en sus
   * roles actuales algún permiso que el actor no tiene (ver
   * `evaluateTargetHierarchy`). `target.roles` debe venir con sus permisos.
   */
  private assertActorOutranks(target: User, actor: TenantActor): void {
    assertPolicyAllowed(
      evaluateTargetHierarchy(actor, {
        userId: target.id,
        roles: (target.roles ?? []).map(toAssignableRole),
      }),
    );
  }

  /**
   * ¿El usuario está entre los miembros activos del condominio? (cuenta no
   * deshabilitada). Lo usa el conserje digital para autorizar al residente
   * notificado en `/respond` y `/status` (P5 · D11).
   */
  async isActiveMemberOfOrganization(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    return this.membershipService.isActiveMember(userId, organizationId);
  }

  /** 404 si el usuario está fuera del alcance del actor (ver arriba). */
  private async assertVisibleToActor(
    id: string,
    actor: TenantActor,
  ): Promise<void> {
    if (actor.isSuperAdmin) {
      return;
    }
    if (!canViewWholeCondominium(actor)) {
      if (id === actor.userId) {
        return;
      }
      throw userNotFound(id);
    }
    if (
      actor.organizationId &&
      (await this.membershipService.isMemberOfOrganization(
        id,
        actor.organizationId,
      ))
    ) {
      return;
    }
    throw userNotFound(id);
  }

  /**
   * Nadie se borra ni se deshabilita a sí mismo; solo el super-admin toca a
   * otro super-admin; y (corrección P5, N1) nadie toca a quien tiene permisos
   * que él no tiene.
   */
  private async assertCanDeactivate(
    id: string,
    actor: TenantActor,
    verb: string,
  ): Promise<void> {
    if (id === actor.userId) {
      throw new ForbiddenException(`No puedes ${verb} tu propia cuenta`);
    }
    await this.assertNotPlatformAccount(id, actor, verb);
  }

  private async assertNotPlatformAccount(
    id: string,
    actor: TenantActor,
    verb: string,
  ): Promise<void> {
    if (actor.isSuperAdmin) {
      return;
    }
    const target = await this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'roles.permissions'],
      withDeleted: true,
    });
    if (!target) {
      throw userNotFound(id);
    }
    if (hasPlatformSuperAdminRole(target)) {
      throw new ForbiddenException(
        `No puedes ${verb} una cuenta de la plataforma (super-administrador)`,
      );
    }
    // Corrección P5 (cyber N1): jerarquía también al borrar, deshabilitar y
    // habilitar (un Desarrollador no deshabilita al Administrador).
    this.assertActorOutranks(target, actor);
  }
}
