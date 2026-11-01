import { PromptCancelledError } from '../../application/ports/prompt';
import { ConsolePrompt, type PromptInput, type PromptOutput } from './prompt';

const BACKSPACE = '\u0008';
const DELETE = '\u007f';
const CANCEL = '\u0003';

class FakeInput implements PromptInput {
  rawModes: boolean[] = [];
  paused = false;
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
    this.paused = false;

    return this;
  }

  pause(): unknown {
    this.paused = true;

    return this;
  }

  type(chunk: string): void {
    this.listener?.(chunk);
  }

  get listening(): boolean {
    return this.listener !== null;
  }
}

class FakeOutput implements PromptOutput {
  written = '';

  write(text: string): unknown {
    this.written += text;

    return true;
  }
}

describe('ConsolePrompt', () => {
  it('returns what was typed before Enter', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const answer = new ConsolePrompt(input, output).ask('email: ');

    input.type('pilot@example.com\r');

    expect(await answer).toBe('pilot@example.com');
  });

  it('echoes a visible answer', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const answer = new ConsolePrompt(input, output).ask('email: ');

    input.type('abc\r');
    await answer;

    expect(output.written).toBe('email: abc\n');
  });

  it('accepts input arriving one character at a time', async () => {
    const input = new FakeInput();
    const answer = new ConsolePrompt(input, new FakeOutput()).ask('email: ');

    for (const character of 'abc\n') {
      input.type(character);
    }

    expect(await answer).toBe('abc');
  });

  it('erases the last character on backspace', async () => {
    const input = new FakeInput();
    const answer = new ConsolePrompt(input, new FakeOutput()).ask('email: ');

    input.type(`ab${BACKSPACE}c${DELETE}d\r`);

    expect(await answer).toBe('ad');
  });

  it('ignores backspace on an empty answer', async () => {
    const input = new FakeInput();
    const answer = new ConsolePrompt(input, new FakeOutput()).ask('email: ');

    input.type(`${BACKSPACE}a\r`);

    expect(await answer).toBe('a');
  });

  it('rejects when the pilot presses ctrl-c', async () => {
    const input = new FakeInput();
    const answer = new ConsolePrompt(input, new FakeOutput()).ask('email: ');

    input.type(CANCEL);

    await expect(answer).rejects.toBeInstanceOf(PromptCancelledError);
  });

  it('leaves the terminal as it found it', async () => {
    const input = new FakeInput();
    const answer = new ConsolePrompt(input, new FakeOutput()).ask('email: ');

    input.type('a\r');
    await answer;

    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(input.listening).toBe(false);
  });

  it('keeps what followed Enter for the next question', async () => {
    const input = new FakeInput();
    const prompt = new ConsolePrompt(input, new FakeOutput());
    const first = prompt.ask('first: ');

    input.type('one\ntwo\n');

    expect(await first).toBe('one');
    expect(await prompt.ask('second: ')).toBe('two');
  });

  it('answers both questions from a single pasted chunk', async () => {
    const input = new FakeInput();
    const prompt = new ConsolePrompt(input, new FakeOutput());
    const first = prompt.ask('first: ');

    input.type('one\r\ntwo\r\n');

    expect(await first).toBe('one');
    expect(await prompt.ask('second: ')).toBe('two');
  });

  it('treats a windows line ending as one Enter', async () => {
    const input = new FakeInput();
    const prompt = new ConsolePrompt(input, new FakeOutput());
    const first = prompt.ask('first: ');

    input.type('a\r\n');
    await first;

    const second = prompt.ask('second: ');
    input.type('b\r\n');

    expect(await second).toBe('b');
  });

  it('treats a line ending split across chunks as one Enter', async () => {
    const input = new FakeInput();
    const prompt = new ConsolePrompt(input, new FakeOutput());
    const first = prompt.ask('first: ');

    input.type('a\r');
    await first;

    const second = prompt.ask('second: ');
    input.type('\nb\r');

    expect(await second).toBe('b');
  });

  it('shows the address and the code to compare in the browser', () => {
    const output = new FakeOutput();

    process.env.NO_COLOR = '1';

    try {
      new ConsolePrompt(new FakeInput(), output).showCode({
        userCode: 'BCDF-GHJK',
        verificationUri: 'https://mypreflight.io/activate',
      });
    } finally {
      delete process.env.NO_COLOR;
    }

    expect(output.written).toContain('Sign in to MyPreflight in your browser.');
    expect(output.written).toContain('Open  https://mypreflight.io/activate');
    expect(output.written).toContain('Code  BCDF-GHJK');
    expect(output.written).toContain('Ctrl+C cancels.');
  });

  it('cancels the wait when the pilot presses ctrl-c', async () => {
    const input = new FakeInput();
    const prompt = new ConsolePrompt(input, new FakeOutput());
    const seen: { signal: AbortSignal | null } = { signal: null };

    const waiting = prompt.cancellable(
      (signal) =>
        new Promise<string>((resolve) => {
          seen.signal = signal;
          signal.addEventListener('abort', () => resolve('stopped'));
        }),
    );

    input.type('x');
    expect(seen.signal?.aborted).toBe(false);

    input.type(CANCEL);

    await expect(waiting).resolves.toBe('stopped');
    expect(seen.signal?.aborted).toBe(true);
  });

  it('lets the wait end on its own without a key', async () => {
    const input = new FakeInput();
    const prompt = new ConsolePrompt(input, new FakeOutput());

    await expect(prompt.cancellable(() => Promise.resolve(42))).resolves.toBe(
      42,
    );
  });

  it('leaves the terminal as it found it after the wait', async () => {
    const input = new FakeInput();
    const prompt = new ConsolePrompt(input, new FakeOutput());

    await prompt
      .cancellable(() => Promise.reject(new Error('boom')))
      .catch(() => undefined);

    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
    expect(input.listening).toBe(false);
  });

  it('does not carry keys pressed while waiting into the next question', async () => {
    const input = new FakeInput();
    const prompt = new ConsolePrompt(input, new FakeOutput());
    const first = prompt.ask('first: ');

    input.type('a\rstale\r');
    await first;

    await prompt.cancellable(() => Promise.resolve());

    const second = prompt.ask('second: ');
    input.type('fresh\r');

    expect(await second).toBe('fresh');
  });
});
