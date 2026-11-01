import {
  type GroundService,
  isWorthShowing,
  Turnaround,
} from '../domain/ground-services';
import type { GroundHandlingStatus, Stand } from './ports/ground-services';
import type { Logger } from './ports/logger';
import type { StatusRegistry } from './status';

export class GroundServicesFeed {
  private readonly turnaround = new Turnaround();

  private status: GroundHandlingStatus = 'searching';
  private stand: Stand = { airport: null, parking: null };
  private airborne = false;
  private flightId: string | null = null;
  private announced = new Map<string, string>();

  constructor(
    private readonly registry: StatusRegistry,
    private readonly logger: Logger,
  ) {}

  setStatus(status: GroundHandlingStatus): void {
    if (status === this.status) {
      return;
    }

    this.status = status;
    this.logger.info(describeStatus(status));
    this.report();
  }

  setStand(stand: Stand): void {
    this.stand = stand;
    this.report();
  }

  accept(services: GroundService[]): void {
    this.turnaround.accept(services);
    this.announce();
    this.report();
  }

  services(): GroundService[] {
    return this.status === 'connected' ? this.turnaround.snapshot() : [];
  }

  setOnGround(onGround: boolean): void {
    if (onGround) {
      this.airborne = false;

      return;
    }

    if (!this.airborne) {
      this.airborne = true;
      this.endTurnaround();
    }
  }

  setCurrentFlight(flightId: string | null): void {
    if (flightId === this.flightId) {
      return;
    }

    this.flightId = flightId;
    this.endTurnaround();
  }

  private endTurnaround(): void {
    this.turnaround.reset();
    this.announced = new Map();
    this.report();
  }

  private announce(): void {
    for (const service of this.turnaround.snapshot()) {
      if (service.state === null) {
        continue;
      }

      if (this.announced.get(service.id) === service.state) {
        continue;
      }

      this.announced.set(service.id, service.state);

      if (isWorthShowing(service)) {
        this.logger.info(`${service.id} ${service.state}`);
      }
    }
  }

  private report(): void {
    this.registry.setGroundHandling(
      this.status,
      this.status === 'connected'
        ? this.turnaround.snapshot().filter(isWorthShowing)
        : [],
      this.status === 'connected'
        ? this.stand
        : { airport: null, parking: null },
    );
  }
}

function describeStatus(status: GroundHandlingStatus): string {
  switch (status) {
    case 'connected':
      return 'GSX connected: ground services are being read';
    case 'unsupported':
      return 'GSX is running but does not offer the ground service feed';
    default:
      return 'GSX not found, retrying in the background';
  }
}
