import { StatusRegistry } from '../../application/status';
import { renderFrame, renderTitle, SIDE_BY_SIDE_COLUMNS } from './frame';
import { visibleWidth } from './style';

function frame(
  columns: number,
  mutate: (status: StatusRegistry) => void = () => undefined,
  logs: string[] = [],
  showLogs = false,
): string[] {
  const status = new StatusRegistry();
  mutate(status);

  return renderFrame({
    status: status.snapshot(),
    version: '0.3.0',
    columns,
    logs,
    showLogs,
    prompt: null,
  });
}

function plain(
  columns: number,
  mutate?: (status: StatusRegistry) => void,
  logs?: string[],
  showLogs?: boolean,
): string {
  process.env.NO_COLOR = '1';

  try {
    return frame(columns, mutate, logs, showLogs).join('\n');
  } finally {
    delete process.env.NO_COLOR;
  }
}

function signedIn(status: StatusRegistry): void {
  status.set('api', 'connected');
  status.setCrew({ name: 'Oskar Barcz', email: 'pilot@example.com' });
}

function signingIn(status: StatusRegistry): void {
  status.set('api', 'unauthorised');
  status.setFault('api', 'not signed in; press s to sign in');
  status.setSignIn({
    userCode: 'BCDF-GHJK',
    verificationUri: 'https://mypreflight.io/activate',
  });
}

function onService(status: StatusRegistry): void {
  signedIn(status);
  status.setService({
    callsign: 'DLH5540',
    departure: { iata: 'BER', icao: 'EDDB', name: 'Berlin' },
    arrival: { iata: 'WAW', icao: 'EPWA', name: 'Warsaw Chopin' },
    airframe: 'B77W',
    registration: 'SP-LVD',
  });
}

