import { asObject, stringAt } from './support/json';
import {
  API,
  E2eScenario,
  type E2eActor,
  type E2eCamera,
  type E2eCondominium,
  type E2eHousehold,
} from './support/scenario';
import { randomPhone, randomRut, uniqueEmail } from './support/test-data';

/**
 * Aislamiento entre condominios y escalamiento de roles (Fase 4 · P8; reglas
 * de la P5): el admin del condominio A no ve ni toca recursos de B (404, sin
 * revelar que existen) y nadie fuera de la plataforma otorga "Super
 * Administrador" (403). Cada caso tiene su control positivo.
 */
describe('Aislamiento entre condominios (e2e)', () => {
  let scenario: E2eScenario;
  let condominiumA: E2eCondominium;
  let condominiumB: E2eCondominium;
  let residentA: E2eActor;
  let residentB: E2eActor;
  let cameraB: E2eCamera;
  let householdA: E2eHousehold;

  beforeAll(async () => {
    scenario = await E2eScenario.start();
    condominiumA = await scenario.createCondominium('Aislamiento A');
    condominiumB = await scenario.createCondominium('Aislamiento B');
    householdA = await scenario.createHousehold(condominiumA.admin, 'A');
    const householdB = await scenario.createHousehold(condominiumB.admin, 'B');
    residentA = await scenario.createMember(condominiumA.admin, {
      label: 'Residente A',
      roles: ['Residente'],
      familyId: householdA.familyId,
    });
    residentB = await scenario.createMember(condominiumB.admin, {
      label: 'Residente B',
      roles: ['Residente'],
      familyId: householdB.familyId,
    });
    cameraB = await scenario.createCamera(condominiumB.admin, 'B');
  });

  function roleNamesOf(user: unknown): string[] {
    const roles = asObject(user, 'usuario').roles;
    return Array.isArray(roles)
      ? roles.map((role) => stringAt(role, 'name', 'rol'))
      : [];
  }

  describe('usuarios', () => {
    it('el admin de A no lee un usuario de B (404); el admin de B sí', async () => {
      const foreign = await condominiumA.admin.http.get(
        `${API}/users/${residentB.id}`,
      );
      const own = await condominiumB.admin.http.get(
        `${API}/users/${residentB.id}`,
      );

      expect(foreign.status).toBe(404);
      expect(own.status).toBe(200);
      expect(stringAt(own.json, 'id', 'usuario')).toBe(residentB.id);
    });

    it('el admin de A no edita un usuario de B (404) y el usuario queda igual', async () => {
      const response = await condominiumA.admin.http.patch(
        `${API}/users/${residentB.id}`,
        { name: 'Editado por otro condominio' },
      );

      expect(response.status).toBe(404);
      const after = await condominiumB.admin.http.get(
        `${API}/users/${residentB.id}`,
      );
      expect(after.status).toBe(200);
      expect(stringAt(after.json, 'name', 'usuario')).toBe(residentB.name);
    });

    it('el admin de A no asigna "Super Administrador" a un usuario de su condominio (403)', async () => {
      const residentRoleId = await scenario.roleId('Residente');
      const superAdminRoleId = await scenario.roleId('Super Administrador');

      const response = await condominiumA.admin.http.patch(
        `${API}/users/${residentA.id}`,
        { roleIds: [residentRoleId, superAdminRoleId] },
      );

      expect(response.status).toBe(403);
      const after = await condominiumA.admin.http.get(
        `${API}/users/${residentA.id}`,
      );
      expect(after.status).toBe(200);
      expect(roleNamesOf(after.json)).not.toContain('Super Administrador');
    });

    it('el admin de A no crea una cuenta con "Super Administrador" (403)', async () => {
      const superAdminRoleId = await scenario.roleId('Super Administrador');

      const response = await condominiumA.admin.http.post(
        `${API}/users/create-by-admin`,
        {
          rut: randomRut(),
          name: 'Intento de escalamiento',
          email: uniqueEmail('escalamiento'),
          phone: randomPhone(),
          age: 30,
          roleIds: [superAdminRoleId],
        },
      );

      expect(response.status).toBe(403);
    });

    it('control de la política: el admin de A asigna "Conserje" (200), pero no "Super Administrador" (403)', async () => {
      const resident = await scenario.createMember(condominiumA.admin, {
        label: 'Residente promovido A',
        roles: ['Residente'],
        familyId: householdA.familyId,
      });
      const residentRoleId = await scenario.roleId('Residente');
      const conciergeRoleId = await scenario.roleId('Conserje');
      const superAdminRoleId = await scenario.roleId('Super Administrador');
      const path = `${API}/users/${resident.id}`;

      // Asignación permitida: prueba que el 403 de abajo lo da la política
      // (RoleAssignmentPolicy) y no un rechazo a toda asignación de roles.
      const allowed = await condominiumA.admin.http.patch(path, {
        roleIds: [residentRoleId, conciergeRoleId],
      });
      const escalation = await condominiumA.admin.http.patch(path, {
        roleIds: [residentRoleId, conciergeRoleId, superAdminRoleId],
      });

      expect(allowed.status).toBe(200);
      expect(escalation.status).toBe(403);
      const after = await condominiumA.admin.http.get(path);
      expect(after.status).toBe(200);
      const roles = roleNamesOf(after.json);
      expect(roles).toEqual(expect.arrayContaining(['Residente', 'Conserje']));
      expect(roles).not.toContain('Super Administrador');
    });

    // El 403 aquí lo da el AuthorizationGuard: el Residente no tiene
    // `users.update`. La política de roles se cubre en el control anterior.
    it('un residente no se otorga "Super Administrador" a sí mismo', async () => {
      const superAdminRoleId = await scenario.roleId('Super Administrador');

      const response = await residentA.http.patch(
        `${API}/users/${residentA.id}`,
        { roleIds: [superAdminRoleId] },
      );

      expect(response.status).toBe(403);
    });
  });

  describe('cámaras', () => {
    it('GET /cameras/:id/source de otro condominio responde 404; el dueño la lee', async () => {
      const foreign = await condominiumA.admin.http.get(
        `${API}/cameras/${cameraB.id}/source`,
      );
      const own = await condominiumB.admin.http.get(
        `${API}/cameras/${cameraB.id}/source`,
      );

      expect(foreign.status).toBe(404);
      expect(foreign.text).not.toContain(cameraB.sourceUrl);
      expect(own.status).toBe(200);
      expect(stringAt(own.json, 'sourceUrl', 'source')).toBe(cameraB.sourceUrl);
    });
  });
});
