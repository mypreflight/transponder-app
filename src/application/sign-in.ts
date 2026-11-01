import { describeError } from './supervisor';
import type { Browser } from './ports/browser';
import type {
  DeviceApproval,
  DeviceCode,
  DeviceSignIn,
  SignInCode,
} from './ports/device-sign-in';
import type { Logger } from './ports/logger';
import { type Prompt, PromptCancelledError } from './ports/prompt';

export type SignInOutcome =
  | 'signed-in'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'unavailable';

export type SignInLogger = Pick<Logger, 'debug' | 'info' | 'error'>;

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export type BrowserSignIn = {
  api: DeviceSignIn;
  browser: Browser;
  logger: SignInLogger;
  deviceName: string;
  now?: () => number;
  sleep?: Sleep;
};

export const SIGN_IN_FAULTS: Record<
  Exclude<SignInOutcome, 'signed-in'>,
  string
> = {
  declined: 'sign-in declined in the browser; press s to try again',
  expired: 'the sign-in code expired; press s for a new one',
  cancelled: 'not signed in; press s to sign in',
  unavailable: 'could not start the sign-in; press s to try again',
};

const ANSWERS: Record<Exclude<DeviceApproval, 'pending'>, SignInOutcome> = {
  approved: 'signed-in',
  declined: 'declined',
  expired: 'expired',
};

const OFFERS: Partial<Record<SignInOutcome, string>> = {
  expired: 'Press Enter for a new code, or Ctrl+C to skip. ',
  unavailable: 'Press Enter to try again, or Ctrl+C to skip. ',
};

export async function signInThroughBrowser(
  flow: BrowserSignIn,
  show: (code: SignInCode) => void,
  signal: AbortSignal,
): Promise<SignInOutcome> {
  const now = flow.now ?? Date.now;
  const sleep = flow.sleep ?? abortableSleep;
  let code: DeviceCode;

  try {
    code = await flow.api.startDeviceSignIn(flow.deviceName, signal);
  } catch (error) {
    return signal.aborted
      ? settle(flow.logger, 'cancelled')
      : settle(flow.logger, 'unavailable', describeError(error));
  }

  show({ userCode: code.userCode, verificationUri: code.verificationUri });
  openBrowser(flow, code.verificationUriComplete);

  const deadline = now() + code.expiresInSeconds * 1000;
  const interval = code.intervalSeconds * 1000;

  for (;;) {
    const remaining = deadline - now();

    if (remaining <= 0) {
      return settle(flow.logger, 'expired');
    }

    await sleep(Math.min(interval, remaining), signal);

    if (signal.aborted) {
      return settle(flow.logger, 'cancelled');
    }

    if (now() >= deadline) {
      return settle(flow.logger, 'expired');
    }

    let approval: DeviceApproval;

    try {
      approval = await flow.api.pollDeviceSignIn(code.deviceCode, signal);
    } catch (error) {
      if (signal.aborted) {
        return settle(flow.logger, 'cancelled');
      }

      flow.logger.debug(
        `no answer about the sign-in yet: ${describeError(error)}`,
      );
      continue;
    }

    if (approval !== 'pending') {
      return settle(flow.logger, ANSWERS[approval]);
    }
  }
}

export async function promptForSignIn(
  flow: BrowserSignIn,
  prompt: Prompt,
): Promise<boolean> {
  for (;;) {
    const outcome = await prompt.cancellable((signal) =>
      signInThroughBrowser(flow, (code) => prompt.showCode(code), signal),
    );

    if (outcome === 'signed-in') {
      return true;
    }

    const offer = OFFERS[outcome];

    if (offer === undefined) {
      return false;
    }

    try {
      await prompt.ask(offer);
    } catch (error) {
      if (error instanceof PromptCancelledError) {
        flow.logger.info('sign-in cancelled');

        return false;
      }

      throw error;
    }
  }
}

function settle(
  logger: SignInLogger,
  outcome: SignInOutcome,
  reason = '',
): SignInOutcome {
  if (outcome === 'signed-in') {
    logger.info('signed in');
  } else if (outcome === 'cancelled') {
    logger.info('sign-in cancelled');
  } else if (outcome === 'declined') {
    logger.error('sign-in declined in the browser');
  } else if (outcome === 'expired') {
    logger.error('the sign-in code expired');
  } else {
    logger.error(`sign-in failed: ${reason}`);
  }

  return outcome;
}

function openBrowser(flow: BrowserSignIn, url: string): void {
  void flow.browser.open(url).then(
    (opened) => {
      if (!opened) {
        flow.logger.debug('could not open the browser');
      }
    },
    (error: unknown) => {
      flow.logger.debug(`could not open the browser: ${describeError(error)}`);
    },
  );
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();

      return;
    }

    const wake = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);

    signal.addEventListener('abort', wake, { once: true });
  });
}
