import type {
  DeviceApproval,
  DeviceCode,
  DeviceSignIn,
} from '../../application/ports/device-sign-in';
import type { FlightLifecycle } from '../../application/ports/flight-lifecycle';
import type {
  Presence,
  PresenceSource,
} from '../../application/ports/presence';
import {
  NotSignedInError,
  SessionExpiredError,
} from '../../application/ports/session';
import { type FlightStatus, toFlightStatus } from '../../domain/flight-status';
import type { GsxSettings } from '../../domain/gsx-automation';
import { isTransponderToken } from './session-token';
import type { StoredSession, TokenStore } from './token-store';

export type Airport = {
  iata: string | null;
  icao: string | null;
  name: string | null;
};

export type CurrentFlight = {
  id: string;
  callsign: string;
  status: FlightStatus | null;
  departure: Airport | null;
  arrival: Airport | null;
  airframe: string | null;
  registration: string | null;
};

export type CurrentUser = {
  name: string;
  email: string;
  currentFlightId: string | null;
};

export class SignInFailedError extends Error {
  constructor(status: number) {
    super(`The API answered ${status} to the sign-in.`);
  }
}

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

const RENEW_MARGIN_MS = 60_000;
const ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

const VERSION_TIMEOUT_MS = 20_000;

const STATUS_TIMEOUT_MS = 4_000;

const SIGN_IN_TIMEOUT_MS = 10_000;

const SIGN_OUT_TIMEOUT_MS = 5_000;

const MAX_DEVICE_NAME = 64;

const DEFAULT_POLL_INTERVAL_SECONDS = 5;

const DEPARTURE = 'departure';

const DESTINATION = 'destination';

