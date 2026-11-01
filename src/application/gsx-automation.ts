import type { FlightStatus } from '../domain/flight-status';
import type { GroundService } from '../domain/ground-services';
import {
  GSX_AUTOMATION_OFF,
  type GsxSettings,
  type GsxStep,
  stepToTake,
} from '../domain/gsx-automation';
import type { FlightLifecycle } from './ports/flight-lifecycle';
import type { Logger } from './ports/logger';
import { describeError } from './supervisor';

export const RETRY_AFTER_MS = 30_000;

export type AutomatedFlight = {
  id: string;
  status: FlightStatus | null;
};

const TAKEN: Record<GsxStep, string> = {
  'start-boarding': 'boarding started, as requested through GSX',
  'start-offboarding': 'offboarding started, as requested through GSX',
  'finish-offboarding': 'offboarding finished, as GSX completed deboarding',
};

const FAILED: Record<GsxStep, string> = {
  'start-boarding': 'could not start boarding from GSX',
  'start-offboarding': 'could not start offboarding from GSX',
  'finish-offboarding': 'could not finish offboarding from GSX',
};

export class GsxAutomation {
  private flight: AutomatedFlight | null = null;
  private settings: GsxSettings = GSX_AUTOMATION_OFF;
  private busy = false;
  private readonly taken = new Set<string>();
  private readonly retryAt = new Map<string, number>();

  constructor(
    private readonly lifecycle: FlightLifecycle,
    private readonly readServices: () => GroundService[],
    private readonly logger: Logger,
    private readonly now: () => number = () => Date.now(),
  ) {}

  setFlight(flight: AutomatedFlight | null): void {
    this.flight = flight;
  }

  setSettings(settings: GsxSettings): void {
    this.settings = settings;
  }

  async evaluate(): Promise<void> {
    if (this.busy || this.flight === null) {
      return;
    }

    const flightId = this.flight.id;
    const step = stepToTake(
      this.readServices(),
      this.flight.status,
      this.settings,
    );

    if (step === null) {
      return;
    }

    const key = `${flightId}:${step}`;

    if (this.taken.has(key) || this.now() < (this.retryAt.get(key) ?? 0)) {
      return;
    }

    this.busy = true;

    try {
      await this.take(step, flightId);
      this.taken.add(key);
      this.logger.info(TAKEN[step]);
    } catch (error) {
      this.retryAt.set(key, this.now() + RETRY_AFTER_MS);
      this.logger.warn(`${FAILED[step]}: ${describeError(error)}`);
    } finally {
      this.busy = false;
    }
  }

  private take(step: GsxStep, flightId: string): Promise<void> {
    switch (step) {
      case 'start-boarding':
        return this.lifecycle.startBoarding(flightId);
      case 'start-offboarding':
        return this.lifecycle.startOffboarding(flightId);
      case 'finish-offboarding':
        return this.lifecycle.finishOffboarding(flightId);
    }
  }
}
