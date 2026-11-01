import type { FlightStatus } from '../domain/flight-status';
import type { GroundService } from '../domain/ground-services';
import {
  type AutomatedService,
  GSX_AUTOMATION_OFF,
  type GsxSettings,
  serviceToStart,
} from '../domain/gsx-automation';
import type { FlightLifecycle } from './ports/flight-lifecycle';
import type { Logger } from './ports/logger';
import { describeError } from './supervisor';

export const RETRY_AFTER_MS = 30_000;

export type AutomatedFlight = {
  id: string;
  status: FlightStatus | null;
};

export class GsxAutomation {
  private flight: AutomatedFlight | null = null;
  private settings: GsxSettings = GSX_AUTOMATION_OFF;
  private busy = false;
  private readonly started = new Set<string>();
  private readonly retryAt = new Map<string, number>();

  constructor(
    private readonly lifecycle: FlightLifecycle,
    private readonly runningServices: () => GroundService[],
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
    const service = serviceToStart(
      this.runningServices(),
      this.flight.status,
      this.settings,
    );

    if (service === null) {
      return;
    }

    const key = `${flightId}:${service}`;

    if (this.started.has(key) || this.now() < (this.retryAt.get(key) ?? 0)) {
      return;
    }

    this.busy = true;

    try {
      await this.start(service, flightId);
      this.started.add(key);
      this.logger.info(`${service} started, as requested through GSX`);
    } catch (error) {
      this.retryAt.set(key, this.now() + RETRY_AFTER_MS);
      this.logger.warn(
        `could not start ${service} from GSX: ${describeError(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  private start(service: AutomatedService, flightId: string): Promise<void> {
    return service === 'boarding'
      ? this.lifecycle.startBoarding(flightId)
      : this.lifecycle.startOffboarding(flightId);
  }
}
