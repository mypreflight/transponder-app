import type { GroundService } from '../domain/ground-services';
import type { SignInCode } from './ports/device-sign-in';
import type { GroundHandlingStatus, Stand } from './ports/ground-services';

export type ConnectionName = 'simulator' | 'discord' | 'adsb' | 'api';

export type ConnectionState =
  | 'connected'
  | 'disconnected'
  | 'unauthorised'
  | 'waiting-for-flight'
  | 'standby';

export type ServiceName = 'api' | 'adsb';

export type Crew = {
  name: string;
  email: string;
};

export type ServiceAirport = {
  iata: string | null;
  icao: string | null;
  name: string | null;
};

export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'downloading'; receivedBytes: number; totalBytes: number | null }
  | { phase: 'saved'; path: string }
  | { phase: 'failed'; reason: string };

export type CurrentService = {
  callsign: string;
  departure: ServiceAirport | null;
  arrival: ServiceAirport | null;
  airframe: string | null;
  registration: string | null;
};

export type StatusSnapshot = {
  connections: Record<ConnectionName, ConnectionState>;
  faults: Record<ConnectionName, string | null>;
  serviceVersions: Record<ServiceName, string | null>;
  latestRelease: string | null;
  update: UpdateStatus;
  storageFault: string | null;
  crew: Crew | null;
  signIn: SignInCode | null;
  service: CurrentService | null;
  callsign: string | null;
  aircraftIdentifier: string | null;
  squawk: string | null;
  groundSpeedKt: number | null;
  transmitting: boolean;
  lastAcceptedReportAt: Date | null;
  publishedCount: number;
  droppedCount: number;
  presenceState: string | null;
  presenceDetails: string | null;
  groundHandling: GroundHandlingStatus;
  groundServices: GroundService[];
  stand: Stand;
};

const CONNECTIONS: ConnectionName[] = ['simulator', 'discord', 'adsb', 'api'];

const SERVICES: ServiceName[] = ['api', 'adsb'];

export const CONNECTION_STATES: ConnectionState[] = [
  'connected',
  'disconnected',
  'unauthorised',
  'waiting-for-flight',
  'standby',
];

export class StatusRegistry {
  private readonly connections = new Map<ConnectionName, ConnectionState>(
    CONNECTIONS.map((name) => [name, 'disconnected' as ConnectionState]),
  );

  private readonly serviceVersions = new Map<ServiceName, string | null>(
    SERVICES.map((name) => [name, null]),
  );

  private readonly faults = new Map<ConnectionName, string>();

  private latestRelease: string | null = null;
  private update: UpdateStatus = { phase: 'idle' };
  private storageFault: string | null = null;
  private crew: Crew | null = null;
  private signIn: SignInCode | null = null;
  private service: CurrentService | null = null;
  private callsign: string | null = null;
  private aircraftIdentifier: string | null = null;
  private squawk: string | null = null;
  private groundSpeedKt: number | null = null;
  private transmitting = false;
  private lastAcceptedReportAt: Date | null = null;
  private publishedCount = 0;
  private droppedCount = 0;
  private presenceState: string | null = null;
  private presenceDetails: string | null = null;
  private groundHandling: GroundHandlingStatus = 'searching';
  private groundServices: GroundService[] = [];
  private stand: Stand = { airport: null, parking: null };

  set(name: ConnectionName, state: ConnectionState): void {
    this.connections.set(name, state);
  }

  setFault(name: ConnectionName, message: string | null): void {
    if (message === null) {
      this.faults.delete(name);

      return;
    }

    this.faults.set(name, message);
  }

  setServiceVersion(name: ServiceName, version: string | null): void {
    this.serviceVersions.set(name, version);
  }

  setLatestRelease(version: string | null): void {
    this.latestRelease = version;
  }

  setUpdate(update: UpdateStatus): void {
    this.update = update;
  }

  setStorageFault(message: string | null): void {
    this.storageFault = message;
  }

  setCrew(crew: Crew | null): void {
    this.crew = crew;
  }

  setSignIn(code: SignInCode | null): void {
    this.signIn = code;
  }

  setService(service: CurrentService | null): void {
    this.service = service;
  }

  setCallsign(callsign: string | null): void {
    this.callsign = callsign;
  }

  setAircraftIdentifier(identifier: string | null): void {
    this.aircraftIdentifier = identifier;
  }

  setTransponder(squawk: string | null, groundSpeedKt: number | null): void {
    this.squawk = squawk;
    this.groundSpeedKt = groundSpeedKt;
  }

  setTransmitting(transmitting: boolean): void {
    this.transmitting = transmitting;
  }

  recordAcceptedReport(at: Date): void {
    this.lastAcceptedReportAt = at;
    this.publishedCount += 1;
  }

  setDroppedCount(count: number): void {
    this.droppedCount = count;
  }

  setGroundHandling(
    status: GroundHandlingStatus,
    services: GroundService[],
    stand: Stand,
  ): void {
    this.groundHandling = status;
    this.groundServices = services;
    this.stand = stand;
  }

  setPresence(state: string | null, details: string | null): void {
    this.presenceState = state;
    this.presenceDetails = details;
  }

  snapshot(): StatusSnapshot {
    return {
      connections: Object.fromEntries(this.connections) as Record<
        ConnectionName,
        ConnectionState
      >,
      faults: Object.fromEntries(
        CONNECTIONS.map((name) => [name, this.faults.get(name) ?? null]),
      ) as Record<ConnectionName, string | null>,
      serviceVersions: Object.fromEntries(this.serviceVersions) as Record<
        ServiceName,
        string | null
      >,
      latestRelease: this.latestRelease,
      update: this.update,
      storageFault: this.storageFault,
      crew: this.crew,
      signIn: this.signIn,
      service: this.service,
      callsign: this.callsign,
      aircraftIdentifier: this.aircraftIdentifier,
      squawk: this.squawk,
      groundSpeedKt: this.groundSpeedKt,
      transmitting: this.transmitting,
      lastAcceptedReportAt: this.lastAcceptedReportAt,
      publishedCount: this.publishedCount,
      droppedCount: this.droppedCount,
      presenceState: this.presenceState,
      presenceDetails: this.presenceDetails,
      groundHandling: this.groundHandling,
      groundServices: this.groundServices,
      stand: this.stand,
    };
  }

  describe(): string {
    const snapshot = this.snapshot();
    const connections = CONNECTIONS.map(
      (name) => `${name}=${snapshot.connections[name]}`,
    ).join(' ');

    return (
      `${connections} callsign=${snapshot.callsign ?? '-'} ` +
      `aircraft=${snapshot.aircraftIdentifier ?? '-'} ` +
      `published=${snapshot.publishedCount} dropped=${snapshot.droppedCount}`
    );
  }
}
