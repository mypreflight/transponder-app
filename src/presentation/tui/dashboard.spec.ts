import { StatusRegistry } from '../../application/status';
import type { PromptInput } from './prompt';
import { Dashboard, type DashboardHandlers } from './dashboard';
import { Screen } from './screen';

const CANCEL = '\u0003';
const ESCAPE = '\u001b';
const BACKSPACE = '\u007f';

const WAITING = {
  userCode: 'BCDF-GHJK',
  verificationUri: 'https://mypreflight.io/activate',
};

class FakeOutput {
  written: string[] = [];

  write(text: string): unknown {
    this.written.push(text);

    return true;
  }

  get all(): string {
    return this.written.join('');
  }
}

class FakeInput implements PromptInput {
  rawModes: boolean[] = [];
  private listener: ((chunk: string) => void) | null = null;

  on(_event: 'data', listener: (chunk: string) => void): unknown {
    this.listener = listener;

    return this;
  }

  off(_event: 'data', _listener: (chunk: string) => void): unknown {
    this.listener = null;

    return this;
  }

  setEncoding(_encoding: 'utf-8'): unknown {
    return this;
  }

  setRawMode(mode: boolean): unknown {
    this.rawModes.push(mode);

    return this;
  }

  resume(): unknown {
    return this;
  }

  pause(): unknown {
    return this;
  }

  press(key: string): void {
    this.listener?.(key);
  }

  get listening(): boolean {
    return this.listener !== null;
  }
}

function dashboard(): {
  out: FakeOutput;
  input: FakeInput;
  status: StatusRegistry;
  view: Dashboard;
} {
  const out = new FakeOutput();
  const input = new FakeInput();
  const status = new StatusRegistry();

  return {
    out,
    input,
    status,
    view: new Dashboard(new Screen(out), status, '0.3.0', () => 80, input),
  };
}

function handlers(
  overrides: Partial<DashboardHandlers> = {},
): DashboardHandlers {
  return {
    onQuit: () => undefined,
    onCallsign: () => undefined,
    onSignIn: () => undefined,
    onCancelSignIn: () => undefined,
    onSignOut: () => undefined,
    onTransmit: () => undefined,
    onRefresh: () => undefined,
    onUpdate: () => undefined,
    ...overrides,
  };
}

function type(input: FakeInput, text: string): void {
  for (const character of text) {
    input.press(character);
  }
}

