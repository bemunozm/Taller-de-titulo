import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { Role } from '../roles/entities/role.entity';
import { CreateCondominiumDto } from './dto/create-condominium.dto';
import { CreateCondominiumMemberDto } from './dto/create-condominium-member.dto';
import type { TenantActor } from '../common/tenant/tenant-actor';
import {
  assertPlatformSuperAdmin,
  requireOrganizationId,
} from '../common/tenant/tenant-context.util';
import {
  OrganizationMembershipService,
  type OrganizationSummary,
} from '../organization-membership/organization-membership.service';

/** Nombre del rol app-side que se asigna al owner de un condominio recién creado. */
const CONDOMINIUM_ADMIN_ROLE = 'Administrador';

/**
 * Onboarding / creación de cuentas en cascada (Fase 0, tarea #19 —
 * docs/modulos/auth-multitenant.md §7b):
 *
 *   Plataforma (super-admin)
 *     └─ crea el Condominio (organization) + su Administrador (owner)
 *           └─ el Admin del condominio crea/da de alta a SUS usuarios
 *                 (residentes, conserjes) DENTRO de su organization
 *
 * Camino elegido — creación DIRECTA server-side, NO el flujo de invitación
 * nativo (`organization.inviteMember`): `rut`/`phone` son additionalFields
 * REQUERIDOS del `user` de better-auth (tarea #16) y la aceptación de
 * invitación nativa solo le pide una contraseña al invitado.
 *
 * Fase 4 · P5 (D11): las membresías se crean con
 * `OrganizationMembershipService`, y si fallan se COMPENSA (se borra la cuenta
 * recién creada): ya no quedan usuarios huérfanos sin condominio. El email de
 * activación sale recién cuando la cuenta quedó en su condominio.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly membershipService: OrganizationMembershipService,
  ) {}

  /**
   * `GET /onboarding/condominiums` (Fase 4 · P5.C): `{ id, name, slug }` de
   * todos los condominios, para el selector del super-admin al crear
   * usuarios (y recursos con `organizationId`). Además del permiso
   * `platform.manage-organizations` de la ruta, exige explícitamente al
   * super-admin (P5 · D10).
   */
  async listCondominiums(actor: TenantActor): Promise<OrganizationSummary[]> {
    assertPlatformSuperAdmin(
      actor,
      'Solo la plataforma (super-admin) puede listar los condominios',
    );
    return this.membershipService.listOrganizations();
  }

  /**
   * Endpoint super-admin: crea un condominio (organization) + su
   * Administrador (owner). Además del permiso `platform.manage-organizations`
   * de la ruta, exige explícitamente al super-admin (P5 · D10).
   */
  async createCondominium(dto: CreateCondominiumDto, actor: TenantActor) {
    assertPlatformSuperAdmin(
      actor,
      'Solo la plataforma (super-admin) puede crear condominios',
    );

    const adminRole = await this.roleRepository.findOne({
      where: { name: CONDOMINIUM_ADMIN_ROLE },
    });
    if (!adminRole) {
      // No debería pasar: DataInitializationService siembra este rol al bootear.
      throw new InternalServerErrorException(
        `Rol "${CONDOMINIUM_ADMIN_ROLE}" no está configurado en el sistema`,
      );
    }

    const slug = dto.slug?.trim() || this.slugify(dto.name);
    // Antes de crear nada: el caso común de conflicto no deja ni una cuenta
    // creada y borrada.
    if (await this.membershipService.isSlugTaken(slug)) {
      throw new ConflictException(
        `Ya existe un condominio con el slug "${slug}"`,
      );
    }

    // 1. El usuario Administrador, todavía sin condominio ni email.
    const adminUser = await this.usersService.provisionAccount(
      {
        rut: dto.admin.rut,
        name: dto.admin.name,
        email: dto.admin.email,
        phone: dto.admin.phone,
        age: dto.admin.age,
      },
      [adminRole],
      null,
    );

    // 2. La organización con el admin como owner (better-auth crea su
    // membresía). Server-side + `userId` explícito: no pasa por
    // `allowUserToCreateOrganization` (ver src/auth/better-auth.ts).
    let organization: Awaited<
      ReturnType<OrganizationMembershipService['createOrganization']>
    >;
    try {
      organization = await this.membershipService.createOrganization({
        name: dto.name,
        slug,
        ownerUserId: adminUser.id,
      });
    } catch (error) {
      this.logger.error(
        `Error creando el condominio "${dto.name}" (slug="${slug}"); se revierte la cuenta del administrador`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.usersService.discardProvisionedAccount(adminUser.id);
      throw new BadRequestException(
        `No fue posible crear el condominio "${dto.name}" — el slug "${slug}" podría estar en uso.`,
      );
    }

    // 3. Recién ahora, el email de activación.
    await this.usersService.sendActivationEmail(adminUser);

    this.logger.log(
      `Condominio "${dto.name}" creado (org=${organization?.id}) con admin ${adminUser.id}`,
    );

    return {
      organization,
      admin: this.sanitizeUser(adminUser),
    };
  }

  /**
   * Endpoint admin-de-condominio: crea/da de alta un usuario (residente,
   * conserje) DENTRO de SU organización. El `organizationId` sale de la
   * membresía del caller (nunca del body). Pasa por el mismo camino que
   * `POST /users/create-by-admin`: `RoleAssignmentPolicy`, familia del
   * condominio y membresía con compensación.
   */
  async createCondominiumMember(
    dto: CreateCondominiumMemberDto,
    actor: TenantActor,
  ) {
    // 403 si el caller es super-admin (sin organización propia: usa
    // `POST /users/create-by-admin` con `organizationId`) o si no pertenece a
    // ningún condominio todavía.
    const organizationId = requireOrganizationId(actor);

    const member = await this.usersService.createAccountByAdmin(
      {
        rut: dto.rut,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        age: dto.age,
        roleIds: dto.roleIds,
        familyId: dto.familyId,
      },
      actor,
    );

    this.logger.log(
      `Usuario ${member.id} agregado al condominio ${organizationId}`,
    );

    return this.sanitizeUser(member);
  }

  /** No reexponer roles/family completos innecesariamente en la respuesta del onboarding. */
  private sanitizeUser(user: {
    id: string;
    name: string;
    email: string;
    // Fase 4 · P7.R: nullable en la entidad (solo cuentas anonimizadas).
    rut: string | null;
    phone: string | null;
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      rut: user.rut,
      phone: user.phone,
    };
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 140);
  }
}