describe('renderFrame', () => {
  it('pads every line to the terminal width', () => {
    for (const line of frame(80)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    }
  });

  it('fills the width in visible columns rather than characters', () => {
    for (const line of frame(80).filter((line) => line !== '')) {
      expect(visibleWidth(line)).toBe(80);
      expect(line.length).toBeGreaterThan(80);
    }
  });

  it('lays out identically with colour turned off', () => {
    process.env.NO_COLOR = '1';

    try {
      for (const line of frame(80).filter((line) => line !== '')) {
        expect(line).not.toContain('[0m');
        expect(line.length).toBe(80);
      }
    } finally {
      delete process.env.NO_COLOR;
    }
  });

  it('shows the wordmark and the version', () => {
    const lines = frame(80);

    expect(lines[1]).toContain('MYPREFLIGHT');
    expect(lines[1]).toContain('v0.3.0');
  });

  it('draws all five sections, numbered', () => {
    const lines = plain(80);

    for (const title of [
      '1 CREW',
      '2 CRNT SERVICE',
      '3 XPNDR',
      '4 COMMS',
      '5 STATUS',
    ]) {
      expect(lines).toContain(title);
    }
  });

  it('pairs the first four sections two to a row when there is room', () => {
    const rows = plain(80).split('\n');

    expect(rows.find((row) => row.includes('1 CREW'))).toContain(
      '2 CRNT SERVICE',
    );
    expect(rows.find((row) => row.includes('3 XPNDR'))).toContain('4 COMMS');
  });

  it('gives the status section the full width to itself', () => {
    const rows = plain(80).split('\n');
    const row = rows.find((line) => line.includes('5 STATUS'));

    expect(row).not.toContain('4 COMMS');
    expect(visibleWidth(row ?? '')).toBe(80);
  });

  it('stacks the pairs when the terminal is narrow', () => {
    const rows = plain(SIDE_BY_SIDE_COLUMNS - 1).split('\n');

    expect(rows.find((row) => row.includes('1 CREW'))).not.toContain(
      '2 CRNT SERVICE',
    );
    expect(rows.some((row) => row.includes('2 CRNT SERVICE'))).toBe(true);
  });

  it('names the signed-in pilot and their address', () => {
    const lines = plain(80, signedIn);

    expect(lines).toContain('Oskar Barcz');
    expect(lines).toContain('pilot@example.com');
  });

  it('says who is not signed in, and how to be', () => {
    const lines = plain(80);

    expect(lines).toContain('not signed in');
    expect(lines).toContain('press s to sign in');
  });

  it('puts the code and the address in front of the pilot while signing in', () => {
    const lines = plain(80, signingIn);

    expect(lines).toContain(
      'sign in — approve code BCDF-GHJK at https://mypreflight.io/activate',
    );
    expect(lines).toContain('waiting for the browser');
  });

  it('stops telling the pilot to press s once they are signing in', () => {
    const lines = plain(80, signingIn);

    expect(lines).not.toContain('press s to sign in');
    expect(lines).not.toContain('[s] sign in');
    expect(lines).toContain('[esc] cancel');
  });

  it('keeps every key on the line while signing in, with the log open', () => {
    const line = plain(80, signingIn, [], true).split('\n').at(-1) ?? '';

    expect(line).toContain('[d] hide debug');
    expect(line.trimEnd().length).toBeLessThanOrEqual(80);
  });

  it('keeps a long sign-in address whole by wrapping it', () => {
    const lines = plain(60, (status) => {
      signingIn(status);
      status.setSignIn({
        userCode: 'BCDF-GHJK',
        verificationUri: 'https://staging.mypreflight.io/activate',
      });
    });

    expect(lines).toContain('BCDF-GHJK');
    expect(lines).toContain('https://staging.mypreflight.io/activate');
  });

  it('reads the current service as callsign, route, airframe and tail', () => {
    const lines = plain(120, onService);

    expect(lines).toContain('DLH5540 * [BER] Berlin -> [WAW] Warsaw Chopin');
    expect(lines).toContain('airframe: [B77W] * tail: [SP-LVD]');
  });

  it('drops the airport names before it lets the route be truncated', () => {
    const lines = plain(80, onService);

    expect(lines).toContain('DLH5540 * [BER] -> [WAW]');
    expect(lines).not.toContain('Warsa');
  });

  it('says there is no current flight when there is none', () => {
    expect(plain(80, signedIn)).toContain('no current flight');
  });

  it('reports the transponder as an aircraft would', () => {
    const lines = plain(80, (status) => {
      status.setCallsign('LH455');
      status.setAircraftIdentifier('SP-LVD');
      status.setTransponder('2000', 451.4);
      status.recordAcceptedReport(new Date(Date.UTC(2026, 7, 14, 11, 30, 30)));
    });

    expect(lines).toContain('callsign: [LH455]');
    expect(lines).toContain('tail:     [SP-LVD]');
    expect(lines).toContain('squawk:   [2000]');
    expect(lines).toContain('spd:      451kt');
    expect(lines).toContain('call:     11:30:30z');
  });

  it.each([
    [true, 'mode:     [MODE C]'],
    [false, 'mode:     [STBY]'],
  ])('reads mode from the switch, not the network (%s)', (on, expected) => {
    expect(plain(80, (status) => status.setTransmitting(on))).toContain(
      expected,
    );
  });

  it('leaves the transponder rows blank until the simulator says otherwise', () => {
    const lines = plain(80);

    expect(lines).toContain('callsign: [—]');
    expect(lines).toContain('squawk:   [—]');
    expect(lines).toContain('call:     —');
  });

  it('reports the Discord client and whether presence is published', () => {
    expect(
      plain(80, (status) => {
        status.set('discord', 'connected');
        status.setPresence('Boarding', 'EPWA -> EDDF');
      }),
    ).toContain('presence: [ON]');

    expect(plain(80)).toContain('presence: [OFF]');
  });

  it('states both services and itself on one line, with versions', () => {
    const lines = plain(80, (status) => {
      status.set('api', 'connected');
      status.set('adsb', 'connected');
      status.setServiceVersion('api', '3.24.0');
      status.setServiceVersion('adsb', '0.5.0');
    });

    expect(lines).toContain(
      'adsb: [OK, v0.5.0] · tracker: [OK, v3.24.0] · xpndr: [OK, v0.3.0]',
    );
  });

  it.each([
    ['waiting-for-flight', 'adsb: [OK]'],
    ['standby', 'adsb: [OK]'],
    ['disconnected', 'adsb: [OFFLINE]'],
    ['unauthorised', 'adsb: [UNAUTHORISED]'],
  ])('reads %s as %s', (state, expected) => {
    expect(
      plain(80, (status) => status.set('adsb', state as 'connected')),
    ).toContain(expected);
  });

  it('offers the update when a newer release exists', () => {
    expect(plain(80, (status) => status.setLatestRelease('0.8.0'))).toContain(
      'xpndr: [UPDATE v0.8.0]',
    );
  });

  it('keeps the status line inside the box when every version is known', () => {
    const lines = plain(80, (status) => {
      status.set('adsb', 'connected');
      status.set('api', 'connected');
      status.setServiceVersion('adsb', '1.24.0');
      status.setServiceVersion('api', '3.24.0');
      status.setLatestRelease('0.12.0');
    });

    expect(lines).toContain(
      'adsb: [OK, v1.24.0] · tracker: [OK, v3.24.0] · xpndr: [UPDATE v0.12.0]',
    );
  });

  it('says nothing about updates when it is already the newest', () => {
    const lines = plain(80, (status) => status.setLatestRelease('0.3.0'));

    expect(lines).toContain('xpndr: [OK, v0.3.0]');
    expect(lines).not.toContain('UPDATE');
  });

  it('asks the pilot to download a newer release, and says where it lands', () => {
    const lines = plain(80, (status) => status.setLatestRelease('0.8.0'));

    expect(lines).toContain(
      'update — v0.8.0 is out — press [u] to save it to your Downloads folder',
    );
  });

  it('says nothing about downloading when this is the newest build', () => {
    const lines = plain(80, (status) => status.setLatestRelease('0.3.0'));

    expect(lines).not.toContain('Downloads folder');
    expect(lines).not.toContain('press [u]');
  });

  it('follows the download while it runs', () => {
    const lines = plain(80, (status) => {
      status.setLatestRelease('0.8.0');
      status.setUpdate({
        phase: 'downloading',
        receivedBytes: 12 * 1_048_576,
        totalBytes: 48 * 1_048_576,
      });
    });

    expect(lines).toContain('xpndr: [DOWNLOADING 25%]');
    expect(lines).toContain('downloading v0.8.0 — 25% of 48.0MB');
  });

  it('stops offering the download once it is running', () => {
    const lines = plain(80, (status) => {
      status.setLatestRelease('0.8.0');
      status.setUpdate({
        phase: 'downloading',
        receivedBytes: 1024,
        totalBytes: null,
      });
    });

    expect(lines).not.toContain('press [u]');
    expect(lines).toContain('downloading v0.8.0 — 0.0MB of 0.0MB');
  });

  it('says where the download went, and what to do with it', () => {
    const lines = plain(80, (status) => {
      status.setLatestRelease('0.8.0');
      status.setUpdate({
        phase: 'saved',
        path: 'C:\\Users\\pilot\\Downloads\\mypreflight-transponder-0.8.0.exe',
      });
    });

    expect(lines).toContain('xpndr: [UPDATE SAVED]');
    expect(lines).toContain('mypreflight-transponder-0.8.0.exe');
    expect(lines).toContain('swap the executable for it');
  });

  it('offers another go when the download failed', () => {
    const lines = plain(80, (status) => {
      status.setLatestRelease('0.8.0');
      status.setUpdate({ phase: 'failed', reason: 'the connection dropped' });
    });

    expect(lines).toContain('the connection dropped — press [u] to try again');
    expect(lines).toContain('xpndr: [UPDATE v0.8.0]');
  });

  it('says so when the folder it runs from takes no writes', () => {
    const lines = plain(80, (status) =>
      status.setStorageFault(
        'cannot write to C:\\Program Files\\MyPreflight: the session and the log are off',
      ),
    );

    expect(lines).toContain('storage — cannot write to');
    expect(lines).toContain('MyPreflight: the session and');
  });

  it('hides the log pane until it is asked for', () => {
    const logs = ['20:14:22 WARN  simulator connection failed'];

    expect(plain(80, undefined, logs, false)).not.toContain(
      'simulator connection failed',
    );
    expect(plain(80, undefined, logs, true)).toContain(
      'simulator connection failed',
    );
  });

  it('shows only the most recent log lines', () => {
    const logs = Array.from({ length: 40 }, (_, index) => `line-${index}`);
    const lines = plain(80, undefined, logs, true);

    expect(lines).toContain('line-39');
    expect(lines).not.toContain('line-0 ');
  });

  it('brackets every key so it can be told from its label', () => {
    const lines = plain(80);

    expect(lines).toContain('[s] sign in');
    expect(lines).toContain('[t] xpndr mode');
    expect(lines).toContain('[c] callsign');
    expect(lines).toContain('[r] refresh');
    expect(lines).toContain('[d] debug');
  });

  it('keeps every key on the line at the width it is drawn for', () => {
    for (const showLogs of [false, true]) {
      const line =
        plain(80, (status) => signedIn(status), [], showLogs)
          .split('\n')
          .at(-1) ?? '';

      expect(line).toContain('[d]');
      expect(line.trimEnd().length).toBeLessThanOrEqual(80);
    }
  });

  it('marks the key brighter than the words around it', () => {
    const line = frame(80).at(-1) ?? '';

    expect(line).toContain('[96ms[0m');
    expect(line).toContain('[2m[[0m');
  });

  it('offers signing out once there is a session to end', () => {
    const lines = plain(80, (status) => {
      signedIn(status);
    });

    expect(lines).toContain('[s] sign out');
    expect(lines).not.toContain('[s] sign in');
  });

  it('does not offer quitting as a key to learn', () => {
    expect(plain(80)).not.toContain('ctrl-c');
    expect(plain(80)).not.toContain('quit');
  });

  it('reports the simulator link, which everything else here depends on', () => {
    expect(plain(80)).toContain('sim:      ○ disconnected');
    expect(
      plain(80, (status) => status.set('simulator', 'connected')),
    ).toContain('sim:      ● connected');
  });

  it('says why a connection is unhappy, not only that it is', () => {
    const lines = plain(80, (status) => {
      status.setFault('simulator', 'the simulator is not running');
    });

    expect(lines).toContain('! simulator — the simulator is not running');
  });

  it('shows nothing at all when nothing is wrong', () => {
    expect(plain(80)).not.toContain('!');
  });

  it('wraps a long fault to the gutter rather than cutting it off', () => {
    const rows = plain(80, (status) => {
      status.setFault(
        'simulator',
        'connect ECONNREFUSED 192.168.1.20:500 check MSFS is running there, ' +
          'its SimConnect.xml has an IPv4 block, and the port is open',
      );
    }).split('\n');

    const first = rows.findIndex((row) => row.includes('! simulator'));

    expect(rows[first]).toContain('connect ECONNREFUSED');
    expect(rows.slice(first, first + 3).join('\n')).toContain('the port is');
    expect(rows[first + 1]).toMatch(/^ {16}\S/);
  });

  it('bounds a fault so a four-hundred-character body cannot eat the frame', () => {
    const rows = plain(80, (status) => {
      status.setFault('adsb', 'x'.repeat(2000));
    }).split('\n');

    const first = rows.findIndex((row) => row.includes('! adsb'));
    const used = rows.slice(first).findIndex((row) => row.trim() === '');

    expect(used).toBeLessThanOrEqual(3);
    expect(rows.slice(first, first + 3).join('')).toContain('…');
  });

  it('leads with the fault the pilot can act on', () => {
    const lines = plain(80, (status) => {
      status.setFault('adsb', 'adsb is unhappy');
      status.setFault('simulator', 'the simulator is not running');
    });

    expect(lines).toContain('! simulator');
    expect(lines).not.toContain('adsb is unhappy');
  });

  it('survives an absurdly narrow terminal', () => {
    expect(() => frame(1)).not.toThrow();

    for (const line of frame(1)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(24);
    }
  });
});

