import type { E2eHttpClient } from './support/http-client';
import {
  arrayAt,
  asObject,
  ensureStatus,
  isJsonObject,
  stringAt,
  type JsonObject,
} from './support/json';
import {
  API,
  E2eScenario,
  type E2eActor,
  type E2eCamera,
  type E2eCondominium,
} from './support/scenario';
import { randomPlate } from './support/test-data';

/**
 * Pasadas de vehículos por HTTP (plan dirección + pasadas multicámara, E6):
 * el advisory lock, el índice único y la exposición de `passage` contra la
 * app compilada y una BD real. Cada caso usa su propia patente.
 *
 * La fuente de la dirección que declara el worker se valida contra la
 * configuración de la cámara: `line` exige `directionLine` y `camera` una
 * dirección fija. Por eso cada cámara se configura antes (ver `configure`).
 * La reversa por línea necesita 15 s desde el inicio de la pasada
 * (LPR_PASSAGE_REVERSE_MIN_SECONDS): sus casos con espera están cubiertos en la
 * integración (`vehicle-passages.integration.spec.ts`).
 */
const LINE = {
  from: { x: 0.1, y: 0.5 },
  to: { x: 0.9, y: 0.5 },
  exitSide: 'left',
};

describe('POST /detections/plates — pasadas multicámara (e2e)', () => {
  let scenario: E2eScenario;
  let condominium: E2eCondominium;
  let resident: E2eActor;
  let cameraA: E2eCamera;
  let cameraB: E2eCamera;
  let lpr: E2eHttpClient;

  beforeAll(async () => {
    scenario = await E2eScenario.start();
    condominium = await scenario.createCondominium('Pasadas');
    const household = await scenario.createHousehold(
      condominium.admin,
      'pasadas',
    );
    resident = await scenario.createMember(condominium.admin, {
      label: 'Residente pasadas',
      roles: ['Residente'],
      familyId: household.familyId,
    });
    cameraA = await scenario.createCamera(condominium.admin, 'Pasadas A');
    cameraB = await scenario.createCamera(condominium.admin, 'Pasadas B');
    await configure(cameraA, { directionLine: LINE });
    await configure(cameraB, { directionLine: LINE });
    lpr = scenario.lprClient(
      await scenario.createServiceApiKey(condominium.admin),
    );
  });

  async function configure(
    camera: E2eCamera,
    settings: Record<string, unknown>,
  ): Promise<void> {
    ensureStatus(
      await condominium.admin.http.patch(
        `${API}/cameras/${camera.id}/lpr-settings`,
        settings,
      ),
      [200],
      'configurar la cámara',
    );
  }

  async function registerResidentVehicle(plate: string): Promise<void> {
    ensureStatus(
      await condominium.admin.http.post(`${API}/vehicles`, {
        plate,
        ownerId: resident.id,
        accessLevel: 'residente',
        vehicleType: 'auto',
      }),
      [201],
      'registrar el vehículo del residente',
    );
  }

  function ingest(
    cameraId: string,
    plate: string,
    direction?: { direction: string; direction_source: string },
  ) {
    return lpr.post(`${API}/detections/plates`, {
      cameraId,
      plate,
      plate_raw: plate,
      det_confidence: 0.97,
      ocr_confidence: 0.95,
      detectionTimestamp: Date.now(),
      ...(direction ? { meta: direction } : {}),
    });
  }

  /** Intentos de la patente, tal como los ve la trazabilidad. */
  async function attemptsOf(plate: string): Promise<JsonObject[]> {
    const response = ensureStatus(
      await condominium.admin.http.get(`${API}/detections/plates/attempts`),
      [200],
      'listar los intentos de acceso',
    );
    if (!Array.isArray(response.json)) {
      throw new Error('attempts: se esperaba un arreglo');
    }
    return response.json.filter(
      (entry): entry is JsonObject =>
        isJsonObject(entry) &&
        isJsonObject(entry.detection) &&
        entry.detection.plate === plate,
    );
  }

  it('10 POST simultáneos de un residente desde dos cámaras -> UN intento Permitido con las 10 lecturas como evidencia', async () => {
    const plate = randomPlate();
    await registerResidentVehicle(plate);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        ingest((index % 2 === 0 ? cameraA : cameraB).id, plate, {
          direction: 'entry',
          direction_source: 'line',
        }),
      ),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
    const leaders = responses.filter(
      (response) =>
        isJsonObject(response.json) && response.json.deduplicated === false,
    );
    expect(leaders).toHaveLength(1);

    const attempts = await attemptsOf(plate);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].decision).toBe('Permitido');
    const passage = asObject(attempts[0].passage, 'passage');
    expect(passage.direction).toBe('entry');
    expect(passage.directionSource).toBe('line');
    expect(passage.sightingCount).toBe(10);
    const sightings = arrayAt(passage, 'sightings', 'passage');
    expect(sightings).toHaveLength(10);
    const cameras = new Set(
      sightings.map((sighting) => stringAt(sighting, 'cameraId', 'sighting')),
    );
    expect(cameras).toEqual(new Set([cameraA.id, cameraB.id]));
  });

  it('la forma de passage y de cada lectura es la del contrato', async () => {
    const plate = randomPlate();
    await registerResidentVehicle(plate);
    await ingest(cameraA.id, plate, {
      direction: 'exit',
      direction_source: 'line',
    });

    const [attempt] = await attemptsOf(plate);
    const passage = asObject(attempt.passage, 'passage');

    expect(Object.keys(passage).sort()).toEqual(
      [
        'direction',
        'directionSource',
        'firstSeenAt',
        'id',
        'lastSeenAt',
        'sightingCount',
        'sightings',
      ].sort(),
    );
    const [sighting] = arrayAt(passage, 'sightings', 'passage');
    expect(Object.keys(asObject(sighting, 'sighting')).sort()).toEqual(
      [
        'at',
        'cameraId',
        'detectionId',
        'direction',
        'directionSource',
        'full_frame_path',
        'snapshot_jpeg_b64',
      ].sort(),
    );
    expect(attempt.method).toBe('Patente - Salida');
  });

  it('la lectura de la segunda cámara es evidencia: responde deduplicated con la pasada y el intento original', async () => {
    const plate = randomPlate();
    await registerResidentVehicle(plate);
    await ingest(cameraA.id, plate, {
      direction: 'entry',
      direction_source: 'line',
    });

    const second = await ingest(cameraB.id, plate, {
      direction: 'unknown',
      direction_source: 'none',
    });

    expect(second.status).toBe(201);
    const body = asObject(second.json, 'respuesta');
    expect(body.deduplicated).toBe(true);
    expect(asObject(body.passage, 'passage').sightingCount).toBe(2);
    expect(asObject(body.attempt, 'attempt').decision).toBe('Permitido');
    await expect(attemptsOf(plate)).resolves.toHaveLength(1);
  });

  it('una dirección contraria por línea dentro de la brecha mínima de reversa es evidencia: una pasada, una apertura', async () => {
    const plate = randomPlate();
    await registerResidentVehicle(plate);

    await ingest(cameraA.id, plate, {
      direction: 'entry',
      direction_source: 'line',
    });
    await ingest(cameraB.id, plate, {
      direction: 'exit',
      direction_source: 'line',
    });

    const attempts = await attemptsOf(plate);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].method).toBe('Patente - Entrada');
  });

  it('cámaras fijas de entrada y de salida: el auto que entra y es visto por la de salida no genera otra pasada', async () => {
    const entryCamera = await scenario.createCamera(
      condominium.admin,
      'Pasadas fija entrada',
    );
    const exitCamera = await scenario.createCamera(
      condominium.admin,
      'Pasadas fija salida',
    );
    await configure(entryCamera, { direction: 'entry' });
    await configure(exitCamera, { direction: 'exit' });
    const plate = randomPlate();
    await registerResidentVehicle(plate);

    await ingest(entryCamera.id, plate, {
      direction: 'entry',
      direction_source: 'camera',
    });
    await ingest(exitCamera.id, plate, {
      direction: 'exit',
      direction_source: 'camera',
    });

    const attempts = await attemptsOf(plate);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].decision).toBe('Permitido');
    expect(attempts[0].method).toBe('Patente - Entrada');
  });

  it('una fuente sin respaldo en la cámara (line sin directionLine) se degrada y no parte la pasada', async () => {
    const bareCamera = await scenario.createCamera(
      condominium.admin,
      'Pasadas sin linea',
    );
    const plate = randomPlate();
    await registerResidentVehicle(plate);

    await ingest(cameraA.id, plate, {
      direction: 'entry',
      direction_source: 'line',
    });
    await ingest(bareCamera.id, plate, {
      direction: 'exit',
      direction_source: 'line',
    });

    const [attempt] = await attemptsOf(plate);
    const passage = asObject(attempt.passage, 'passage');
    expect(passage.direction).toBe('entry');
    expect(passage.sightingCount).toBe(2);
    const sources = arrayAt(passage, 'sightings', 'passage').map((sighting) =>
      stringAt(sighting, 'directionSource', 'sighting'),
    );
    expect(sources.sort()).toEqual(['line', 'width']);
  });

  it('registro -> acceso: la cámara de acceso promueve la pasada y el intento Registrado pasa a la decisión de acceso', async () => {
    const registerCamera = await scenario.createCamera(
      condominium.admin,
      'Pasadas promocion',
    );
    await configure(registerCamera, {
      action: 'register',
      directionLine: LINE,
    });
    const plate = randomPlate();
    await registerResidentVehicle(plate);

    await ingest(registerCamera.id, plate, {
      direction: 'exit',
      direction_source: 'line',
    });
    const [registered] = await attemptsOf(plate);
    expect(registered.decision).toBe('Registrado');

    await ingest(cameraA.id, plate, {
      direction: 'exit',
      direction_source: 'line',
    });

    const attempts = await attemptsOf(plate);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].id).toBe(registered.id);
    expect(attempts[0].decision).toBe('Permitido');
    expect(attempts[0].method).toBe('Patente - Salida');
    expect(asObject(attempts[0].passage, 'passage').sightingCount).toBe(2);
  });

  it('acceso -> registro: la cámara de solo registro es evidencia y no pisa la decisión', async () => {
    const registerCamera = await scenario.createCamera(
      condominium.admin,
      'Pasadas registro tardio',
    );
    await configure(registerCamera, {
      action: 'register',
      directionLine: LINE,
    });
    const plate = randomPlate();
    await registerResidentVehicle(plate);

    await ingest(cameraA.id, plate, {
      direction: 'entry',
      direction_source: 'line',
    });
    await ingest(registerCamera.id, plate, {
      direction: 'entry',
      direction_source: 'line',
    });

    const attempts = await attemptsOf(plate);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].decision).toBe('Permitido');
  });

  it('una fuente de mayor prioridad corrige la dirección de la pasada y el método del intento', async () => {
    const plate = randomPlate();
    await registerResidentVehicle(plate);
    await ingest(cameraA.id, plate, {
      direction: 'entry',
      direction_source: 'width',
    });

    await ingest(cameraB.id, plate, {
      direction: 'exit',
      direction_source: 'line',
    });

    const [attempt] = await attemptsOf(plate);
    expect(attempt.method).toBe('Patente - Salida');
    const passage = asObject(attempt.passage, 'passage');
    expect(passage.direction).toBe('exit');
    expect(passage.directionSource).toBe('line');
  });

  it('patente desconocida desde varias cámaras a la vez -> un solo Pendiente para el conserje', async () => {
    const plate = randomPlate();

    await Promise.all(
      [cameraA, cameraB, cameraA, cameraB].map((camera) =>
        ingest(camera.id, plate),
      ),
    );

    const attempts = await attemptsOf(plate);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].decision).toBe('Pendiente');
    const pending = ensureStatus(
      await condominium.admin.http.get(`${API}/detections/pending`),
      [200],
      'listar pendientes',
    );
    const mine = Array.isArray(pending.json)
      ? pending.json.filter(
          (entry) =>
            isJsonObject(entry) &&
            isJsonObject(entry.detection) &&
            entry.detection.plate === plate,
        )
      : [];
    expect(mine).toHaveLength(1);
  });

  it('cámara de solo registro: lecturas simultáneas -> un único intento Registrado', async () => {
    const registerCamera = await scenario.createCamera(
      condominium.admin,
      'Pasadas registro',
    );
    ensureStatus(
      await condominium.admin.http.patch(
        `${API}/cameras/${registerCamera.id}/lpr-settings`,
        { action: 'register', direction: 'both', directionLine: LINE },
      ),
      [200],
      'configurar la cámara en solo registro',
    );
    const plate = randomPlate();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        ingest(registerCamera.id, plate, {
          direction: 'exit',
          direction_source: 'line',
        }),
      ),
    );

    const attempts = await attemptsOf(plate);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].decision).toBe('Registrado');
    expect(attempts[0].method).toBe('Patente - Salida');
  });

  it('el worker puede mandar direction_source y track.vehicle_id; un valor inválido responde 400', async () => {
    const plate = randomPlate();

    const ok = await ingest(cameraA.id, plate, {
      direction: 'entry',
      direction_source: 'line',
    });
    expect(ok.status).toBe(201);

    const invalid = await lpr.post(`${API}/detections/plates`, {
      cameraId: cameraA.id,
      plate: randomPlate(),
      meta: { direction: 'entry', direction_source: 'gps' },
    });
    expect(invalid.status).toBe(400);

    const withTrack = await lpr.post(`${API}/detections/plates`, {
      cameraId: cameraA.id,
      plate: randomPlate(),
      meta: {
        direction: 'unknown',
        direction_source: 'none',
        track: { id: 1, reads: 3, votes: 3, winner_share: 1, vehicle_id: 12 },
      },
    });
    expect(withTrack.status).toBe(201);
  });
});
