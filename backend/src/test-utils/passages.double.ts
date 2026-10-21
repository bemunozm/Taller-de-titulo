import type { AccessAttempt } from '../detections/entities/access-attempt.entity';
import type { PlateDetection } from '../detections/entities/plate-detection.entity';
import type { VehiclePassage } from '../detections/entities/vehicle-passage.entity';
import type { DirectionReading } from '../detections/vehicle-passage-direction';
import type {
  ClaimAccess,
  PassageClaim,
  PassageSummary,
  SaveAttemptOptions,
  SaveAttemptResult,
  VehiclePassagesService,
} from '../detections/vehicle-passages.service';

/**
 * Doble de `VehiclePassagesService` para los tests unitarios de
 * `DetectionsService` que NO ejercitan las pasadas: cada lectura es el
 * "líder" de una pasada nueva (el flujo de decisión corre completo), la
 * detección y el intento se guardan con los repositorios mock del test y la
 * dirección del intento sale de la lectura, como en el servicio real.
 */
export interface PassagesDouble {
  claim: jest.Mock<
    Promise<PassageClaim>,
    [PlateDetection, DirectionReading, ClaimAccess]
  >;
  saveAttempt: jest.Mock<
    Promise<SaveAttemptResult>,
    [AccessAttempt, VehiclePassage, SaveAttemptOptions]
  >;
  release: jest.Mock<Promise<void>, [VehiclePassage]>;
  demote: jest.Mock<Promise<void>, [VehiclePassage]>;
  summarize: jest.Mock<PassageSummary, [VehiclePassage]>;
  attachPassages: jest.Mock<Promise<AccessAttempt[]>, [AccessAttempt[]]>;
}

export interface PassagesDoubleRepos {
  saveDetection?: (detection: PlateDetection) => Promise<PlateDetection>;
  saveAttempt?: (attempt: AccessAttempt) => Promise<AccessAttempt>;
}

export const TEST_PASSAGE_ID = 'passage-1';

export function createPassagesDouble(
  repos: PassagesDoubleRepos = {},
): PassagesDouble {
  const saveDetection =
    repos.saveDetection ?? ((detection) => Promise.resolve(detection));
  const saveAttempt =
    repos.saveAttempt ?? ((attempt) => Promise.resolve(attempt));
  return {
    claim: jest.fn(async (detection, reading, access) => {
      const saved = await saveDetection(detection);
      const now = new Date();
      const passage = {
        id: TEST_PASSAGE_ID,
        organizationId: detection.organizationId ?? '',
        plate: detection.plate,
        direction: reading.direction,
        directionSource: reading.source,
        firstSeenAt: now,
        lastSeenAt: now,
        sightingCount: 1,
        decidesAccess: access.decidesAccess,
        leaderClaimedAt: now,
        leaderToken: 'token-1',
        methodFollowsDirection: false,
      } as VehiclePassage;
      return {
        kind: 'leader' as const,
        detection: saved,
        passage,
        promoted: false,
      };
    }),
    saveAttempt: jest.fn<
      Promise<SaveAttemptResult>,
      [AccessAttempt, VehiclePassage, SaveAttemptOptions]
    >(async (attempt, passage) => {
      attempt.passageId = passage.id;
      return { attempt: await saveAttempt(attempt), written: true };
    }),
    release: jest.fn<Promise<void>, [VehiclePassage]>(() => Promise.resolve()),
    demote: jest.fn<Promise<void>, [VehiclePassage]>(() => Promise.resolve()),
    summarize: jest.fn((passage) => ({
      id: passage.id,
      direction: passage.direction,
      directionSource: passage.directionSource,
      firstSeenAt: passage.firstSeenAt.toISOString(),
      lastSeenAt: passage.lastSeenAt.toISOString(),
      sightingCount: passage.sightingCount,
    })),
    attachPassages: jest.fn((attempts) => Promise.resolve(attempts)),
  };
}

export function asPassagesService(
  double: PassagesDouble,
): VehiclePassagesService {
  return double as unknown as VehiclePassagesService;
}
