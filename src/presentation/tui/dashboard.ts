import { isUpdateAvailable } from '../../domain/release';
import type { StatusRegistry } from '../../application/status';
import type { PromptInput } from './prompt';
import { type FramePrompt, renderFrame, renderTitle } from './frame';
import type { Screen } from './screen';

const REFRESH_MS = 250;
const LOG_CAPACITY = 200;
const DEBUG_KEY = 'd';
const CALLSIGN_KEY = 'c';
const REFRESH_KEY = 'r';
const SESSION_KEY = 's';
const TRANSMIT_KEY = 't';
const UPDATE_KEY = 'u';
const CANCEL = '\u0003';
const ESCAPE = '\u001b';
const ENTER = ['\r', '\n'];
const BACKSPACE = ['\u0008', '\u007f'];
const MAX_CALLSIGN = 12;

export type Columns = () => number;

export type DashboardHandlers = {
  onQuit: () => void;
  onCallsign: (callsign: string | null) => void;
  onSignIn: () => void;
  onCancelSignIn: () => void;
  onSignOut: () => void;
  onTransmit: () => void;
  onRefresh: () => void;
  onUpdate: () => void;
};

const IGNORE: DashboardHandlers = {
  onQuit: () => undefined,
  onCallsign: () => undefined,
  onSignIn: () => undefined,
  onCancelSignIn: () => undefined,
  onSignOut: () => undefined,
  onTransmit: () => undefined,
  onRefresh: () => undefined,
  onUpdate: () => undefined,
};

type Field = {
  label: string;
  hint: string;
  maxLength: number;
  submit: (value: string) => void;
};

export class Dashboard {
  private readonly logs: string[] = [];
  private showLogs = false;
  private field: Field | null = null;
  private draft = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private listener: ((chunk: string) => void) | null = null;
  private handlers: DashboardHandlers = IGNORE;

  constructor(
    private readonly screen: Screen,
    private readonly status: StatusRegistry,
    private readonly version: string,
    private readonly columns: Columns,
    private readonly input: PromptInput | null = null,
  ) {}

  append(line: string): void {
    this.logs.push(line);

    if (this.logs.length > LOG_CAPACITY) {
      this.logs.shift();
    }
  }

  start(handlers: DashboardHandlers): void {
    this.handlers = handlers;
    this.screen.start();
    this.render();
    this.timer = setInterval(() => this.render(), REFRESH_MS);
    this.listen();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.unlisten();
    this.screen.stop();
  }

  resize(): void {
    this.screen.invalidate();
    this.render();
  }

  toggleLogs(): void {
    this.showLogs = !this.showLogs;
    this.screen.invalidate();
    this.render();
  }

  revealLogs(): void {
    if (this.showLogs) {
      this.render();

      return;
    }

    this.toggleLogs();
  }

  render(): void {
    const status = this.status.snapshot();

    this.screen.title(renderTitle(status));
    this.screen.paint(
      renderFrame({
        status,
        version: this.version,
        columns: this.columns(),
        logs: this.logs,
        showLogs: this.showLogs,
        prompt: this.prompt(),
      }),
    );
  }

  private prompt(): FramePrompt | null {
    const field = this.field;

    if (field === null) {
      return null;
    }

    return {
      label: field.label,
      value: this.draft,
      hint: field.hint,
    };
  }

  private ask(field: Field): void {
    this.field = field;
    this.draft = '';
    this.render();
  }

  private askCallsign(): void {
    this.ask({
      label: 'callsign',
      hint: 'enter to set · empty follows the flight · esc cancels',
      maxLength: MAX_CALLSIGN,
      submit: (typed) => this.handlers.onCallsign(typed === '' ? null : typed),
    });
  }

  private session(): void {
    const status = this.status.snapshot();

    if (status.crew === null) {
      if (status.signIn === null) {
        this.handlers.onSignIn();
        this.render();
      }

      return;
    }

    if (status.transmitting) {
      return;
    }

    this.handlers.onSignOut();
    this.render();
  }

  private listen(): void {
    if (this.input === null) {
      return;
    }

    const listener = (chunk: string): void => {
      for (const character of chunk) {
        if (this.field === null) {
          this.command(character);
        } else {
          this.edit(character);
        }
      }
    };

    this.input.setEncoding('utf-8');
    this.input.setRawMode?.(true);
    this.input.resume();
    this.input.on('data', listener);
    this.listener = listener;
  }

  private command(character: string): void {
    const signingIn = this.status.snapshot().signIn !== null;

    if (signingIn && (character === ESCAPE || character === CANCEL)) {
      this.handlers.onCancelSignIn();
      this.render();

      return;
    }

    if (character === CANCEL) {
      this.handlers.onQuit();

      return;
    }

    const key = character.toLowerCase();

    if (key === DEBUG_KEY) {
      this.toggleLogs();

      return;
    }

    if (key === CALLSIGN_KEY) {
      this.askCallsign();

      return;
    }

    if (key === SESSION_KEY) {
      this.session();

      return;
    }

    if (key === REFRESH_KEY) {
      this.handlers.onRefresh();
      this.render();

      return;
    }

    if (key === TRANSMIT_KEY) {
      this.handlers.onTransmit();
      this.render();

      return;
    }

    if (key === UPDATE_KEY) {
      this.update();
    }
  }

  private update(): void {
    const status = this.status.snapshot();

    if (
      !isUpdateAvailable(this.version, status.latestRelease) ||
      status.update.phase === 'downloading'
    ) {
      return;
    }

    this.handlers.onUpdate();
    this.render();
  }

  private edit(character: string): void {
    if (character === ESCAPE || character === CANCEL) {
      this.field = null;
      this.draft = '';
      this.render();

      return;
    }

    if (ENTER.includes(character)) {
      const field = this.field;
      const typed = this.draft.trim();

      this.field = null;
      this.draft = '';
      field?.submit(typed);
      this.render();

      return;
    }

    if (BACKSPACE.includes(character)) {
      this.draft = this.draft.slice(0, -1);
      this.render();

      return;
    }

    if (
      !printable(character) ||
      this.draft.length >= (this.field?.maxLength ?? MAX_CALLSIGN)
    ) {
      return;
    }

    this.draft = `${this.draft}${character}`;
    this.render();
  }

  private unlisten(): void {
    if (this.input === null || this.listener === null) {
      return;
    }

    this.input.off('data', this.listener);
    this.input.setRawMode?.(false);
    this.listener = null;
  }
}

function printable(character: string): boolean {
  const code = character.charCodeAt(0);

  return code >= 32 && code !== 127;
}
