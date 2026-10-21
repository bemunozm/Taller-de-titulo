import {
  conciergePath,
  reportPlate,
  requestVisitThroughConcierge,
  visitStatus,
} from './support/concierge';
import type { E2eHttpClient } from './support/http-client';
import { ensureStatus, stringAt } from './support/json';
import {
  API,
  E2eScenario,
  type E2eActor,
  type E2eCamera,
  type E2eCondominium,
  type E2eHousehold,
} from './support/scenario';
import { randomPlate, uniqueSuffix } from './support/test-data';

/**
 * Ingesta del LPR contra el modelo de visitas vigente (Fase 4 · P8; máquina
 * de estados de docs/modulos/hardening-pre-piloto.md §3):
 *  - una solicitud del conserje sin aprobar (AWAITING_APPROVAL) no tiene
 *    vehículo: el LPR no la reconoce y escala al conserje, sin abrir;
 *  - una visita pre-aprobada (PENDING) abre y registra el ingreso;
 *  - la visita aprobada por el residente ya registró su ingreso al aprobar:
 *    una lectura dentro de la espera posterior no vuelve a abrir.
 * Cada caso usa su propia patente.
 */
describe('POST /detections/plates — apertura según la visita (e2e)', () => {
  let scenario: E2eScenario;
  let condominium: E2eCondominium;
  let household: E2eHousehold;
  let resident: E2eActor;
  let camera: E2eCamera;
  let lpr: E2eHttpClient;

  beforeAll(async () => {
    scenario = await E2eScenario.start();
    condominium = await scenario.createCondominium('LPR');
    household = await scenario.createHousehold(condominium.admin, 'lpr');
    resident = await scenario.createMember(condominium.admin, {
      label: 'Residente LPR',
      roles: ['Residente'],
      familyId: household.familyId,
    });
    camera = await scenario.createCamera(condominium.admin, 'LPR');
    lpr = scenario.lprClient(
      await scenario.createServiceApiKey(condominium.admin),
    );
  });

  async function conciergeRequestWithPlate(plate: string) {
    return requestVisitThroughConcierge({
      hub: await scenario.createHub(condominium.id),
      house: household.house,
      visitorName: `Visita LPR ${uniqueSuffix()}`,
      plate,
      notifiedResident: resident,
    });
  }

  it('no abre con una solicitud del conserje en AWAITING_APPROVAL: escala al conserje', async () => {
    const plate = randomPlate();
    const request = await conciergeRequestWithPlate(plate);
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'awaiting_approval',
    );

    const result = await reportPlate(lpr, camera.id, plate);

    expect(result.status).toBe(201);
    // "Pendiente" = escala al conserje: no hay apertura ("Permitido").
    expect(result.decision).toBe('Pendiente');
    expect(result.requiresApproval).toBe(true);
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'awaiting_approval',
    );
  });

  it('abre con una visita pre-aprobada (PENDING) y registra el ingreso', async () => {
    const plate = randomPlate();
    const now = Date.now();
    const created = ensureStatus(
      await condominium.admin.http.post(`${API}/visits`, {
        type: 'vehicular',
        visitorName: `Visita programada ${uniqueSuffix()}`,
        vehiclePlate: plate,
        hostId: resident.id,
        validFrom: new Date(now - 60_000).toISOString(),
        validUntil: new Date(now + 2 * 60 * 60_000).toISOString(),
        maxUses: 1,
      }),
      [201],
      'crear la visita pre-aprobada',
    );
    const visitId = stringAt(created.json, 'id', 'visita');
    await expect(visitStatus(condominium.admin, visitId)).resolves.toBe(
      'pending',
    );

    const result = await reportPlate(lpr, camera.id, plate);

    expect(result.status).toBe(201);
    expect(result.decision).toBe('Permitido');
    expect(result.isExit).toBe(false);
    await expect(visitStatus(condominium.admin, visitId)).resolves.toBe(
      'active',
    );
  });

  it('tras la aprobación del residente el LPR no vuelve a abrir (ingreso ya registrado)', async () => {
    const plate = randomPlate();
    const request = await conciergeRequestWithPlate(plate);
    ensureStatus(
      await resident.http.post(conciergePath(request.sessionId, 'respond'), {
        approved: true,
        visitId: request.visitId,
      }),
      [200],
      'aprobar la solicitud',
    );
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'active',
    );

    const result = await reportPlate(lpr, camera.id, plate);

    expect(result.status).toBe(201);
    expect(result.decision).toBe('Duplicado');
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'active',
    );
  });

  describe('cámara en modo solo registro (lprSettings.action = register)', () => {
    let registerCamera: E2eCamera;

    beforeAll(async () => {
      registerCamera = await scenario.createCamera(
        condominium.admin,
        'LPR registro',
      );
      ensureStatus(
        await condominium.admin.http.patch(
          `${API}/cameras/${registerCamera.id}/lpr-settings`,
          { action: 'register', direction: 'both', sampleFps: 8 },
        ),
        [200],
        'configurar la cámara en modo solo registro',
      );
    });

    it('una propiedad desconocida en la configuración responde 400', async () => {
      const response = await condominium.admin.http.patch(
        `${API}/cameras/${registerCamera.id}/lpr-settings`,
        { action: 'register', abrirPorton: true },
      );

      expect(response.status).toBe(400);
    });

    it('el worker lee la configuración con el contrato { cameraId, enableLpr, lprSettings }', async () => {
      const response = ensureStatus(
        await lpr.get(
          `${API}/workers/cameras/${registerCamera.id}/lpr-settings`,
        ),
        [200],
        'leer la configuración LPR como worker',
      );

      expect(response.json).toEqual({
        cameraId: registerCamera.id,
        enableLpr: false,
        lprSettings: { action: 'register', direction: 'both', sampleFps: 8 },
      });
    });

    it('una visita pre-aprobada NO abre ni cambia de estado: queda Registrado', async () => {
      const plate = randomPlate();
      const now = Date.now();
      const created = ensureStatus(
        await condominium.admin.http.post(`${API}/visits`, {
          type: 'vehicular',
          visitorName: `Visita registro ${uniqueSuffix()}`,
          vehiclePlate: plate,
          hostId: resident.id,
          validFrom: new Date(now - 60_000).toISOString(),
          validUntil: new Date(now + 2 * 60 * 60_000).toISOString(),
          maxUses: 1,
        }),
        [201],
        'crear la visita pre-aprobada',
      );
      const visitId = stringAt(created.json, 'id', 'visita');

      const result = await reportPlate(lpr, registerCamera.id, plate);

      expect(result.status).toBe(201);
      expect(result.decision).toBe('Registrado');
      expect(result.requiresApproval).toBe(false);
      await expect(visitStatus(condominium.admin, visitId)).resolves.toBe(
        'pending',
      );
    });
  });

  it('sin API key la ingesta responde 401', async () => {
    const anonymous = scenario.newClient();

    const response = await anonymous.post(`${API}/detections/plates`, {
      cameraId: camera.id,
      plate: randomPlate(),
    });

    expect(response.status).toBe(401);
  });
});
