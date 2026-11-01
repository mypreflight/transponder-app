import type { Browser } from './ports/browser';
import type {
  DeviceApproval,
  DeviceCode,
  DeviceSignIn,
  SignInCode,
} from './ports/device-sign-in';
import { type Prompt, PromptCancelledError } from './ports/prompt';
import {
  type BrowserSignIn,
  promptForSignIn,
  type SignInLogger,
  signInThroughBrowser,
} from './sign-in';

const CODE: DeviceCode = {
  deviceCode: 'b9W3mQ0xR7cYk2Lp8sVd1nHf6gJt4aZe5uBo',
  userCode: 'BCDF-GHJK',
  verificationUri: 'https://mypreflight.io/activate',
  verificationUriComplete: 'https://mypreflight.io/activate?code=BCDF-GHJK',
  expiresInSeconds: 600,
  intervalSeconds: 5,
};

type Answer = DeviceApproval | Error;

type Api = DeviceSignIn & {
  names: string[];
  polled: string[];
  started: number;
};

function api(
  answers: Answer[],
  start: () => Promise<DeviceCode> = () => Promise.resolve(CODE),
): Api {
  const queue = [...answers];

  return {
    names: [],
    polled: [],
    started: 0,
    startDeviceSignIn(deviceName) {
      this.names.push(deviceName);
      this.started += 1;

      return start();
    },
    pollDeviceSignIn(deviceCode) {
      this.polled.push(deviceCode);

      const answer = queue.shift() ?? 'pending';

      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
  };
}

function browser(
  open: Browser['open'] = () => Promise.resolve(true),
): Browser & {
  opened: string[];
} {
  const opened: string[] = [];

  return {
    opened,
    open: (url) => {
      opened.push(url);

      return open(url);
    },
  };
}

function recordingLogger(): SignInLogger & { lines: string[] } {
  const lines: string[] = [];

  return {
    lines,
    debug: (message) => lines.push(message),
    info: (message) => lines.push(message),
    error: (message) => lines.push(message),
  };
}

function setup(
  answers: Answer[],
  overrides: Partial<BrowserSignIn> = {},
  code: Partial<DeviceCode> = {},
): {
  flow: BrowserSignIn;
  api: Api;
  browser: Browser & { opened: string[] };
  logger: SignInLogger & { lines: string[] };
  sleeps: number[];
  shown: SignInCode[];
  clock: { now: number };
  controller: AbortController;
  run: () => ReturnType<typeof signInThroughBrowser>;
} {
  const fake = api(answers, () => Promise.resolve({ ...CODE, ...code }));
  const open = browser();
  const logger = recordingLogger();
  const sleeps: number[] = [];
  const shown: SignInCode[] = [];
  const clock = { now: 0 };
  const controller = new AbortController();
  const flow: BrowserSignIn = {
    api: fake,
    browser: open,
    logger,
    deviceName: 'SIM-PC',
    now: () => clock.now,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.now += ms;

      return Promise.resolve();
    },
    ...overrides,
  };

  return {
    flow,
    api: fake,
    browser: open,
    logger,
    sleeps,
    shown,
    clock,
    controller,
    run: () =>
      signInThroughBrowser(flow, (code) => shown.push(code), controller.signal),
  };
}

