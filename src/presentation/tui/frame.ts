import type {
  ConnectionName,
  ConnectionState,
  CurrentService,
  ServiceAirport,
  StatusSnapshot,
} from '../../application/status';
import type { GroundService, ServiceState } from '../../domain/ground-services';
import { isUpdateAvailable } from '../../domain/release';
import {
  amber,
  bold,
  brightCyan,
  cyan,
  dim,
  green,
  grey,
  red,
  reverse,
  type Style,
  toVisibleWidth,
  visibleWidth,
} from './style';

export const MIN_COLUMNS = 24;
export const SIDE_BY_SIDE_COLUMNS = 56;
export const LOG_ROWS = 8;

const TITLE_SUFFIX = 'MyPreflight';

const TITLE_CRITICAL: ConnectionName[] = ['simulator', 'adsb', 'api'];
const TITLE_BROKEN: ConnectionState[] = ['disconnected', 'unauthorised'];

const MARKERS: Record<ConnectionState, string> = {
  connected: '●',
  disconnected: '○',
  unauthorised: '!',
  'waiting-for-flight': '~',
  standby: '◌',
};

const MARKER_COLOURS: Record<ConnectionState, Style> = {
  connected: green,
  disconnected: red,
  unauthorised: amber,
  'waiting-for-flight': cyan,
  standby: dim,
};

export function marker(state: ConnectionState): string {
  return MARKER_COLOURS[state](MARKERS[state]);
}

export type FramePrompt = {
  label: string;
  value: string;
  hint: string;
};

export type FrameInput = {
  status: StatusSnapshot;
  version: string;
  columns: number;
  logs: string[];
  showLogs: boolean;
  prompt: FramePrompt | null;
};

export function renderFrame(input: FrameInput): string[] {
  const width = Math.max(input.columns, MIN_COLUMNS);
  const status = input.status;

  const lines = [
    '',
    wordmark(width, input.version),
    indent(dim('═'.repeat(width - 4)), width),
    '',
    ...pair(crew(status), currentService(status), width),
    ...pair(transponder(status), comms(status), width),
    ...serviceStatus(status, input.version)(width),
    ...ground(status, width),
    '',
    ...notices(status, input.version, width),
  ];

  if (input.showLogs) {
    lines.push(...logPane(input.logs, width), '');
  }

  lines.push(
    indent(
      input.prompt === null ? hint(input) : promptLine(input.prompt),
      width,
    ),
  );

  return lines;
}

export function renderTitle(status: StatusSnapshot): string {
  const broken = TITLE_CRITICAL.find((name) =>
    TITLE_BROKEN.includes(status.connections[name]),
  );

  if (broken !== undefined) {
    return `${broken} ${status.connections[broken]} · ${TITLE_SUFFIX}`;
  }

  if (!status.transmitting) {
    return `standby · ${TITLE_SUFFIX}`;
  }

  if (status.callsign === null) {
    return `no flight · ${TITLE_SUFFIX}`;
  }

  return `${status.callsign} · ${status.publishedCount} sent · ${TITLE_SUFFIX}`;
}

function promptLine(prompt: FramePrompt): string {
  return `${prompt.label} › ${bold(prompt.value)}${cyan('█')}  ${dim(prompt.hint)}`;
}

function wordmark(width: number, version: string): string {
  const name = `${bold('MYPREFLIGHT')} ${dim('·')} ${grey('transponder')}`;
  const tag = dim(`v${version}`);
  const gap = width - 4 - visibleWidth(name) - visibleWidth(tag);

  return gap < 1
    ? indent(toVisibleWidth(name, width - 4), width)
    : indent(`${name}${' '.repeat(gap)}${tag}`, width);
}

function pair(
  left: (width: number) => string[],
  right: (width: number) => string[],
  width: number,
): string[] {
  if (width < SIDE_BY_SIDE_COLUMNS) {
    return [...left(width), ...right(width)];
  }

  const half = Math.floor(width / 2);

  return join(left(half), right(width - half));
}

function crew(status: StatusSnapshot): (width: number) => string[] {
  const { crew: member } = status;

  if (member === null) {
    return box('1 CREW', [
      dim('not signed in'),
      dim(
        status.signIn === null
          ? 'press s to sign in'
          : 'waiting for the browser',
      ),
    ]);
  }

  return box('1 CREW', [bold(member.name), member.email]);
}