function healthy(status: StatusRegistry): void {
  status.set('simulator', 'connected');
  status.set('adsb', 'waiting-for-flight');
  status.set('api', 'connected');
  status.setTransmitting(true);
}

function title(
  mutate: (status: StatusRegistry) => void = () => undefined,
): string {
  const status = new StatusRegistry();
  mutate(status);

  return renderTitle(status.snapshot());
}

function boarding(status: StatusRegistry): void {
  status.setGroundHandling(
    'connected',
    [
      {
        id: 'boarding',
        state: 'performing',
        phase: 'front loader loading',
        operator: null,
        passengers: { done: 30, total: 122 },
        bagsPercent: 40,
        cargo: [{ hold: 'front', unit: 'ULDs', done: 16, total: 20 }],
        fuel: null,
      },
      {
        id: 'jetway',
        state: 'completed',
        phase: 'docked',
        operator: null,
        passengers: null,
        bagsPercent: null,
        cargo: [],
        fuel: null,
      },
    ],
    { airport: 'EDDB', parking: 'Terminal 1 - A Gates|Gate A15' },
  );
}

describe('the ground services section', () => {
  it('is not drawn at all when GSX has reported nothing', () => {
    expect(plain(80)).not.toContain('GROUND');
  });

  it('is not drawn when GSX is connected but every service is merely offered', () => {
    expect(
      plain(80, (status) =>
        status.setGroundHandling('connected', [], {
          airport: 'EDDB',
          parking: 'Gate A15',
        }),
      ),
    ).not.toContain('GROUND');
  });

  it('names each service, its state and its progress on one line', () => {
    const drawn = plain(80, boarding);

    expect(drawn).toContain('GROUND');
    expect(drawn).toMatch(/boarding\s+\[RUNNING\]\s+30\/122 pax/);
    expect(drawn).toContain('bags 40%');
    expect(drawn).toContain('front 16/20 ULDs');
  });

  it('draws a service with no progress as its state alone, with no empty filler', () => {
    expect(plain(80, boarding)).toMatch(/jetway\s+\[DONE\]\s+docked/);
  });

  it('shows the stand GSX reports, without the terminal it is buried in', () => {
    const drawn = plain(80, boarding);

    expect(drawn).toContain('EDDB · Gate A15');
    expect(drawn).not.toContain('Terminal 1 - A Gates');
  });

  it('leaves the stand line out when GSX has not named one', () => {
    const drawn = plain(80, (status) => {
      boarding(status);
      status.setGroundHandling('connected', status.snapshot().groundServices, {
        airport: null,
        parking: null,
      });
    });

    expect(drawn).toContain('boarding');
    expect(drawn).not.toContain('·  ');
  });

  it('tells the states apart without any colour at all', () => {
    const drawn = plain(80, boarding);

    expect(drawn).toContain('[RUNNING]');
    expect(drawn).toContain('[DONE]');
  });

  it('keeps every line exactly as wide as the terminal', () => {
    for (const line of frame(80, boarding).filter((line) => line !== '')) {
      expect(visibleWidth(line)).toBe(80);
    }
  });

  it('stays inside the narrowest terminal it supports', () => {
    for (const line of frame(24, boarding)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(24);
    }
  });

  it('truncates a long detail rather than spilling out of the box', () => {
    const drawn = frame(40, (status) =>
      status.setGroundHandling(
        'connected',
        [
          {
            id: 'boarding',
            state: 'performing',
            phase: 'x'.repeat(300),
            operator: null,
            passengers: null,
            bagsPercent: null,
            cargo: [],
            fuel: null,
          },
        ],
        { airport: null, parking: null },
      ),
    );

    for (const line of drawn.filter((line) => line !== '')) {
      expect(visibleWidth(line)).toBe(40);
    }
  });
});

