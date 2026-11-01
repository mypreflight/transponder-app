import type { SignInCode } from './device-sign-in';

export interface Prompt {
  ask(question: string): Promise<string>;
  showCode(code: SignInCode): void;
  cancellable<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

export class PromptCancelledError extends Error {
  constructor() {
    super('The pilot cancelled the prompt.');
  }
}