export class FlightTrackerClient
  implements PresenceSource, FlightLifecycle, DeviceSignIn
{
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly tokenStore: TokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async startDeviceSignIn(
    deviceName: string,
    signal?: AbortSignal,
  ): Promise<DeviceCode> {
    const name = deviceName.trim().slice(0, MAX_DEVICE_NAME).trim();
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/auth/device`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name === '' ? {} : { deviceName: name }),
        signal: withTimeout(signal, SIGN_IN_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      await discard(response);
      throw new SignInFailedError(response.status);
    }

    return toDeviceCode(await response.json());
  }

  async pollDeviceSignIn(
    deviceCode: string,
    signal?: AbortSignal,
  ): Promise<DeviceApproval> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/auth/device/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode }),
        signal: withTimeout(signal, SIGN_IN_TIMEOUT_MS),
      },
    );

    if (response.status !== 200) {
      await discard(response);
    }

    if (response.status === 202) {
      return 'pending';
    }

    if (response.status === 403) {
      return 'declined';
    }

    if (response.status === 404) {
      return 'expired';
    }

    if (response.status !== 200) {
      throw new SignInFailedError(response.status);
    }

    await this.acceptTokens(toTokenPair(await response.json()));

    return 'approved';
  }

  async version(): Promise<string> {
    return (
      (await this.versionFromStatus()) ?? (await this.versionFromDocument())
    );
  }

  private async versionFromStatus(): Promise<string | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });

      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as { version?: unknown };

      return typeof body.version === 'string' && body.version !== ''
        ? body.version
        : null;
    } catch {
      return null;
    }
  }

  private async versionFromDocument(): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/api-json`, {
      signal: AbortSignal.timeout(VERSION_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `the API answered ${response.status} to its OpenAPI document`,
      );
    }

    const document = (await response.json()) as {
      info?: { version?: unknown };
    };
    const version = document.info?.version;

    if (typeof version !== 'string' || version === '') {
      throw new Error('the API document states no version');
    }

    return version;
  }

  async signOut(): Promise<boolean> {
    let revoked: boolean;

    try {
      revoked = await this.revokeSession();
    } catch (error) {
      revoked =
        error instanceof NotSignedInError ||
        error instanceof SessionExpiredError;
    }

    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    await this.tokenStore.clear();

    return revoked;
  }

  private async revokeSession(): Promise<boolean> {
    const response = await this.authorizedRequest('/api/v1/auth/sign-out', {
      method: 'POST',
      signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
    });

    await discard(response);

    return response.ok;
  }

  async storedSession(): Promise<StoredSession | null> {
    const session = await this.tokenStore.read();

    if (session === null || isTransponderToken(session.refreshToken)) {
      return session;
    }

    await this.tokenStore.clear();
    await this.endForeignSession(session.refreshToken).catch(() => undefined);

    return null;
  }

  private async endForeignSession(refreshToken: string): Promise<void> {
    const refreshed = await this.fetchImpl(
      `${this.baseUrl}/api/v1/auth/refresh`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${refreshToken}` },
        signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
      },
    );

    if (!refreshed.ok) {
      await discard(refreshed);

      return;
    }

    const { accessToken } = toTokenPair(await refreshed.json());
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/auth/sign-out`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
      },
    );

    await discard(response);
  }

  async getCurrentUser(): Promise<CurrentUser> {
    const me = (await this.get('/api/v1/user/me')) as {
      name?: unknown;
      email?: unknown;
      currentFlightId?: unknown;
    };

    return {
      name: typeof me.name === 'string' ? me.name : '',
      email: typeof me.email === 'string' ? me.email : '',
      currentFlightId:
        typeof me.currentFlightId === 'string' ? me.currentFlightId : null,
    };
  }

  async getCurrentFlight(): Promise<CurrentFlight | null> {
    const me = await this.getCurrentUser();

    if (me.currentFlightId === null) {
      return null;
    }

    return this.getFlight(me.currentFlightId);
  }

  async getFlight(id: string): Promise<CurrentFlight> {
    const flight = (await this.get(`/api/v1/flight/${id}`)) as {
      id: string;
      callsign: string;
      status?: unknown;
      airports?: unknown;
      aircraft?: {
        registration?: unknown;
        airframe?: { type?: unknown };
      };
    };

    const airports = Array.isArray(flight.airports) ? flight.airports : [];

    return {
      id: flight.id,
      callsign: flight.callsign,
      status: toFlightStatus(flight.status),
      departure: pickAirport(airports, DEPARTURE, 0),
      arrival: pickAirport(airports, DESTINATION, 1),
      airframe: text(flight.aircraft?.airframe?.type),
      registration: text(flight.aircraft?.registration),
    };
  }

  async getDiscordPresence(): Promise<Presence | null> {
    const response = await this.authorizedRequest(
      '/api/v1/user/me/discord-presence',
    );

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`presence request failed with ${response.status}`);
    }

    return (await response.json()) as Presence;
  }

  async getGsxSettings(): Promise<GsxSettings> {
    const settings = (await this.get('/api/v1/user/me/gsx-settings')) as {
      integrationEnabled?: unknown;
      autoBoardingEnabled?: unknown;
      autoDeboardingEnabled?: unknown;
    };

    return {
      integrationEnabled: settings.integrationEnabled === true,
      autoBoardingEnabled: settings.autoBoardingEnabled === true,
      autoDeboardingEnabled: settings.autoDeboardingEnabled === true,
    };
  }

  startBoarding(flightId: string): Promise<void> {
    return this.postFromGsx(`/api/v1/flight/${flightId}/start-boarding`);
  }

  startOffboarding(flightId: string): Promise<void> {
    return this.postFromGsx(`/api/v1/flight/${flightId}/start-offboarding`);
  }

  finishOffboarding(flightId: string): Promise<void> {
    return this.postFromGsx(`/api/v1/flight/${flightId}/finish-offboarding`);
  }

  private async postFromGsx(path: string): Promise<void> {
    const response = await this.authorizedRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'gsx' }),
    });

    if (!response.ok) {
      throw new Error(`request to ${path} failed with ${response.status}`);
    }
  }

  private async get(path: string): Promise<unknown> {
    const response = await this.authorizedRequest(path);

    if (!response.ok) {
      throw new Error(`request to ${path} failed with ${response.status}`);
    }

    return response.json();
  }

  private async authorizedRequest(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    await this.ensureAccessToken();

    const send = (): Promise<Response> =>
      this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

    const response = await send();

    if (response.status !== 401) {
      return response;
    }

    this.accessToken = null;
    await this.ensureAccessToken();

    return send();
  }

  private async ensureAccessToken(): Promise<void> {
    if (
      this.accessToken !== null &&
      this.now() < this.accessTokenExpiresAt - RENEW_MARGIN_MS
    ) {
      return;
    }

    const session = await this.storedSession();

    if (session === null) {
      throw new NotSignedInError();
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/auth/refresh`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.refreshToken}` },
      },
    );

    if (!response.ok) {
      await this.tokenStore.clear();
      this.accessToken = null;
      throw new SessionExpiredError();
    }

    await this.acceptTokens((await response.json()) as TokenPair);
  }

  private async acceptTokens(tokens: TokenPair): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.accessTokenExpiresAt = this.now() + ACCESS_TOKEN_LIFETIME_MS;
    await this.tokenStore.write({ refreshToken: tokens.refreshToken });
  }
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);

  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function discard(response: Response): Promise<void> {
  await response.text().catch(() => undefined);
}

function toDeviceCode(value: unknown): DeviceCode {
  const body = record(value);
  const deviceCode = text(body.deviceCode);
  const userCode = text(body.userCode);
  const verificationUri = text(body.verificationUri);
  const expiresInSeconds = positive(body.expiresIn);

  if (
    deviceCode === null ||
    userCode === null ||
    verificationUri === null ||
    expiresInSeconds === null
  ) {
    throw new Error('the API started a sign-in without a usable code');
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete:
      text(body.verificationUriComplete) ?? verificationUri,
    expiresInSeconds,
    intervalSeconds: positive(body.interval) ?? DEFAULT_POLL_INTERVAL_SECONDS,
  };
}

function toTokenPair(value: unknown): TokenPair {
  const body = record(value);
  const accessToken = text(body.accessToken);
  const refreshToken = text(body.refreshToken);

  if (accessToken === null || refreshToken === null) {
    throw new Error('the API approved the sign-in without tokens');
  }

  return { accessToken, refreshToken };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function pickAirport(
  airports: unknown[],
  type: string,
  position: number,
): Airport | null {
  const tagged = airports.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>).type === type,
  );

  return toAirport(tagged ?? airports[position]);
}

function toAirport(value: unknown): Airport | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const airport = value as Record<string, unknown>;

  return {
    iata: text(airport.iataCode) ?? text(airport.iata),
    icao: text(airport.icaoCode) ?? text(airport.icao),
    name: text(airport.name),
  };
}