describe('signInThroughBrowser', () => {
  it('signs in once the pilot approves in the browser', async () => {
    const { run, api } = setup(['pending', 'pending', 'approved']);

    await expect(run()).resolves.toBe('signed-in');
    expect(api.polled).toEqual([
      CODE.deviceCode,
      CODE.deviceCode,
      CODE.deviceCode,
    ]);
  });

  it('asks for the code under the name of this machine', async () => {
    const { run, api } = setup(['approved']);

    await run();

    expect(api.names).toEqual(['SIM-PC']);
  });

  it('shows the code and the address the pilot can type', async () => {
    const { run, shown } = setup(['approved']);

    await run();

    expect(shown).toEqual([
      {
        userCode: 'BCDF-GHJK',
        verificationUri: 'https://mypreflight.io/activate',
      },
    ]);
  });

  it('opens the browser on the address that carries the code', async () => {
    const { run, browser } = setup(['approved']);

    await run();

    expect(browser.opened).toEqual([
      'https://mypreflight.io/activate?code=BCDF-GHJK',
    ]);
  });

  it('shows the code before it opens the browser', async () => {
    const order: string[] = [];
    const { flow, controller } = setup(['approved'], {
      browser: {
        open: () => {
          order.push('open');

          return Promise.resolve(true);
        },
      },
    });

    await signInThroughBrowser(
      flow,
      () => order.push('show'),
      controller.signal,
    );

    expect(order).toEqual(['show', 'open']);
  });

  it('waits the interval the API asks for before every poll', async () => {
    const { run, sleeps } = setup(
      ['pending', 'pending', 'approved'],
      {},
      { intervalSeconds: 7 },
    );

    await run();

    expect(sleeps).toEqual([7_000, 7_000, 7_000]);
  });

  it('stops at once when the pilot declines', async () => {
    const { run, api, logger } = setup(['pending', 'declined', 'approved']);

    await expect(run()).resolves.toBe('declined');
    expect(api.polled).toHaveLength(2);
    expect(logger.lines).toContain('sign-in declined in the browser');
  });

  it('reports a code the API says has expired', async () => {
    const { run, logger } = setup(['pending', 'expired']);

    await expect(run()).resolves.toBe('expired');
    expect(logger.lines).toContain('the sign-in code expired');
  });

  it('gives up when the code runs out, without a poll past its expiry', async () => {
    const { run, api, sleeps } = setup(
      [],
      {},
      { expiresInSeconds: 12, intervalSeconds: 5 },
    );

    await expect(run()).resolves.toBe('expired');
    expect(sleeps).toEqual([5_000, 5_000, 2_000]);
    expect(api.polled).toHaveLength(2);
  });

  it('keeps polling through network errors and server faults', async () => {
    const { run, api } = setup([
      new Error('fetch failed'),
      new Error('The API answered 503 to the sign-in.'),
      'approved',
    ]);

    await expect(run()).resolves.toBe('signed-in');
    expect(api.polled).toHaveLength(3);
  });

  it('gives up at the expiry even while the API never answers', async () => {
    const { run, api } = setup(
      Array.from({ length: 10 }, () => new Error('fetch failed')),
      {},
      { expiresInSeconds: 20 },
    );

    await expect(run()).resolves.toBe('expired');
    expect(api.polled).toHaveLength(3);
  });

  it('stops polling as soon as the pilot cancels', async () => {
    const { flow, controller, api } = setup(['pending', 'pending', 'pending']);
    let sleeps = 0;

    flow.sleep = () => {
      sleeps += 1;

      if (sleeps === 2) {
        controller.abort();
      }

      return Promise.resolve();
    };

    await expect(
      signInThroughBrowser(flow, () => undefined, controller.signal),
    ).resolves.toBe('cancelled');
    expect(api.polled).toHaveLength(1);
  });

  it('treats a poll cut short by the cancel as the cancel', async () => {
    const { flow, controller, logger } = setup([]);

    flow.api = {
      ...flow.api,
      pollDeviceSignIn: () => {
        controller.abort();

        return Promise.reject(new Error('This operation was aborted'));
      },
    };

    await expect(
      signInThroughBrowser(flow, () => undefined, controller.signal),
    ).resolves.toBe('cancelled');
    expect(logger.lines).toContain('sign-in cancelled');
  });

  it('cancels before a code was even issued', async () => {
    const { flow, controller, shown } = setup([]);

    flow.api = {
      ...flow.api,
      startDeviceSignIn: () => {
        controller.abort();

        return Promise.reject(new Error('This operation was aborted'));
      },
    };

    await expect(
      signInThroughBrowser(flow, (code) => shown.push(code), controller.signal),
    ).resolves.toBe('cancelled');
    expect(shown).toEqual([]);
  });

  it('really waits between polls, and wakes up on a cancel', async () => {
    const { flow, controller, api } = setup([]);

    const running = signInThroughBrowser(
      {
        api: flow.api,
        browser: flow.browser,
        logger: flow.logger,
        deviceName: flow.deviceName,
      },
      () => undefined,
      controller.signal,
    );

    setTimeout(() => controller.abort(), 20);

    await expect(running).resolves.toBe('cancelled');
    expect(api.polled).toEqual([]);
  });

  it('carries on with the code on screen when the browser will not open', async () => {
    const { run, shown } = setup(['approved'], {
      browser: { open: () => Promise.resolve(false) },
    });

    await expect(run()).resolves.toBe('signed-in');
    expect(shown).toHaveLength(1);
  });

  it('carries on when opening the browser throws', async () => {
    const { run, logger } = setup(['approved'], {
      browser: { open: () => Promise.reject(new Error('spawn ENOENT')) },
    });

    await expect(run()).resolves.toBe('signed-in');
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.lines).toContain('could not open the browser: spawn ENOENT');
  });

  it('says why when a sign-in could not even start', async () => {
    const { flow, controller, logger, shown } = setup([]);

    flow.api = api([], () =>
      Promise.reject(new Error('The API answered 503 to the sign-in.')),
    );

    await expect(
      signInThroughBrowser(flow, (code) => shown.push(code), controller.signal),
    ).resolves.toBe('unavailable');
    expect(shown).toEqual([]);
    expect(logger.lines).toContain(
      'sign-in failed: The API answered 503 to the sign-in.',
    );
  });

  it('says so once signed in', async () => {
    const { run, logger } = setup(['approved']);

    await run();

    expect(logger.lines).toContain('signed in');
  });

  it('never writes the device code to the log', async () => {
    const { run, logger } = setup([
      new Error('fetch failed'),
      new Error('The API answered 503 to the sign-in.'),
      'declined',
    ]);

    await run();

    expect(logger.lines.join('\n')).not.toContain(CODE.deviceCode);
  });
});

