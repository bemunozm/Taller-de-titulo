import {
  canSplitPassage,
  methodForDirection,
  readDirection,
  shouldUpgradeDirection,
  sourcePriority,
  startsNewPassage,
  verifyReadingSource,
  type DirectionReading,
} from './vehicle-passage-direction';

const reading = (
  direction: DirectionReading['direction'],
  source: DirectionReading['source'],
): DirectionReading => ({ direction, source });

const MIN = 15_000;
const OLD = 20_000;
const FRESH = 5_000;

describe('vehicle-passage-direction', () => {
  describe('sourcePriority', () => {
    it('line > motion > camera > width > none (lo medido gana a lo supuesto)', () => {
      const order = ['line', 'motion', 'camera', 'width', 'none'] as const;
      const priorities = order.map(sourcePriority);

      expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
      expect(new Set(priorities).size).toBe(order.length);
    });

    it('solo line puede partir una pasada (camera es una dirección fija)', () => {
      expect(
        (['camera', 'line', 'motion', 'width', 'none'] as const).filter(
          canSplitPassage,
        ),
      ).toEqual(['line']);
    });
  });

  describe('readDirection', () => {
    it('conserva dirección y fuente informadas', () => {
      expect(readDirection('exit', 'line')).toEqual(reading('exit', 'line'));
    });

    it('sin fuente (worker anterior) una dirección conocida es la más débil: width', () => {
      expect(readDirection('entry', undefined)).toEqual(
        reading('entry', 'width'),
      );
      expect(readDirection('entry', 'none')).toEqual(reading('entry', 'width'));
      expect(readDirection('entry', null)).toEqual(reading('entry', 'width'));
    });

    it('una dirección desconocida o ausente es siempre none, aunque venga una fuente', () => {
      expect(readDirection('unknown', 'line')).toEqual(
        reading('unknown', 'none'),
      );
      expect(readDirection(undefined, 'camera')).toEqual(
        reading('unknown', 'none'),
      );
    });
  });

  describe('startsNewPassage', () => {
    it('opuestas, AMBAS por línea y pasada la brecha mínima -> pasada nueva', () => {
      expect(
        startsNewPassage(
          reading('entry', 'line'),
          reading('exit', 'line'),
          OLD,
          MIN,
        ),
      ).toBe(true);
      expect(
        startsNewPassage(
          reading('entry', 'line'),
          reading('exit', 'line'),
          MIN,
          MIN,
        ),
      ).toBe(true);
    });

    it('opuestas por línea pero antes de la brecha mínima -> evidencia', () => {
      expect(
        startsNewPassage(
          reading('entry', 'line'),
          reading('exit', 'line'),
          FRESH,
          MIN,
        ),
      ).toBe(false);
    });

    it('camera NUNCA parte una pasada (cámaras fijas de entrada y de salida)', () => {
      const cases: Array<[DirectionReading, DirectionReading]> = [
        [reading('entry', 'camera'), reading('exit', 'camera')],
        [reading('entry', 'line'), reading('exit', 'camera')],
        [reading('entry', 'camera'), reading('exit', 'line')],
      ];
      for (const [passage, incoming] of cases) {
        expect(startsNewPassage(passage, incoming, OLD, MIN)).toBe(false);
      }
    });

    it('si la entrante o la abierta es débil -> evidencia / corrección', () => {
      expect(
        startsNewPassage(
          reading('entry', 'line'),
          reading('exit', 'motion'),
          OLD,
          MIN,
        ),
      ).toBe(false);
      expect(
        startsNewPassage(
          reading('entry', 'width'),
          reading('exit', 'line'),
          OLD,
          MIN,
        ),
      ).toBe(false);
    });

    it('misma dirección o alguna desconocida -> evidencia', () => {
      expect(
        startsNewPassage(
          reading('entry', 'line'),
          reading('entry', 'line'),
          OLD,
          MIN,
        ),
      ).toBe(false);
      expect(
        startsNewPassage(
          reading('unknown', 'none'),
          reading('exit', 'line'),
          OLD,
          MIN,
        ),
      ).toBe(false);
    });
  });

  describe('verifyReadingSource', () => {
    it('camera vale solo si la cámara tiene esa misma dirección fija', () => {
      expect(
        verifyReadingSource(reading('exit', 'camera'), { direction: 'exit' }),
      ).toEqual(reading('exit', 'camera'));
      expect(
        verifyReadingSource(reading('exit', 'camera'), { direction: 'entry' }),
      ).toEqual(reading('exit', 'width'));
      expect(
        verifyReadingSource(reading('exit', 'camera'), { direction: 'both' }),
      ).toEqual(reading('exit', 'width'));
      expect(verifyReadingSource(reading('exit', 'camera'), null)).toEqual(
        reading('exit', 'width'),
      );
    });

    it('line vale solo si la cámara tiene directionLine', () => {
      const line = { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
      expect(
        verifyReadingSource(reading('entry', 'line'), { directionLine: line }),
      ).toEqual(reading('entry', 'line'));
      expect(verifyReadingSource(reading('entry', 'line'), {})).toEqual(
        reading('entry', 'width'),
      );
      expect(verifyReadingSource(reading('entry', 'line'), null)).toEqual(
        reading('entry', 'width'),
      );
    });

    it('una cámara con dirección fija Y línea puede declarar line (no se degrada) o camera', () => {
      const both = {
        direction: 'entry',
        directionLine: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
      };
      expect(verifyReadingSource(reading('exit', 'line'), both)).toEqual(
        reading('exit', 'line'),
      );
      expect(verifyReadingSource(reading('entry', 'camera'), both)).toEqual(
        reading('entry', 'camera'),
      );
      // La dirección fija sigue sin respaldar una lectura contraria.
      expect(verifyReadingSource(reading('exit', 'camera'), both)).toEqual(
        reading('exit', 'width'),
      );
    });

    it('motion, width y none pasan; una dirección desconocida es none', () => {
      expect(verifyReadingSource(reading('entry', 'motion'), null)).toEqual(
        reading('entry', 'motion'),
      );
      expect(verifyReadingSource(reading('entry', 'width'), null)).toEqual(
        reading('entry', 'width'),
      );
      expect(verifyReadingSource(reading('unknown', 'none'), null)).toEqual(
        reading('unknown', 'none'),
      );
    });
  });

  describe('shouldUpgradeDirection', () => {
    it('solo una fuente de mayor prioridad con dirección conocida mejora la pasada', () => {
      expect(
        shouldUpgradeDirection(
          reading('unknown', 'none'),
          reading('entry', 'width'),
        ),
      ).toBe(true);
      expect(
        shouldUpgradeDirection(
          reading('entry', 'width'),
          reading('exit', 'motion'),
        ),
      ).toBe(true);
      expect(
        shouldUpgradeDirection(
          reading('exit', 'camera'),
          reading('entry', 'line'),
        ),
      ).toBe(true);
      expect(
        shouldUpgradeDirection(
          reading('entry', 'width'),
          reading('exit', 'camera'),
        ),
      ).toBe(true);
      expect(
        shouldUpgradeDirection(
          reading('entry', 'camera'),
          reading('exit', 'motion'),
        ),
      ).toBe(true);
    });

    it('camera NO baja una dirección medida por motion', () => {
      expect(
        shouldUpgradeDirection(
          reading('exit', 'motion'),
          reading('entry', 'camera'),
        ),
      ).toBe(false);
    });

    it('camera NO baja una dirección medida por línea', () => {
      expect(
        shouldUpgradeDirection(
          reading('exit', 'line'),
          reading('entry', 'camera'),
        ),
      ).toBe(false);
      expect(
        shouldUpgradeDirection(
          reading('exit', 'line'),
          reading('exit', 'camera'),
        ),
      ).toBe(false);
    });

    it('igual o menor prioridad no la pisa', () => {
      expect(
        shouldUpgradeDirection(
          reading('exit', 'motion'),
          reading('entry', 'motion'),
        ),
      ).toBe(false);
      expect(
        shouldUpgradeDirection(
          reading('exit', 'line'),
          reading('entry', 'width'),
        ),
      ).toBe(false);
    });

    it('una dirección desconocida nunca mejora', () => {
      expect(
        shouldUpgradeDirection(
          reading('unknown', 'none'),
          reading('unknown', 'none'),
        ),
      ).toBe(false);
    });
  });

  describe('methodForDirection', () => {
    it('mapea la dirección al método del intento', () => {
      expect(methodForDirection('exit', 'Patente - Registro')).toBe(
        'Patente - Salida',
      );
      expect(methodForDirection('entry', 'Patente - Registro')).toBe(
        'Patente - Entrada',
      );
      expect(methodForDirection('unknown', 'Patente - Registro')).toBe(
        'Patente - Registro',
      );
      expect(methodForDirection('unknown', 'Patente - Entrada')).toBe(
        'Patente - Entrada',
      );
    });
  });
});
