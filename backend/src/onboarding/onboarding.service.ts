import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { auth } from '../auth/better-auth';
import { UsersService } from '../users/users.service';
import { Role } from '../roles/entities/role.entity';
import { CreateCondominiumDto } from './dto/create-condominium.dto';
import { CreateCondominiumMemberDto } from './dto/create-condominium-member.dto';
import { TenantContextService } from '../common/tenant/tenant-context.service';

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
 * Camino elegido — creación DIRECTA server-side (`UsersService.
 * createAccountByAdmin` + `auth.api.addMember`), NO el flujo de invitación
 * nativo (`organization.inviteMember`): `rut`/`phone` son additionalFields
 * REQUERIDOS del `user` de better-auth (tarea #16) y la aceptación de
 * invitación nativa solo le pide una contraseña al invitado — no hay forma de
 * que complete esos campos ahí. `createAccountByAdmin` ya dispara el email de
 * activación (`requestPasswordReset`, tarea #18) reusando el mismo flujo.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    // Tipado explícito con `typeof auth` (a diferencia de auth.guard.ts /
    // users.service.ts, que solo usan `getSession`/`requestPasswordReset` —
    // parte del tipo base `AuthService` sin genéricos) para que TypeScript
    // conozca los endpoints del plugin `organization` (`createOrganization`,
    // `addMember`), que NO están en el tipo base (ver
    // AuthService<T extends {api:...} = Auth$1> en
    // @thallesp/nestjs-better-auth). Los genéricos se borran en runtime — la
    // inyección de dependencias sigue resolviendo la MISMA instancia global.
    private readonly betterAuthService: BetterAuthService<typeof auth>,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Endpoint super-admin: crea un condominio (organization) + su
   * Administrador (owner). Restringido por permiso
   * `platform.manage-organizations` (solo Super Administrador) a nivel de
   * controller — ver OnboardingController.
   */
  async createCondominium(dto: CreateCondominiumDto) {
    const adminRole = await this.roleRepository.findOne({ where: { name: CONDOMINIUM_ADMIN_ROLE } });
    if (!adminRole) {
      // No debería pasar: DataInitializationService siembra este rol al bootear.
      throw new InternalServerErrorException(
        `Rol "${CONDOMINIUM_ADMIN_ROLE}" no está configurado en el sistema`,
      );
    }

    // 1. Crear el usuario Administrador (dispara el email de activación —
    // ver docstring de la clase).
    const adminUser = await this.usersService.createAccountByAdmin({
      rut: dto.admin.rut,
      name: dto.admin.name,
      email: dto.admin.email,
      phone: dto.admin.phone,
      age: dto.admin.age,
      roleIds: [adminRole.id],
    });

    // 2. Crear la organización con el admin como owner. Server-side +
    // `userId` explícito: NO pasa por `allowUserToCreateOrganization`
    // (ver docstring en src/auth/better-auth.ts) — solo alcanzable desde este
    // endpoint admin-only.
    const slug = dto.slug?.trim() || this.slugify(dto.name);
    let organization;
    try {
      organization = await this.betterAuthService.api.createOrganization({
        body: {
          name: dto.name,
          slug,
          userId: adminUser.id,
        },
      });
    } catch (error) {
      this.logger.error(`Error creando organización "${dto.name}" (slug="${slug}"):`, error);
      throw new BadRequestException(
        `No fue posible crear el condominio "${dto.name}" — el slug "${slug}" podría estar en uso.`,
      );
    }

    this.logger.log(`✅ Condominio "${dto.name}" creado (org=${organization?.id}) con admin ${adminUser.email}`);

    return {
      organization,
      admin: this.sanitizeUser(adminUser),
    };
  }

  /**
   * Endpoint admin-de-condominio: crea/da de alta un usuario (residente,
   * conserje) DENTRO de SU organización. El `organizationId` se resuelve
   * desde la membresía del caller (nunca lo elige el body) — así un admin
   * jamás puede dar de alta usuarios en un condominio ajeno.
   */
  async createCondominiumMember(dto: CreateCondominiumMemberDto) {
    // Lanza ForbiddenException si el caller es super-admin (sin organización
    // propia) o si no pertenece a ningún condominio todavía.
    const organizationId = await this.tenantContext.requireOrganizationId();

    const member = await this.usersService.createAccountByAdmin({
      rut: dto.rut,
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      age: dto.age,
      roleIds: dto.roleIds,
      familyId: dto.familyId,
    });

    try {
      await this.betterAuthService.api.addMember({
        body: {
          userId: member.id,
          role: 'member',
          organizationId,
        },
      });
    } catch (error) {
      this.logger.error(`Error agregando membresía de organización para ${member.email}:`, error);
      throw new InternalServerErrorException(
        'El usuario se creó pero no fue posible asociarlo al condominio. Contacta a soporte.',
      );
    }

    this.logger.log(`✅ Usuario ${member.email} agregado al condominio ${organizationId}`);

    return this.sanitizeUser(member);
  }

  /** No reexponer roles/family completos innecesariamente en la respuesta del onboarding. */
  private sanitizeUser(user: { id: string; name: string; email: string; rut: string; phone: string }) {
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