function scriptedPrompt(
  outcomes: ('cancel' | 'run')[],
  answers: (string | PromptCancelledError)[] = [],
): Prompt & { shown: SignInCode[]; asked: string[] } {
  const shown: SignInCode[] = [];
  const asked: string[] = [];

  return {
    shown,
    asked,
    ask: (question) => {
      asked.push(question);

      const answer = answers.shift() ?? '';

      return answer instanceof PromptCancelledError
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    showCode: (code) => shown.push(code),
    cancellable: (work) => {
      const controller = new AbortController();

      if (outcomes.shift() === 'cancel') {
        controller.abort();
      }

      return work(controller.signal);
    },
  };
}

describe('promptForSignIn', () => {
  it('signs in through the browser from the console', async () => {
    const { flow } = setup(['pending', 'approved']);
    const prompt = scriptedPrompt(['run']);

    await expect(promptForSignIn(flow, prompt)).resolves.toBe(true);
    expect(prompt.shown).toEqual([
      {
        userCode: 'BCDF-GHJK',
        verificationUri: 'https://mypreflight.io/activate',
      },
    ]);
    expect(prompt.asked).toEqual([]);
  });

  it('offers a new code when the code expired, and signs in with it', async () => {
    const { flow, api } = setup(['expired', 'approved']);
    const prompt = scriptedPrompt(['run', 'run'], ['']);

    await expect(promptForSignIn(flow, prompt)).resolves.toBe(true);
    expect(prompt.asked).toEqual([
      'Press Enter for a new code, or Ctrl+C to skip. ',
    ]);
    expect(api.started).toBe(2);
  });

  it('offers another go when the sign-in could not start', async () => {
    const { flow } = setup(['approved']);
    let starts = 0;

    flow.api = {
      ...flow.api,
      startDeviceSignIn: () => {
        starts += 1;

        return starts === 1
          ? Promise.reject(new Error('fetch failed'))
          : Promise.resolve(CODE);
      },
    };

    const prompt = scriptedPrompt(['run', 'run'], ['']);

    await expect(promptForSignIn(flow, prompt)).resolves.toBe(true);
    expect(prompt.asked).toEqual([
      'Press Enter to try again, or Ctrl+C to skip. ',
    ]);
  });

  it('gives up when the pilot skips the new code', async () => {
    const { flow, api, logger } = setup(['expired']);
    const prompt = scriptedPrompt(['run'], [new PromptCancelledError()]);

    await expect(promptForSignIn(flow, prompt)).resolves.toBe(false);
    expect(api.started).toBe(1);
    expect(logger.lines.at(-1)).toBe('sign-in cancelled');
  });

  it('gives up without asking again when the pilot declined', async () => {
    const { flow } = setup(['declined']);
    const prompt = scriptedPrompt(['run']);

    await expect(promptForSignIn(flow, prompt)).resolves.toBe(false);
    expect(prompt.asked).toEqual([]);
  });

  it('gives up without asking again when the pilot cancelled the wait', async () => {
    const { flow, api } = setup(['approved']);
    const prompt = scriptedPrompt(['cancel']);

    await expect(promptForSignIn(flow, prompt)).resolves.toBe(false);
    expect(prompt.asked).toEqual([]);
    expect(api.polled).toEqual([]);
  });
});