function currentService(status: StatusSnapshot): (width: number) => string[] {
  const { service } = status;

  if (service === null) {
    return box('2 CRNT SERVICE', [dim('no current flight'), '']);
  }

  return box('2 CRNT SERVICE', (inner) => {
    const full = `${bold(service.callsign)} ${dim('*')} ${route(service, true)}`;
    const head =
      visibleWidth(full) <= inner
        ? full
        : `${bold(service.callsign)} ${dim('*')} ${route(service, false)}`;

    return [
      head,
      `airframe: ${field(service.airframe)} ${dim('*')} tail: ${field(service.registration)}`,
    ];
  });
}

function route(service: CurrentService, withNames: boolean): string {
  return (
    `${airport(service.departure, withNames)} ${dim('->')} ` +
    `${airport(service.arrival, withNames)}`
  );
}

function airport(place: ServiceAirport | null, withName: boolean): string {
  if (place === null) {
    return dim('[—]');
  }

  const code = field(place.iata ?? place.icao);

  return withName && place.name !== null ? `${code} ${place.name}` : code;
}

function transponder(status: StatusSnapshot): (width: number) => string[] {
  return box('3 XPNDR', [
    row(
      'sim',
      `${marker(status.connections.simulator)} ${status.connections.simulator}`,
    ),
    row('callsign', field(status.callsign)),
    row('tail', field(status.aircraftIdentifier)),
    row('squawk', field(status.squawk)),
    row('mode', mode(status)),
    row(
      'spd',
      status.groundSpeedKt === null
        ? dim('—')
        : `${Math.round(status.groundSpeedKt)}kt`,
    ),
    row('call', lastCall(status.lastAcceptedReportAt)),
  ]);
}

function mode(status: StatusSnapshot): string {
  return status.transmitting ? `[${green('MODE C')}]` : `[${dim('STBY')}]`;
}

function lastCall(at: Date | null): string {
  if (at === null) {
    return dim('—');
  }

  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}z`;
}

function comms(status: StatusSnapshot): (width: number) => string[] {
  const { connections, presenceState, presenceDetails } = status;
  const publishing = presenceState !== null || presenceDetails !== null;

  return box('4 COMMS', [
    row('discord', `${marker(connections.discord)} ${connections.discord}`),
    row('presence', publishing ? `[${green('ON')}]` : `[${dim('OFF')}]`),
    presenceDetails === null ? '' : dim(presenceDetails),
    presenceState === null ? '' : dim(presenceState),
    '',
    '',
    '',
  ]);
}

function serviceStatus(
  status: StatusSnapshot,
  version: string,
): (width: number) => string[] {
  return box('5 STATUS', [
    [
      `adsb: ${health(status.connections.adsb, status.serviceVersions.adsb)}`,
      `tracker: ${health(status.connections.api, status.serviceVersions.api)}`,
      `xpndr: ${transponderHealth(status, version)}`,
    ].join(dim(' · ')),
  ]);
}

function transponderHealth(status: StatusSnapshot, version: string): string {
  const { update } = status;

  if (update.phase === 'downloading') {
    return `[${amber(`DOWNLOADING ${share(update.receivedBytes, update.totalBytes)}`)}]`;
  }

  if (update.phase === 'saved') {
    return `[${green('UPDATE SAVED')}]`;
  }

  return isUpdateAvailable(version, status.latestRelease)
    ? `[${amber(`UPDATE v${status.latestRelease}`)}]`
    : `[${green('OK')}, v${version}]`;
}

function share(receivedBytes: number, totalBytes: number | null): string {
  return totalBytes === null || totalBytes === 0
    ? megabytes(receivedBytes)
    : `${Math.floor((receivedBytes / totalBytes) * 100)}%`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)}MB`;
}

function health(state: ConnectionState, version: string | null): string {
  const suffix = version === null ? '' : `, v${version}`;

  if (state === 'unauthorised') {
    return `[${amber('UNAUTHORISED')}${suffix}]`;
  }

  if (state === 'disconnected') {
    return `[${red('OFFLINE')}${suffix}]`;
  }

  return `[${green('OK')}${suffix}]`;
}

const SERVICE_LABEL_WIDTH = 11;

const SERVICE_STATES: Record<ServiceState, string> = {
  requestable: 'READY',
  requested: 'CALLED',
  performing: 'RUNNING',
  completed: 'DONE',
  bypassed: 'SKIPPED',
};

