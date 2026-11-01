import type { SignInCode } from '../../application/ports/device-sign-in';
import {
  type Prompt,
  PromptCancelledError,
} from '../../application/ports/prompt';
import { bold } from './style';

export type PromptInput = {
  on(event: 'data', listener: (chunk: string) => void): unknown;
  off(event: 'data', listener: (chunk: string) => void): unknown;
  setEncoding(encoding: 'utf-8'): unknown;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
};

export type PromptOutput = {
  write(text: string): unknown;
};

const CARRIAGE_RETURN = '\r';
const LINE_FEED = '\n';
const BACKSPACE = ['\u0008', '\u007f'];
const CANCEL = '\u0003';
const ERASE = '\u0008 \u0008';

type Consumed = {
  complete: boolean;
  cancelled: boolean;
  rest: string;
};

export class ConsolePrompt implements Prompt {
  private pending = '';
  private skipLineFeed = false;

  constructor(
    private readonly input: PromptInput,
    private readonly output: PromptOutput,
  ) {}

  ask(question: string): Promise<string> {
    this.output.write(question);

    const typed: string[] = [];
    const buffered = this.pending;
    this.pending = '';
    const fromBuffer = this.consume(typed, buffered);

    if (fromBuffer.complete) {
      this.pending = fromBuffer.rest;
      this.output.write(LINE_FEED);

      return fromBuffer.cancelled
        ? Promise.reject(new PromptCancelledError())
        : Promise.resolve(typed.join(''));
    }

    this.input.setEncoding('utf-8');
    this.input.setRawMode?.(true);
    this.input.resume();

    return new Promise<string>((resolve, reject) => {
      const listener = (chunk: string): void => {
        const result = this.consume(typed, chunk);

        if (!result.complete) {
          return;
        }

        this.pending = result.rest;
        this.stop(listener);

        if (result.cancelled) {
          reject(new PromptCancelledError());

          return;
        }

        resolve(typed.join(''));
      };

      this.input.on('data', listener);
    });
  }

  showCode(code: SignInCode): void {
    this.output.write(
      [
        '',
        'Sign in to MyPreflight in your browser.',
        '',
        `  Open  ${code.verificationUri}`,
        `  Code  ${bold(code.userCode)}`,
        '',
        'Approve only if the browser shows the same code. Ctrl+C cancels.',
        '',
        '',
      ].join(LINE_FEED),
    );
  }

  async cancellable<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const listener = (chunk: string): void => {
      if (chunk.includes(CANCEL)) {
        controller.abort();
      }
    };

    this.pending = '';
    this.input.setEncoding('utf-8');
    this.input.setRawMode?.(true);
    this.input.resume();
    this.input.on('data', listener);

    try {
      return await work(controller.signal);
    } finally {
      this.input.off('data', listener);
      this.input.setRawMode?.(false);
      this.input.pause();
    }
  }

  private consume(typed: string[], chunk: string): Consumed {
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index] as string;

      if (this.skipLineFeed) {
        this.skipLineFeed = false;

        if (character === LINE_FEED) {
          continue;
        }
      }

      if (character === CARRIAGE_RETURN || character === LINE_FEED) {
        const skip =
          character === CARRIAGE_RETURN && chunk[index + 1] === LINE_FEED
            ? 2
            : 1;

        if (character === CARRIAGE_RETURN && skip === 1) {
          this.skipLineFeed = true;
        }

        return {
          complete: true,
          cancelled: false,
          rest: chunk.slice(index + skip),
        };
      }

      if (character === CANCEL) {
        return {
          complete: true,
          cancelled: true,
          rest: chunk.slice(index + 1),
        };
      }

      if (BACKSPACE.includes(character)) {
        if (typed.pop() !== undefined) {
          this.output.write(ERASE);
        }

        continue;
      }

      typed.push(character);
      this.output.write(character);
    }

    return { complete: false, cancelled: false, rest: '' };
  }

  private stop(listener: (chunk: string) => void): void {
    this.input.off('data', listener);
    this.input.setRawMode?.(false);
    this.input.pause();
    this.output.write(LINE_FEED);
  }
}
