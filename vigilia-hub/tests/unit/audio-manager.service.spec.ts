import type { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { PassThrough } from 'stream';

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3, "Audio crudo"): el
 * hub NO persiste la voz del visitante. La captura va de `arecord` a `sox`
 * por pipes y de `sox` al callback en memoria; ningún proceso recibe una ruta
 * de archivo y el servicio no escribe en disco.
 */

interface FakeProcess extends EventEmitter {
  stdout: PassThrough;
  stdin: PassThrough;
  stderr: PassThrough;
  kill: jest.Mock;
}

const mockSpawnCalls: Array<{
  command: string;
  args: string[];
  process: FakeProcess;
}> = [];

jest.mock('child_process', () => ({
  spawn: (command: string, args: string[]): FakeProcess => {
    const events = jest.requireActual<typeof import('events')>('events');
    const stream = jest.requireActual<typeof import('stream')>('stream');
    const child = Object.assign(new events.EventEmitter(), {
      stdout: new stream.PassThrough(),
      stdin: new stream.PassThrough(),
      stderr: new stream.PassThrough(),
      kill: jest.fn(),
    });
    mockSpawnCalls.push({ command, args, process: child });
    return child;
  },
}));

jest.mock('../../src/utils/logger', () => ({
  Logger: class {
    log(): void {}
    warn(): void {}
    error(): void {}
    debug(): void {}
  },
}));

import { AudioManagerService } from '../../src/services/audio-manager.service';

/** Argumento que parece una ruta de archivo de audio. */
function looksLikeFilePath(arg: string): boolean {
  return (
    /\.(wav|raw|pcm|mp3|ogg|flac)$/i.test(arg) ||
    arg.startsWith('/') ||
    /^[A-Za-z]:\\/.test(arg)
  );
}

describe('AudioManagerService — la voz no se persiste (Fase 4 · P7.L)', () => {
  beforeEach(() => {
    mockSpawnCalls.length = 0;
  });

  it('arecord y sox trabajan por stdin/stdout, sin archivos', () => {
    const service = new AudioManagerService();

    service.startCapture(() => undefined);

    const arecord = mockSpawnCalls.find((call) => call.command === 'arecord');
    const sox = mockSpawnCalls.find((call) => call.command === 'sox');
    expect(arecord).toBeDefined();
    expect(sox).toBeDefined();
    // arecord sin argumento posicional de archivo: escribe a stdout.
    expect(arecord?.args.some(looksLikeFilePath)).toBe(false);
    expect(arecord?.args).toEqual(expect.arrayContaining(['-t', 'raw']));
    // sox lee de stdin ('-') y escribe a stdout ('-').
    expect(sox?.args.filter((arg) => arg === '-')).toHaveLength(2);
    expect(sox?.args[sox.args.length - 1]).toBe('-');
    expect(sox?.args.some(looksLikeFilePath)).toBe(false);

    service.stopCapture();
  });

  it('el audio capturado llega al callback en memoria', () => {
    const service = new AudioManagerService();
    const chunks: Buffer[] = [];

    service.startCapture((chunk) => chunks.push(chunk));
    const sox = mockSpawnCalls.find((call) => call.command === 'sox');
    sox?.process.stdout.emit('data', Buffer.from([1, 2, 3, 4]));

    expect(chunks).toEqual([Buffer.from([1, 2, 3, 4])]);
    service.stopCapture();
  });

  it('el servicio no importa fs ni escribe archivos', () => {
    const source = readFileSync(
      join(__dirname, '../../src/services/audio-manager.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/from ['"](node:)?fs(\/promises)?['"]/);
    expect(source).not.toMatch(/require\(['"](node:)?fs/);
    expect(source).not.toMatch(/writeFile|createWriteStream|appendFile/);
  });
});