const SERVICE_COLOURS: Record<ServiceState, Style> = {
  requestable: dim,
  requested: cyan,
  performing: green,
  completed: grey,
  bypassed: amber,
};

function ground(status: StatusSnapshot, width: number): string[] {
  if (status.groundServices.length === 0) {
    return [];
  }

  return box('6 GROUND', (inner) => [
    ...standRow(status),
    ...status.groundServices.map((service) => serviceRow(service, inner)),
  ])(width);
}

function standRow(status: StatusSnapshot): string[] {
  const { airport: icao, parking } = status.stand;
  const stand = parking === null ? null : (parking.split('|').at(-1) ?? null);
  const parts = [icao, stand].filter((part): part is string => part !== null);

  return parts.length === 0 ? [] : [dim(parts.join(' · '))];
}

function serviceRow(service: GroundService, inner: number): string {
  const name = service.id.padEnd(SERVICE_LABEL_WIDTH);
  const state = serviceState(service.state);
  const detail = serviceDetail(service);
  const head = `${name}${state}`;

  return detail === ''
    ? head
    : `${head}  ${toVisibleWidth(dim(detail), Math.max(inner - visibleWidth(head) - 3, 0))}`;
}

function serviceState(state: ServiceState | null): string {
  if (state === null) {
    return `[${dim('—')}]`.padEnd(SERVICE_LABEL_WIDTH + 9);
  }

  const colour = SERVICE_COLOURS[state];
  const label = SERVICE_STATES[state];

  return `[${colour(label)}]${' '.repeat(Math.max(9 - label.length, 0))}`;
}

function serviceDetail(service: GroundService): string {
  const parts: string[] = [];

  if (service.passengers !== null) {
    parts.push(`${service.passengers.done}/${service.passengers.total} pax`);
  }

  if (service.fuel !== null) {
    parts.push(`${service.fuel.loaded} ${service.fuel.unit} loaded`);
  }

  if (service.bagsPercent !== null) {
    parts.push(`bags ${service.bagsPercent}%`);
  }

  for (const hold of service.cargo) {
    parts.push(`${hold.hold} ${hold.done}/${hold.total} ${hold.unit}`);
  }

  if (parts.length === 0 && service.phase !== null) {
    parts.push(service.phase);
  }

  return parts.join(' · ');
}

const LABEL_WIDTH = 10;

