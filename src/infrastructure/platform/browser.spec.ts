import { SystemBrowser } from './browser';
import type { CommandRunner } from './command-runner';

const ACTIVATE = 'https://mypreflight.io/activate?code=BCDF-GHJK';

function recorder(status: 'ok' | 'failed' = 'ok'): {
  calls: [string, string[]][];
  run: CommandRunner;
} {
  const calls: [string, string[]][] = [];

  return {
    calls,
    run: (file, args) => {
      calls.push([file, args]);

      return Promise.resolve({ stdout: '', status });
    },
  };
}

describe('SystemBrowser', () => {
  it('hands the address to the Windows URL handler, with no shell in between', async () => {
    const { calls, run } = recorder();

    await expect(new SystemBrowser('win32', run).open(ACTIVATE)).resolves.toBe(
      true,
    );
    expect(calls).toEqual([
      ['rundll32.exe', ['url.dll,FileProtocolHandler', ACTIVATE]],
    ]);
  });

  it('uses open on macOS, for development', async () => {
    const { calls, run } = recorder();

    await expect(new SystemBrowser('darwin', run).open(ACTIVATE)).resolves.toBe(
      true,
    );
    expect(calls).toEqual([['open', [ACTIVATE]]]);
  });

  it('opens a local web app during development', async () => {
    const { calls, run } = recorder();

    await new SystemBrowser('darwin', run).open(
      'http://localhost:5173/activate?code=BCDF-GHJK',
    );

    expect(calls).toEqual([
      ['open', ['http://localhost:5173/activate?code=BCDF-GHJK']],
    ]);
  });

  it('reports a browser that would not open', async () => {
    const { run } = recorder('failed');

    await expect(new SystemBrowser('win32', run).open(ACTIVATE)).resolves.toBe(
      false,
    );
  });

  it('leaves every other platform to the printed address', async () => {
    const { calls, run } = recorder();

    await expect(new SystemBrowser('linux', run).open(ACTIVATE)).resolves.toBe(
      false,
    );
    expect(calls).toEqual([]);
  });

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'C:\\Windows\\System32\\calc.exe',
    'javascript:alert(1)',
    'ms-settings:privacy',
    'not an address',
  ])('refuses to hand %s to the system', async (url) => {
    const { calls, run } = recorder();

    await expect(new SystemBrowser('win32', run).open(url)).resolves.toBe(
      false,
    );
    expect(calls).toEqual([]);
  });

  it('passes the address on in its encoded form', async () => {
    const { calls, run } = recorder();

    await new SystemBrowser('win32', run).open(
      'https://mypreflight.io/activate?code=BCDF GHJK',
    );

    expect(calls[0]?.[1]).toEqual([
      'url.dll,FileProtocolHandler',
      'https://mypreflight.io/activate?code=BCDF%20GHJK',
    ]);
  });
});
