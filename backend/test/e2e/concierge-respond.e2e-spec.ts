import {
  conciergePath,
  requestVisitThroughConcierge,
  visitStatus,
  type ConciergeVisitRequest,
} from './support/concierge';
import { asObject } from './support/json';
import {
  E2eScenario,
  type E2eActor,
  type E2eCondominium,
  type E2eHousehold,
  type E2eHub,
} from './support/scenario';
import { uniqueSuffix } from './support/test-data';

/**
 * `/respond` de punta a punta (Fase 4 · P8; reglas de la P4): solo una sesión
 * humana responde, y solo el residente notificado (o quien tiene
 * `digital-concierge.manage` en el condominio). Cada caso crea su propia
 * solicitud por el citófono.
 */
describe('POST /concierge/session/:id/respond (e2e)', () => {
  let scenario: E2eScenario;
  let condominium: E2eCondominium;
  let household: E2eHousehold;
  let notifiedResident: E2eActor;
  let neighbor: E2eActor;

  beforeAll(async () => {
    scenario = await E2eScenario.start();
    condominium = await scenario.createCondominium('Respond');
    household = await scenario.createHousehold(condominium.admin, 'notificada');
    const neighborHousehold = await scenario.createHousehold(
      condominium.admin,
      'vecina',
    );
    notifiedResident = await scenario.createMember(condominium.admin, {
      label: 'Residente notificado',
      roles: ['Residente'],
      familyId: household.familyId,
    });
    neighbor = await scenario.createMember(condominium.admin, {
      label: 'Vecino',
      roles: ['Residente'],
      familyId: neighborHousehold.familyId,
    });
  });

  /**
   * Solicitud nueva por un hub propio del caso: los rate limits del citófono
   * son por dispositivo, así un caso no consume el cupo de otro.
   */
  async function requestVisit(): Promise<
    ConciergeVisitRequest & { hub: E2eHub }
  > {
    const hub = await scenario.createHub(condominium.id);
    const request = await requestVisitThroughConcierge({
      hub,
      house: household.house,
      visitorName: `Visita ${uniqueSuffix()}`,
      notifiedResident,
    });
    return { ...request, hub };
  }

  it('la sesión del citófono usa el servidor falso de OpenAI (OPENAI_API_BASE_URL)', async () => {
    const request = await requestVisit();

    expect(request.ephemeralToken).toBe(
      scenario.state.fakeOpenAi.ephemeralToken,
    );
    expect(request.notifiedResidentIds).toContain(notifiedResident.id);
    await expect(scenario.fakeOpenAiRequests()).resolves.toContainEqual({
      method: 'POST',
      path: '/v1/realtime/client_secrets',
      authorized: true,
    });
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'awaiting_approval',
    );
  });

  it('403 a un residente del condominio que no fue notificado, sin resolver la solicitud', async () => {
    const request = await requestVisit();

    const response = await neighbor.http.post(
      conciergePath(request.sessionId, 'respond'),
      { approved: true, visitId: request.visitId },
    );

    expect(response.status).toBe(403);
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'awaiting_approval',
    );
  });

  it('401 con la credencial del hub (sin sesión humana), sin resolver la solicitud', async () => {
    const request = await requestVisit();

    const response = await request.hub.http.post(
      conciergePath(request.sessionId, 'respond'),
      { approved: true, visitId: request.visitId },
    );

    expect(response.status).toBe(401);
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'awaiting_approval',
    );
  });

  it('200 al residente notificado: la visita queda aprobada con el ingreso registrado', async () => {
    const request = await requestVisit();

    const response = await notifiedResident.http.post(
      conciergePath(request.sessionId, 'respond'),
      { approved: true, visitId: request.visitId },
    );

    expect(response.status).toBe(200);
    const body = asObject(response.json, 'respond');
    expect(body.success).toBe(true);
    // Ningún hub físico está conectado por socket en los e2e: la orden de
    // apertura no llega a nadie, así que el acceso NO se informa como abierto.
    expect(body.entryRegistered).toBe(false);
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'active',
    );
  });

  it('409 ante una doble respuesta (la primera manda)', async () => {
    const request = await requestVisit();
    const path = conciergePath(request.sessionId, 'respond');

    const first = await notifiedResident.http.post(path, {
      approved: true,
      visitId: request.visitId,
    });
    const second = await notifiedResident.http.post(path, {
      approved: false,
      visitId: request.visitId,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    await expect(visitStatus(condominium.admin, request.visitId)).resolves.toBe(
      'active',
    );
  });
});