function row(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

function field(value: string | null): string {
  return value === null ? dim('[—]') : `[${bold(value)}]`;
}

function box(
  title: string,
  rows: string[] | ((inner: number) => string[]),
): (width: number) => string[] {
  return (width) => {
    const inner = width - 2;
    const content = typeof rows === 'function' ? rows(inner - 1) : rows;

    const [number, ...rest] = title.split(' ');
    const head = `${dim('─')} ${grey(number ?? '')} ${bold(rest.join(' '))} `;

    return [
      `${dim('╭')}${headingRule(head, inner)}${dim('╮')}`,
      ...content.map(
        (row) => `${dim('│')}${toVisibleWidth(` ${row}`, inner)}${dim('│')}`,
      ),
      dim(`╰${'─'.repeat(Math.max(inner, 0))}╯`),
    ];
  };
}

function join(left: string[], right: string[]): string[] {
  const height = Math.max(left.length, right.length);
  const lines: string[] = [];

  for (let row = 0; row < height; row += 1) {
    lines.push(`${left[row] ?? ''}${right[row] ?? ''}`);
  }

  return lines;
}

function logPane(logs: string[], width: number): string[] {
  const recent = logs.slice(-LOG_ROWS);
  const padding = Array.from({ length: LOG_ROWS - recent.length }, () => '');

  return [
    indent(dim('─'.repeat(width - 4)), width),
    ...[...recent, ...padding].map((line) =>
      indent(toVisibleWidth(line, width - 4), width),
    ),
  ];
}

function key(letter: string, label: string, enabled = true): string {
  return enabled
    ? // Three levels: the brackets barely there, the letter the one bright thing
      `${dim('[')}${brightCyan(letter)}${dim(']')} ${grey(label)}`
    : dim(`[${letter}] ${label}`);
}

function hint(input: FrameInput): string {
  const { status } = input;
  const signedIn = status.crew !== null;

  return [
    signedIn
      ? // Signing out mid-transmission would strand a flight halfway through
        key('s', 'sign out', !status.transmitting)
      : status.signIn === null
        ? key('s', 'sign in')
        : key('esc', 'cancel'),
    key('t', 'xpndr mode'),
    key('c', 'callsign'),
    key('r', 'refresh'),
    key('d', input.showLogs ? 'hide debug' : 'debug'),
  ].join(dim(' · '));
}

function indent(text: string, width: number): string {
  return toVisibleWidth(`  ${text}`, width);
}

function headingRule(head: string, inner: number): string {
  const width = visibleWidth(head);

  return width > inner
    ? toVisibleWidth(head, inner)
    : `${head}${dim('─'.repeat(inner - width))}`;
}

const FAULT_ORDER: ConnectionName[] = ['simulator', 'api', 'adsb', 'discord'];

const UPDATE_KEY = 'u';

function notices(
  status: StatusSnapshot,
  version: string,
  width: number,
): string[] {
  const blocks: string[][] = [];

  if (status.signIn !== null) {
    blocks.push(
      annotation(
        cyan('>'),
        'sign in',
        `approve code ${status.signIn.userCode} at ${status.signIn.verificationUri}`,
        width,
      ),
    );
  }

  if (status.storageFault !== null) {
    blocks.push(
      annotation(reverse(red('!')), 'storage', status.storageFault, width),
    );
  }

  const name = FAULT_ORDER.find(
    (each) =>
      status.faults[each] !== null &&
      !(each === 'api' && status.signIn !== null),
  );

  if (name !== undefined) {
    blocks.push(
      annotation(reverse(red('!')), name, status.faults[name] ?? '', width),
    );
  }

  const update = updateNotice(status, version);

  if (update !== null) {
    blocks.push(annotation(update.marker, 'update', update.text, width));
  }

  return blocks.flatMap((block) => [...block, '']);
}

function updateNotice(
  status: StatusSnapshot,
  version: string,
): { marker: string; text: string } | null {
  const { update, latestRelease } = status;

  if (update.phase === 'downloading') {
    return {
      marker: amber('v'),
      text:
        `downloading v${latestRelease ?? '?'} — ` +
        `${share(update.receivedBytes, update.totalBytes)} of ${megabytes(update.totalBytes ?? update.receivedBytes)}`,
    };
  }

  if (update.phase === 'saved') {
    return {
      marker: green('*'),
      text: `saved to ${update.path} — quit the app and swap the executable for it`,
    };
  }

  if (update.phase === 'failed') {
    return {
      marker: amber('!'),
      text: `${update.reason} — press [${UPDATE_KEY}] to try again`,
    };
  }

  return isUpdateAvailable(version, latestRelease)
    ? {
        marker: amber('^'),
        text: `v${latestRelease} is out — press [${UPDATE_KEY}] to save it to your Downloads folder`,
      }
    : null;
}

function annotation(
  marker: string,
  name: string,
  message: string,
  width: number,
): string[] {
  const label = `${marker} ${bold(name)} ${dim('—')} `;
  const gutter = visibleWidth(label);
  const room = Math.max(width - 4 - gutter, MIN_FAULT_ROOM);

  return wrap(message, room).map((line, row) =>
    indent(
      row === 0 ? `${label}${line}` : `${' '.repeat(gutter)}${line}`,
      width,
    ),
  );
}

const MAX_FAULT_ROWS = 3;
const MIN_FAULT_ROOM = 16;

function wrap(text: string, room: number): string[] {
  const lines: string[] = [];
  let line = '';

  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    for (const piece of split(word, room)) {
      if (line === '') {
        line = piece;
      } else if (line.length + 1 + piece.length <= room) {
        line = `${line} ${piece}`;
      } else {
        lines.push(line);
        line = piece;
      }
    }
  }

  if (line !== '') {
    lines.push(line);
  }

  if (lines.length <= MAX_FAULT_ROWS) {
    return lines.length === 0 ? [''] : lines;
  }

  const kept = lines.slice(0, MAX_FAULT_ROWS);
  kept[MAX_FAULT_ROWS - 1] =
    `${(kept[MAX_FAULT_ROWS - 1] ?? '').slice(0, Math.max(room - 2, 1))}…`;

  return kept;
}

function split(word: string, room: number): string[] {
  if (word.length <= room) {
    return [word];
  }

  const pieces: string[] = [];

  for (let at = 0; at < word.length; at += room) {
    pieces.push(word.slice(at, at + room));
  }

  return pieces;
}