describe('renderTitle', () => {
  it('leads with whatever is broken', () => {
    expect(title()).toBe('simulator disconnected · MyPreflight');
  });

  it('names a connection that turned us away', () => {
    expect(
      title((status) => {
        healthy(status);
        status.set('adsb', 'unauthorised');
      }),
    ).toBe('adsb unauthorised · MyPreflight');
  });

  it('leaves discord off the title however badly it is doing', () => {
    expect(
      title((status) => {
        healthy(status);
        status.set('discord', 'disconnected');
      }),
    ).not.toContain('discord');
  });

  it('treats waiting for a flight as quiet rather than broken', () => {
    expect(title(healthy)).toBe('no flight · MyPreflight');
  });

  it('says so from the tab when transmission is switched off', () => {
    expect(
      title((status) => {
        healthy(status);
        status.setCallsign('SP-LOT');
        status.setTransmitting(false);
      }),
    ).toBe('standby · MyPreflight');
  });

  it('shows the callsign and how much it has sent once flying', () => {
    expect(
      title((status) => {
        healthy(status);
        status.set('adsb', 'connected');
        status.setCallsign('SP-LOT');
        status.recordAcceptedReport(new Date());
        status.recordAcceptedReport(new Date());
      }),
    ).toBe('SP-LOT · 2 sent · MyPreflight');
  });
});