describe('Dashboard', () => {
  it('paints as soon as it starts', () => {
    const { out, view } = dashboard();

    view.start(handlers());
    view.stop();

    expect(out.all).toContain('MYPREFLIGHT');
  });

  it('quits on ctrl-c, which raw mode stops delivering as a signal', () => {
    const { input, view } = dashboard();
    let quit = 0;

    view.start(
      handlers({
        onQuit: () => {
          quit += 1;
        },
      }),
    );
    input.press(CANCEL);
    view.stop();

    expect(quit).toBe(1);
  });

  it('downloads the update when u is pressed and a newer release exists', () => {
    const { input, status, view } = dashboard();
    let asked = 0;

    status.setLatestRelease('0.9.0');
    view.start(
      handlers({
        onUpdate: () => {
          asked += 1;
        },
      }),
    );
    input.press('u');
    view.stop();

    expect(asked).toBe(1);
  });

  it('ignores u when this is already the newest build', () => {
    const { input, status, view } = dashboard();
    let asked = 0;

    status.setLatestRelease('0.3.0');
    view.start(
      handlers({
        onUpdate: () => {
          asked += 1;
        },
      }),
    );
    input.press('u');
    view.stop();

    expect(asked).toBe(0);
  });

  it('ignores u while the download is already running', () => {
    const { input, status, view } = dashboard();
    let asked = 0;

    status.setLatestRelease('0.9.0');
    status.setUpdate({
      phase: 'downloading',
      receivedBytes: 1024,
      totalBytes: 4096,
    });
    view.start(
      handlers({
        onUpdate: () => {
          asked += 1;
        },
      }),
    );
    input.press('u');
    view.stop();

    expect(asked).toBe(0);
  });

  it('asks for a callsign when c is pressed', () => {
    const { out, input, view } = dashboard();
    view.start(handlers());
    out.written = [];

    input.press('c');
    view.stop();

    expect(out.all).toContain('callsign ›');
  });

  it('reports the callsign that was typed', () => {
    const { input, view } = dashboard();
    const typed: (string | null)[] = [];

    view.start(handlers({ onCallsign: (value) => typed.push(value) }));
    input.press('c');

    for (const character of 'SP123') {
      input.press(character);
    }

    input.press('\r');
    view.stop();

    expect(typed).toEqual(['SP123']);
  });

  it('takes an empty answer as following the flight again', () => {
    const { input, view } = dashboard();
    const typed: (string | null)[] = [];

    view.start(handlers({ onCallsign: (value) => typed.push(value) }));
    input.press('c');
    input.press('\r');
    view.stop();

    expect(typed).toEqual([null]);
  });

  it('lets escape cancel without changing anything', () => {
    const { input, view } = dashboard();
    const typed: (string | null)[] = [];

    view.start(handlers({ onCallsign: (value) => typed.push(value) }));
    input.press('c');
    input.press('S');
    input.press(ESCAPE);
    input.press('\r');
    view.stop();

    expect(typed).toEqual([]);
  });

  it('does not quit on ctrl-c while a callsign is being typed', () => {
    const { input, view } = dashboard();
    let quit = 0;

    view.start(
      handlers({
        onQuit: () => {
          quit += 1;
        },
      }),
    );
    input.press('c');
    input.press(CANCEL);
    view.stop();

    expect(quit).toBe(0);
  });

  it('edits the draft with backspace', () => {
    const { input, view } = dashboard();
    const typed: (string | null)[] = [];

    view.start(handlers({ onCallsign: (value) => typed.push(value) }));
    input.press('c');

    for (const character of 'SP9') {
      input.press(character);
    }

    input.press(BACKSPACE);
    input.press('1');
    input.press('\r');
    view.stop();

    expect(typed).toEqual(['SP1']);
  });

  it('treats a command key as text while typing a callsign', () => {
    const { input, view } = dashboard();
    const typed: (string | null)[] = [];

    view.start(handlers({ onCallsign: (value) => typed.push(value) }));
    input.press('c');

    for (const character of 'LOT1') {
      input.press(character);
    }

    input.press('\r');
    view.stop();

    expect(typed).toEqual(['LOT1']);
  });

  it('shows and hides the debug pane on the toggle key', () => {
    const { out, input, view } = dashboard();
    view.start(handlers());
    view.append('20:14:22 WARN  something happened');

    input.press('d');
    const shown = out.all;
    out.written = [];
    input.press('d');
    const hidden = out.all;
    view.stop();

    expect(shown).toContain('something happened');
    expect(hidden).not.toContain('something happened');
  });

  it('accepts the debug key in upper case too', () => {
    const { out, input, view } = dashboard();
    view.start(handlers());
    view.append('a log line');
    out.written = [];

    input.press('D');
    view.stop();

    expect(out.all).toContain('a log line');
  });

  it('ignores keys it has no use for', () => {
    const { out, input, view } = dashboard();
    view.start(handlers());
    view.append('a log line');
    out.written = [];

    input.press('x');
    view.stop();

    expect(out.all).not.toContain('a log line');
  });

  it('keeps collecting logs while the pane is hidden', () => {
    const { out, input, view } = dashboard();
    view.start(handlers());
    view.append('earlier line');
    out.written = [];

    input.press('d');
    view.stop();

    expect(out.all).toContain('earlier line');
  });

  it('leaves raw mode and the terminal as it found them', () => {
    const { out, input, view } = dashboard();

    view.start(handlers());
    out.written = [];
    view.stop();

    expect(input.rawModes).toEqual([true, false]);
    expect(input.listening).toBe(false);
    expect(out.all).toContain('[?1049l');
  });

  it('starts the browser sign-in on s when nobody is signed in', () => {
    const { out, input, view } = dashboard();
    let asked = 0;

    view.start(
      handlers({
        onSignIn: () => {
          asked += 1;
        },
      }),
    );
    out.written = [];

    input.press('s');
    view.stop();

    expect(asked).toBe(1);
    expect(out.all).not.toContain('›');
  });

  it('does not start a second sign-in while one is waiting for the browser', () => {
    const { input, status, view } = dashboard();
    let asked = 0;

    status.setSignIn(WAITING);
    view.start(
      handlers({
        onSignIn: () => {
          asked += 1;
        },
      }),
    );

    input.press('s');
    view.stop();

    expect(asked).toBe(0);
  });

  it('signs out on s once signed in', () => {
    const { input, status, view } = dashboard();
    let asked = 0;

    status.setCrew({ name: 'Oskar Barcz', email: 'pilot@example.com' });
    view.start(
      handlers({
        onSignOut: () => {
          asked += 1;
        },
      }),
    );

    input.press('s');
    view.stop();

    expect(asked).toBe(1);
  });

  it('lets escape cancel a sign-in waiting for the browser', () => {
    const { input, status, view } = dashboard();
    let cancelled = 0;

    status.setSignIn(WAITING);
    view.start(
      handlers({
        onCancelSignIn: () => {
          cancelled += 1;
        },
      }),
    );

    input.press(ESCAPE);
    view.stop();

    expect(cancelled).toBe(1);
  });

  it('takes ctrl-c as cancelling the sign-in rather than quitting', () => {
    const { input, status, view } = dashboard();
    let cancelled = 0;
    let quit = 0;

    status.setSignIn(WAITING);
    view.start(
      handlers({
        onCancelSignIn: () => {
          cancelled += 1;
        },
        onQuit: () => {
          quit += 1;
        },
      }),
    );

    input.press(CANCEL);
    view.stop();

    expect(cancelled).toBe(1);
    expect(quit).toBe(0);
  });

  it('ignores escape when no sign-in is waiting', () => {
    const { input, view } = dashboard();
    let cancelled = 0;

    view.start(
      handlers({
        onCancelSignIn: () => {
          cancelled += 1;
        },
      }),
    );

    input.press(ESCAPE);
    view.stop();

    expect(cancelled).toBe(0);
  });

  it('asks to toggle transmission on t', () => {
    const { input, view } = dashboard();
    let toggles = 0;

    view.start(
      handlers({
        onTransmit: () => {
          toggles += 1;
        },
      }),
    );

    input.press('t');
    input.press('T');
    view.stop();

    expect(toggles).toBe(2);
  });

  it('asks for the flight again on r', () => {
    const { input, view } = dashboard();
    let refreshes = 0;

    view.start(
      handlers({
        onRefresh: () => {
          refreshes += 1;
        },
      }),
    );

    input.press('r');
    input.press('R');
    view.stop();

    expect(refreshes).toBe(2);
  });

  it('takes r as text while a callsign is being typed', () => {
    const { input, view } = dashboard();
    const typed: (string | null)[] = [];
    let refreshes = 0;

    view.start(
      handlers({
        onCallsign: (value) => typed.push(value),
        onRefresh: () => {
          refreshes += 1;
        },
      }),
    );

    input.press('c');
    type(input, 'RR12');
    input.press('\r');
    view.stop();

    expect(typed).toEqual(['RR12']);
    expect(refreshes).toBe(0);
  });

  it('takes t and s as text while a callsign is being typed', () => {
    const { input, view } = dashboard();
    const typed: (string | null)[] = [];
    let toggles = 0;

    view.start(
      handlers({
        onCallsign: (value) => typed.push(value),
        onTransmit: () => {
          toggles += 1;
        },
      }),
    );

    input.press('c');
    type(input, 'TS12');
    input.press('\r');
    view.stop();

    expect(typed).toEqual(['TS12']);
    expect(toggles).toBe(0);
  });

  it('reveals the log pane so an answer the pilot waited for is seen', () => {
    const { out, view } = dashboard();

    view.start(handlers());
    view.append('sign-in declined in the browser');
    out.written = [];

    view.revealLogs();
    const revealed = out.all;

    view.append('and here is why');
    out.written = [];
    view.revealLogs();
    view.stop();

    expect(revealed).toContain('sign-in declined');
    expect(out.all).toContain('and here is why');
  });

  it('reflects status changes on the next render', () => {
    const { out, status, view } = dashboard();
    view.start(handlers());
    out.written = [];

    status.set('simulator', 'connected');
    view.render();
    view.stop();

    expect(out.all).toContain('connected');
  });
});
