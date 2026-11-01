import type {
  GroundService,
  ServiceId,
  ServiceState,
} from '../domain/ground-services';
import type { GsxSettings } from '../domain/gsx-automation';
import { GsxAutomation, RETRY_AFTER_MS } from './gsx-automation';
import type { FlightLifecycle } from './ports/flight-lifecycle';

const FLIGHT_ID = 'b3899775-278e-4496-add1-21385a13d93e';

const ALL_ON: GsxSettings = {
  integrationEnabled: true,
  autoBoardingEnabled: true,
  autoDeboardingEnabled: true,
};

function service(id: ServiceId, state: ServiceState): GroundService {
  return {
    id,
    state,
    phase: null,
    operator: null,
    passengers: null,
    bagsPercent: null,
    cargo: [],
    fuel: null,
  };
}

function setup(): {
  automation: GsxAutomation;
  calls: string[];
  logs: string[];
  warnings: string[];
  gsx: { running: GroundService[] };
  clock: { now: number };
  lifecycle: FlightLifecycle & { fail: Error | null };
} {
  const calls: string[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const gsx = { running: [] as GroundService[] };
  const clock = { now: 1_000 };
  const lifecycle = {
    fail: null as Error | null,
    startBoarding(flightId: string): Promise<void> {
      calls.push(`boarding ${flightId}`);

      return this.fail === null ? Promise.resolve() : Promise.reject(this.fail);
    },
    startOffboarding(flightId: string): Promise<void> {
      calls.push(`offboarding ${flightId}`);

      return this.fail === null ? Promise.resolve() : Promise.reject(this.fail);
    },
  };
  const logger = {
    debug: () => undefined,
    info: (line: string) => logs.push(line),
    warn: (line: string) => warnings.push(line),
    error: () => undefined,
    child: () => logger,
  };

  return {
    automation: new GsxAutomation(
      lifecycle,
      () => gsx.running,
      logger,
      () => clock.now,
    ),
    calls,
    logs,
    warnings,
    gsx,
    clock,
    lifecycle,
  };
}

describe('GsxAutomation', () => {
  it('starts boarding when the pilot requests it through GSX', async () => {
    const { automation, calls, logs, gsx } = setup();
    automation.setSettings(ALL_ON);
    automation.setFlight({ id: FLIGHT_ID, status: 'checked_in' });
    gsx.running = [service('boarding', 'requested')];

    await automation.evaluate();

    expect(calls).toEqual([`boarding ${FLIGHT_ID}`]);
    expect(logs).toEqual(['boarding started, as requested through GSX']);
  });

  it('starts offboarding when the pilot requests deboarding through GSX', async () => {
    const { automation, calls, gsx } = setup();
    automation.setSettings(ALL_ON);
    automation.setFlight({ id: FLIGHT_ID, status: 'on_block' });
    gsx.running = [service('deboarding', 'performing')];

    await automation.evaluate();

    expect(calls).toEqual([`offboarding ${FLIGHT_ID}`]);
  });

  it('starts it once, although GSX keeps reporting it before the status catches up', async () => {
    const { automation, calls, gsx } = setup();
    automation.setSettings(ALL_ON);
    automation.setFlight({ id: FLIGHT_ID, status: 'checked_in' });
    gsx.running = [service('boarding', 'requested')];

    await automation.evaluate();
    gsx.running = [service('boarding', 'performing')];
    await automation.evaluate();

    expect(calls).toHaveLength(1);
  });

  it('does not send a second request while the first is on its way', async () => {
    const { automation, calls, gsx } = setup();
    automation.setSettings(ALL_ON);
    automation.setFlight({ id: FLIGHT_ID, status: 'checked_in' });
    gsx.running = [service('boarding', 'requested')];

    await Promise.all([automation.evaluate(), automation.evaluate()]);

    expect(calls).toHaveLength(1);
  });

  it('starts deboarding once the pilot reports on block, if GSX is still at it', async () => {
    const { automation, calls, gsx } = setup();
    automation.setSettings(ALL_ON);
    automation.setFlight({ id: FLIGHT_ID, status: 'taxiing_in' });
    gsx.running = [service('deboarding', 'requested')];

    await automation.evaluate();
    expect(calls).toEqual([]);

    automation.setFlight({ id: FLIGHT_ID, status: 'on_block' });
    await automation.evaluate();

    expect(calls).toEqual([`offboarding ${FLIGHT_ID}`]);
  });

  it('starts nothing until it has read the settings', async () => {
    const { automation, calls, gsx } = setup();
    automation.setFlight({ id: FLIGHT_ID, status: 'checked_in' });
    gsx.running = [service('boarding', 'requested')];

    await automation.evaluate();

    expect(calls).toEqual([]);
  });

  it('starts nothing without a current flight', async () => {
    const { automation, calls, gsx } = setup();
    automation.setSettings(ALL_ON);
    gsx.running = [service('boarding', 'requested')];

    await automation.evaluate();

    expect(calls).toEqual([]);
  });

  it('waits before trying again when the API refuses, and never throws', async () => {
    const { automation, calls, warnings, gsx, clock, lifecycle } = setup();
    automation.setSettings(ALL_ON);
    automation.setFlight({ id: FLIGHT_ID, status: 'checked_in' });
    gsx.running = [service('boarding', 'requested')];
    lifecycle.fail = new Error('start-boarding failed with 503');

    await automation.evaluate();
    await automation.evaluate();

    expect(calls).toHaveLength(1);
    expect(warnings).toEqual([
      'could not start boarding from GSX: start-boarding failed with 503',
    ]);

    lifecycle.fail = null;
    clock.now += RETRY_AFTER_MS;
    await automation.evaluate();

    expect(calls).toHaveLength(2);
  });

  it('treats the next flight as a new one', async () => {
    const { automation, calls, gsx } = setup();
    automation.setSettings(ALL_ON);
    automation.setFlight({ id: FLIGHT_ID, status: 'checked_in' });
    gsx.running = [service('boarding', 'requested')];
    await automation.evaluate();

    automation.setFlight({ id: 'another-flight', status: 'checked_in' });
    await automation.evaluate();

    expect(calls).toEqual([`boarding ${FLIGHT_ID}`, 'boarding another-flight']);
  });
});
