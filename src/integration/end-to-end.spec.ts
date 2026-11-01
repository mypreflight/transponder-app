import { StubGsx, StubService } from './stub-services';
import { SessionExpiredError } from '../application/ports/session';
import { FlightTrackerClient } from '../infrastructure/mypreflight/client';
import type { DeviceApproval } from '../application/ports/device-sign-in';
import { signInThroughBrowser } from '../application/sign-in';
import { InMemoryTokenStore } from '../infrastructure/mypreflight/token-store';
import {
  PositionPublishFailedError,
  PositionRejectedError,
  PublisherUnauthorisedError,
} from '../application/ports/positions';
import { AdsbClient } from '../infrastructure/adsb/client';
import { PositionFeed } from '../application/position.feed';
import { PresenceFeed } from '../application/presence.feed';
import { PositionQueue } from '../domain/position-queue';
import { toPositionReport } from '../domain/position-report';
import { RatePolicy } from '../domain/rate-policy';
import type { SimSample } from '../domain/sim-sample';
import { StatusRegistry, type StatusSnapshot } from '../application/status';
import { Logger } from '../infrastructure/logger';
import type { Presence, PresenceWriter } from '../application/ports/presence';
import { GsxClient } from '../infrastructure/gsx/client';
import { GroundServicesFeed } from '../application/ground-services.feed';
import { GsxAutomation } from '../application/gsx-automation';
import type { FlightStatus } from '../domain/flight-status';
import boarding from '../infrastructure/gsx/fixtures/services-boarding.json';

const FLIGHT_ID = '0f0f6b04-9a5f-4e6c-9c4e-1d2f0f38a3b1';

const DEVICE_CODE = 'q0Hn8v1o3qGqWm7dJ9mP0xXcQe2yS5bWkT1uVfZrL4A';

const USER_CODE = 'BCDF-GHJK';

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`;
}

const REFRESH_CLAIMS = {
  sub: 'a3c1f2d4-6b7e-4f8a-9c0d-1e2f3a4b5c6d',
  session: 'f0e1d2c3-b4a5-4968-8776-655443322110',
  type: 'refresh',
};

const REFRESH_TOKEN = jwt({ ...REFRESH_CLAIMS, client: 'transponder' });

const PASSWORD_REFRESH_TOKEN = jwt(REFRESH_CLAIMS);

const WEB_REFRESH_TOKEN = jwt({ ...REFRESH_CLAIMS, client: 'web' });

function deviceAuthorization(baseUrl: string): Record<string, unknown> {
  return {
    deviceCode: DEVICE_CODE,
    userCode: USER_CODE,
    verificationUri: `${baseUrl}/activate`,
    verificationUriComplete: `${baseUrl}/activate?code=${USER_CODE}`,
    expiresIn: 600,
    interval: 5,
  };
}

async function signIn(flightTracker: FlightTrackerClient): Promise<void> {
  const code = await flightTracker.startDeviceSignIn('SIM-PC');

  await expect(flightTracker.pollDeviceSignIn(code.deviceCode)).resolves.toBe(
    'approved',
  );
}

const presencePayload = {
  state: 'Cruise, landing at 15:50 UTC',
  details: 'Boston (BOS) -> Philadelphia (PHL)',
  startTimestamp: '2025-01-01T13:00:00.000Z',
  endTimestamp: '2025-01-01T15:50:00.000Z',
  smallImageKey: 'flight-tracker',
  largeImageKey: 'msfs2024',
};

class RecordingWriter implements PresenceWriter {
  activities: Presence[] = [];
  clears = 0;

  connect(): Promise<void> {
    return Promise.resolve();
  }

  setActivity(activity: Presence): Promise<void> {
    this.activities.push(activity);
    return Promise.resolve();
  }

  clearActivity(): Promise<void> {
    this.clears += 1;
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

function sample(overrides: Partial<SimSample> = {}): SimSample {
  return {
    sampledAt: new Date('2026-08-13T12:00:00.000Z'),
    latitude: 42.36454,
    longitude: -71.01663,
    altitude: 35000,
    groundSpeed: 456,
    track: 271.5,
    verticalRate: -12,
    isOnGround: false,
    transponderCodeBcd: 0x1200,
    aircraftIdentifier: 'N720AN',
    ...overrides,
  };
}

function silentLogger(): Logger {
  return new Logger('error', '/dev/null');
}

describe('flight-tracker API integration', () => {
  let api: StubService;
  let presenceStatus = 200;
  let deviceStatus = 201;
  let approval: DeviceApproval | 503 = 'approved';
  let flightBody: unknown;
  let statusBody: unknown;
  let refreshes = 0;
  let accessTokensIssued = 0;

  beforeEach(async () => {
    presenceStatus = 200;
    deviceStatus = 201;
    approval = 'approved';
    statusBody = undefined;
    flightBody = {
      id: FLIGHT_ID,
      callsign: 'AAL 4908',
      status: 'boarding_started',
      airports: [
        {
          type: 'departure',
          iataCode: 'BOS',
          icaoCode: 'KBOS',
          name: 'Boston Logan',
        },
        {
          type: 'destination',
          iataCode: 'PHL',
          icaoCode: 'KPHL',
          name: 'Philadelphia',
        },
      ],
      aircraft: {
        registration: 'N720AN',
        airframe: { type: 'B77W', name: 'B777-300ER' },
      },
    };
    refreshes = 0;
    accessTokensIssued = 0;

    api = new StubService({
      'POST /api/v1/auth/device': () =>
        deviceStatus === 201
          ? { status: 201, body: deviceAuthorization(api.baseUrl) }
          : {
              status: deviceStatus,
              body: { statusCode: deviceStatus, error: 'Service Unavailable' },
            },
      [`POST /api/v1/auth/device/${USER_CODE}/approve`]: (request) => {
        if (request.authorization !== 'Bearer web-access') {
          return { status: 401 };
        }

        approval = 'approved';

        return { status: 204 };
      },
      'POST /api/v1/auth/device/token': (request) => {
        if (JSON.parse(request.body).deviceCode !== DEVICE_CODE) {
          return { status: 404 };
        }

        if (approval === 'pending') {
          return { status: 202, body: { status: 'pending' } };
        }

        if (approval === 'declined') {
          return {
            status: 403,
            body: {
              statusCode: 403,
              error: 'Forbidden',
              message: 'Device sign-in was declined.',
            },
          };
        }

        if (approval === 'expired') {
          return {
            status: 404,
            body: {
              statusCode: 404,
              error: 'Not Found',
              message: 'Device sign-in does not exist or has expired.',
            },
          };
        }

        if (approval === 503) {
          return { status: 503 };
        }

        accessTokensIssued += 1;
        approval = 'expired';

        return {
          status: 200,
          body: {
            accessToken: `access-${accessTokensIssued}`,
            refreshToken: REFRESH_TOKEN,
          },
        };
      },
      'POST /api/v1/auth/sign-out': (request) =>
        request.authorization?.startsWith('Bearer access-') === true
          ? { status: 204 }
          : { status: 401 },
      'POST /api/v1/auth/refresh': (request) => {
        refreshes += 1;

        const presented = request.authorization?.replace('Bearer ', '') ?? '';

        if (
          ![REFRESH_TOKEN, PASSWORD_REFRESH_TOKEN, WEB_REFRESH_TOKEN].includes(
            presented,
          )
        ) {
          return { status: 401 };
        }

        accessTokensIssued += 1;

        return {
          status: 200,
          body: {
            accessToken: `access-${accessTokensIssued}`,
            refreshToken: presented,
          },
        };
      },
      'GET /api/v1/user/me': () => ({
        status: 200,
        body: {
          name: 'Oskar Barcz',
          email: 'pilot@example.com',
          currentFlightId: FLIGHT_ID,
        },
      }),
      [`GET /api/v1/flight/${FLIGHT_ID}`]: () => ({
        status: 200,
        body: flightBody,
      }),
      'GET /api/v1/user/me/discord-presence': () =>
        presenceStatus === 204
          ? { status: 204 }
          : { status: 200, body: presencePayload },
      'GET /': () =>
        statusBody === undefined
          ? { status: 404, body: { message: 'Cannot GET /', statusCode: 404 } }
          : { status: 200, body: statusBody },
      'GET /api-json': () => ({
        status: 200,
        body: { openapi: '3.0.0', info: { title: 'x', version: '3.24.0' } },
      }),
    });

    await api.start();
  });

  afterEach(async () => {
    await api.stop();
  });

  function client(now: () => number = () => Date.now()): FlightTrackerClient {
    return new FlightTrackerClient(
      api.baseUrl,
      new InMemoryTokenStore(),
      fetch,
      now,
    );
  }

  it('signs in through the browser and resolves the current flight callsign', async () => {
    const flightTracker = client();
    const opened: string[] = [];
    approval = 'pending';

    const outcome = await signInThroughBrowser(
      {
        api: flightTracker,
        browser: {
          open: async (url) => {
            opened.push(url);
            const code = new URL(url).searchParams.get('code') ?? '';
            const approved = await fetch(
              `${api.baseUrl}/api/v1/auth/device/${code}/approve`,
              {
                method: 'POST',
                headers: { Authorization: 'Bearer web-access' },
              },
            );

            return approved.ok;
          },
        },
        logger: silentLogger(),
        deviceName: 'SIM-PC',
        sleep: () => new Promise((resolve) => setTimeout(resolve, 5)),
      },
      () => undefined,
      new AbortController().signal,
    );

    expect(outcome).toBe('signed-in');
    expect(opened).toEqual([`${api.baseUrl}/activate?code=${USER_CODE}`]);

    const flight = await flightTracker.getCurrentFlight();

    expect(flight).toEqual({
      id: FLIGHT_ID,
      callsign: 'AAL 4908',
      status: 'boarding_started',
      departure: { iata: 'BOS', icao: 'KBOS', name: 'Boston Logan' },
      arrival: { iata: 'PHL', icao: 'KPHL', name: 'Philadelphia' },
      airframe: 'B77W',
      registration: 'N720AN',
    });
    expect(api.requestsTo('/api/v1/user/me')[0]?.authorization).toBe(
      'Bearer access-1',
    );
  });

  it('asks for a code with no session, under the name of this machine', async () => {
    await client().startDeviceSignIn('SIM-PC');

    const request = api.requestsTo('/api/v1/auth/device')[0];

    expect(request?.authorization).toBeUndefined();
    expect(JSON.parse(request?.body ?? '')).toEqual({ deviceName: 'SIM-PC' });
  });

  it('cuts a long machine name down to what the API accepts', async () => {
    await client().startDeviceSignIn(`  ${'X'.repeat(80)}  `);

    expect(
      JSON.parse(api.requestsTo('/api/v1/auth/device')[0]?.body ?? ''),
    ).toEqual({ deviceName: 'X'.repeat(64) });
  });

  it('leaves out a machine name that is blank', async () => {
    await client().startDeviceSignIn('   ');

    expect(
      JSON.parse(api.requestsTo('/api/v1/auth/device')[0]?.body ?? ''),
    ).toEqual({});
  });

  it('reads the code, the addresses and the timing the API issued', async () => {
    await expect(client().startDeviceSignIn('SIM-PC')).resolves.toEqual({
      deviceCode: DEVICE_CODE,
      userCode: USER_CODE,
      verificationUri: `${api.baseUrl}/activate`,
      verificationUriComplete: `${api.baseUrl}/activate?code=${USER_CODE}`,
      expiresInSeconds: 600,
      intervalSeconds: 5,
    });
  });

  it('names the status when the API will not start a sign-in', async () => {
    deviceStatus = 503;

    await expect(client().startDeviceSignIn('SIM-PC')).rejects.toThrow(
      'The API answered 503 to the sign-in.',
    );
  });

  it('polls with the device code and no session', async () => {
    approval = 'pending';

    await client().pollDeviceSignIn(DEVICE_CODE);

    const request = api.requestsTo('/api/v1/auth/device/token')[0];

    expect(request?.authorization).toBeUndefined();
    expect(JSON.parse(request?.body ?? '')).toEqual({
      deviceCode: DEVICE_CODE,
    });
  });

  it.each([
    ['pending', 'pending'],
    ['declined', 'declined'],
    ['expired', 'expired'],
  ] as const)('reads a %s sign-in as %s', async (state, answer) => {
    approval = state;

    await expect(client().pollDeviceSignIn(DEVICE_CODE)).resolves.toBe(answer);
  });

  it('throws on a server fault while polling, for the caller to retry', async () => {
    approval = 503;

    await expect(client().pollDeviceSignIn(DEVICE_CODE)).rejects.toThrow(
      'The API answered 503 to the sign-in.',
    );
  });

  it('keeps the refresh token only once the sign-in is approved', async () => {
    const store = new InMemoryTokenStore();
    const flightTracker = new FlightTrackerClient(api.baseUrl, store, fetch);
    approval = 'pending';

    await flightTracker.pollDeviceSignIn(DEVICE_CODE);
    expect(await store.read()).toBeNull();

    approval = 'approved';
    await flightTracker.pollDeviceSignIn(DEVICE_CODE);

    expect(await store.read()).toEqual({ refreshToken: REFRESH_TOKEN });
  });

  it('ends the session at the API when the pilot signs out', async () => {
    const store = new InMemoryTokenStore();
    const flightTracker = new FlightTrackerClient(api.baseUrl, store, fetch);
    await signIn(flightTracker);

    await expect(flightTracker.signOut()).resolves.toBe(true);

    const request = api.requestsTo('/api/v1/auth/sign-out')[0];

    expect(request?.method).toBe('POST');
    expect(request?.authorization).toBe('Bearer access-1');
    expect(await store.read()).toBeNull();
  });

  it('signs out on this PC even when the API cannot be reached', async () => {
    const store = new InMemoryTokenStore();
    const flightTracker = new FlightTrackerClient(
      api.baseUrl,
      store,
      (input, init) =>
        String(input).endsWith('/api/v1/auth/sign-out')
          ? Promise.reject(new TypeError('fetch failed'))
          : fetch(input, init),
    );
    await signIn(flightTracker);

    await expect(flightTracker.signOut()).resolves.toBe(false);
    expect(await store.read()).toBeNull();
    await expect(flightTracker.getCurrentUser()).rejects.toThrow(
      'No session is available',
    );
  });

  it('reads the route by airport type, not by position', async () => {
    flightBody = {
      id: FLIGHT_ID,
      callsign: 'AAL 4908',
      status: 'boarding_started',
      airports: [
        {
          type: 'destination_alternate',
          iataCode: 'IAD',
          icaoCode: 'KIAD',
          name: 'Washington Dulles',
        },
        {
          type: 'destination',
          iataCode: 'PHL',
          icaoCode: 'KPHL',
          name: 'Philadelphia',
        },
        {
          type: 'departure',
          iataCode: 'BOS',
          icaoCode: 'KBOS',
          name: 'Boston Logan',
        },
      ],
      aircraft: {},
    };

    const flightTracker = client();
    await signIn(flightTracker);

    const flight = await flightTracker.getFlight(FLIGHT_ID);

    expect(flight.departure).toEqual({
      iata: 'BOS',
      icao: 'KBOS',
      name: 'Boston Logan',
    });
    expect(flight.arrival).toEqual({
      iata: 'PHL',
      icao: 'KPHL',
      name: 'Philadelphia',
    });
  });

  it('renews with the refresh token as the bearer and no body', async () => {
    let clock = Date.UTC(2026, 7, 13, 12, 0, 0);
    const flightTracker = client(() => clock);
    await signIn(flightTracker);

    clock += 15 * 60 * 1000;
    await flightTracker.getCurrentFlight();

    const refresh = api.requestsTo('/api/v1/auth/refresh')[0];

    expect(refreshes).toBe(1);
    expect(refresh?.authorization).toBe(`Bearer ${REFRESH_TOKEN}`);
    expect(refresh?.body).toBe('');
    expect(api.requestsTo('/api/v1/user/me')[0]?.authorization).toBe(
      'Bearer access-2',
    );
  });

  it('reads the crew off the same request the flight id came from', async () => {
    const flightTracker = client();
    await signIn(flightTracker);

    await expect(flightTracker.getCurrentUser()).resolves.toEqual({
      name: 'Oskar Barcz',
      email: 'pilot@example.com',
      currentFlightId: FLIGHT_ID,
    });
  });

  it('settles for no route rather than throwing on an unexpected shape', async () => {
    flightBody = {
      id: FLIGHT_ID,
      callsign: 'AAL 4908',
      airports: ['ba9ac708-0cef-4d92-a824-4e95f60bd752'],
      aircraft: {},
    };

    const flightTracker = client();
    await signIn(flightTracker);

    await expect(flightTracker.getFlight(FLIGHT_ID)).resolves.toEqual({
      id: FLIGHT_ID,
      callsign: 'AAL 4908',
      status: null,
      departure: null,
      arrival: null,
      airframe: null,
      registration: null,
    });
  });

  it('prefers a status endpoint over the OpenAPI document when one answers', async () => {
    statusBody = { status: 'OK', version: '4.0.0' };

    const flightTracker = client();

    await expect(flightTracker.version()).resolves.toBe('4.0.0');
    expect(api.requestsTo('/api-json')).toHaveLength(0);
  });

  it('falls back to the document while the API has no status route', async () => {
    const flightTracker = client();

    await expect(flightTracker.version()).resolves.toBe('3.24.0');
    expect(api.requestsTo('/api-json')).toHaveLength(1);
  });

  it('reads its version out of the OpenAPI document, with no session', async () => {
    const flightTracker = new FlightTrackerClient(
      api.baseUrl,
      new InMemoryTokenStore(),
      fetch,
    );

    await expect(flightTracker.version()).resolves.toBe('3.24.0');
    expect(api.requestsTo('/api/v1/auth/refresh')).toHaveLength(0);
    expect(api.requestsTo('/api-json')[0]?.authorization).toBeUndefined();
  });

  it('gives up on a session the API no longer accepts', async () => {
    const store = new InMemoryTokenStore();
    await store.write({
      refreshToken: jwt({
        ...REFRESH_CLAIMS,
        session: 'b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        client: 'transponder',
      }),
    });
    const flightTracker = new FlightTrackerClient(api.baseUrl, store, fetch);

    await expect(flightTracker.getCurrentFlight()).rejects.toThrow(
      SessionExpiredError,
    );
    expect(await store.read()).toBeNull();
  });

  it('keeps a session the Transponder was issued, without asking the API', async () => {
    const store = new InMemoryTokenStore();
    await store.write({ refreshToken: REFRESH_TOKEN });
    const flightTracker = new FlightTrackerClient(api.baseUrl, store, fetch);

    await expect(flightTracker.storedSession()).resolves.toEqual({
      refreshToken: REFRESH_TOKEN,
    });
    expect(await store.read()).toEqual({ refreshToken: REFRESH_TOKEN });
    expect(api.requests).toEqual([]);
  });

  it.each([
    ['the password sign-in, which names no client', PASSWORD_REFRESH_TOKEN],
    ['the browser', WEB_REFRESH_TOKEN],
  ])(
    'drops a session issued to %s, and ends it at the API',
    async (_issuer, refreshToken) => {
      const store = new InMemoryTokenStore();
      await store.write({ refreshToken });
      const flightTracker = new FlightTrackerClient(api.baseUrl, store, fetch);

      await expect(flightTracker.storedSession()).resolves.toBeNull();

      expect(await store.read()).toBeNull();
      expect(
        api.requests.map((request) => [request.path, request.authorization]),
      ).toEqual([
        ['/api/v1/auth/refresh', `Bearer ${refreshToken}`],
        ['/api/v1/auth/sign-out', 'Bearer access-1'],
      ]);
    },
  );

  it('drops a session it cannot read, even with the API unreachable', async () => {
    const store = new InMemoryTokenStore();
    await store.write({ refreshToken: 'not-a-token' });
    const flightTracker = new FlightTrackerClient(api.baseUrl, store, () =>
      Promise.reject(new TypeError('fetch failed')),
    );

    await expect(flightTracker.storedSession()).resolves.toBeNull();
    expect(await store.read()).toBeNull();
  });

  it('never renews with a session the Transponder was not issued', async () => {
    const store = new InMemoryTokenStore();
    await store.write({ refreshToken: PASSWORD_REFRESH_TOKEN });
    const flightTracker = new FlightTrackerClient(api.baseUrl, store, fetch);

    await expect(flightTracker.getCurrentUser()).rejects.toThrow(
      'No session is available',
    );
    expect(api.requestsTo('/api/v1/user/me')).toEqual([]);
    expect(await store.read()).toBeNull();
  });

  it('publishes the activity on a payload and clears it on no content', async () => {
    const flightTracker = client();
    await signIn(flightTracker);

    const writer = new RecordingWriter();
    const feed = new PresenceFeed(
      flightTracker,
      writer,
      new StatusRegistry(),
      silentLogger(),
    );

    await feed.tick();
    presenceStatus = 204;
    await feed.tick();

    expect(writer.activities).toHaveLength(1);
    expect(writer.activities[0]).toEqual(presencePayload);
    expect(writer.clears).toBe(1);
  });
});

describe('ADS-B service integration', () => {
  let adsbService: StubService;
  let publishStatus = 200;
  let publishBody: unknown;

  const VALIDATION_ERROR = {
    message: ['squawk must be a string'],
    error: 'Bad Request',
    statusCode: 400,
  };

  beforeEach(async () => {
    publishStatus = 200;
    publishBody = undefined;

    adsbService = new StubService({
      'POST /api/v1/auth-check/client': (request) =>
        request.authorization === 'Bearer client-token'
          ? { status: 200, body: { ok: true } }
          : { status: 401 },
      'POST /api/v1/position': () => ({
        status: publishStatus,
        body: publishBody,
      }),
      'GET /': () => ({
        status: 200,
        body: { status: 'OK', version: '0.5.0' },
      }),
    });

    await adsbService.start();
  });

  afterEach(async () => {
    await adsbService.stop();
  });

  function feedFor(token = 'client-token'): {
    feed: PositionFeed;
    status: StatusRegistry;
    advance: (ms: number) => void;
  } {
    const status = new StatusRegistry();
    let clock = Date.UTC(2026, 7, 13, 12, 0, 0);
    const feed = new PositionFeed(
      new AdsbClient(adsbService.baseUrl, token),
      new PositionQueue(10),
      new RatePolicy(1, 1),
      status,
      silentLogger(),
      () => clock,
    );

    feed.setTransmitting(true);
    feed.setCurrentFlightCallsign('AAL 4908');

    return {
      feed,
      status,
      advance: (ms) => {
        clock += ms;
      },
    };
  }

  it('accepts a valid client token and rejects a wrong one', async () => {
    await expect(
      new AdsbClient(adsbService.baseUrl, 'client-token').verifyToken(),
    ).resolves.toBeUndefined();

    await expect(
      new AdsbClient(adsbService.baseUrl, 'wrong').verifyToken(),
    ).rejects.toThrow(PublisherUnauthorisedError);
  });

  it('publishes a report the ADS-B contract accepts', async () => {
    const { feed } = feedFor();

    feed.accept(sample());
    await feed.drain();

    const published = adsbService.requestsTo('/api/v1/position');

    expect(published).toHaveLength(1);
    expect(published[0]?.authorization).toBe('Bearer client-token');
    expect(JSON.parse(published[0]?.body ?? '{}')).toEqual({
      callsign: 'AAL4908',
      date: '2026-08-13T12:00:00.000Z',
      latitude: 42.36454,
      longitude: -71.01663,
      altitude: 35000,
      groundSpeed: 456,
      track: 271.5,
      verticalRate: -12,
      squawk: '1200',
      isOnGround: false,
      alert: false,
      emergency: false,
      spi: false,
    });
  });

  it('recovers from an outage without losing or reordering reports', async () => {
    const { feed, advance } = feedFor();

    publishStatus = 503;

    for (let second = 0; second < 3; second += 1) {
      feed.accept(
        sample({ sampledAt: new Date(Date.UTC(2026, 7, 13, 12, 0, second)) }),
      );
      advance(1_000);
      await feed.drain();
    }

    publishStatus = 200;
    feed.accept(
      sample({ sampledAt: new Date(Date.UTC(2026, 7, 13, 12, 0, 3)) }),
    );
    advance(60_000);
    await feed.drain();

    const accepted = adsbService
      .requestsTo('/api/v1/position')
      .map((request) => JSON.parse(request.body).date as string)
      .filter((date, index, dates) => dates.indexOf(date) === index);

    expect(accepted).toEqual([
      '2026-08-13T12:00:00.000Z',
      '2026-08-13T12:00:01.000Z',
      '2026-08-13T12:00:02.000Z',
      '2026-08-13T12:00:03.000Z',
    ]);
  });

  it('stops publishing and reports the state when the token is revoked', async () => {
    const { feed, status } = feedFor();

    publishStatus = 401;
    feed.accept(sample());
    await feed.drain();

    expect(status.snapshot().connections.adsb).toBe('unauthorised');
  });

  it('reads its version off the status endpoint, with no token', async () => {
    await expect(
      new AdsbClient(adsbService.baseUrl, 'wrong-token').version(),
    ).resolves.toBe('0.5.0');
    expect(adsbService.requestsTo('/')[0]?.authorization).toBeUndefined();
  });

  it('sends every field the contract marks required, even from a bare sample', async () => {
    const { feed } = feedFor();

    feed.accept(
      sample({
        groundSpeed: Number.NaN,
        verticalRate: Number.NaN,
        transponderCodeBcd: 0x9999,
      }),
    );
    await feed.drain();

    const body = JSON.parse(
      adsbService.requestsTo('/api/v1/position')[0]?.body ?? '{}',
    ) as Record<string, unknown>;

    for (const field of [
      'date',
      'longitude',
      'latitude',
      'callsign',
      'verticalRate',
      'squawk',
      'groundSpeed',
      'track',
      'alert',
      'emergency',
      'spi',
      'isOnGround',
      'altitude',
    ]) {
      expect(body[field]).toBeDefined();
    }
  });

  it('reads the reason out of a 400 instead of reporting the bare status', async () => {
    const { feed } = feedFor();

    publishStatus = 400;
    publishBody = VALIDATION_ERROR;

    await expect(
      new AdsbClient(adsbService.baseUrl, 'client-token').publish(
        toPositionReport(sample(), 'LH455'),
      ),
    ).rejects.toThrow('squawk must be a string');

    feed.accept(sample());
    await feed.drain();

    expect(adsbService.requestsTo('/api/v1/position')).toHaveLength(2);
  });

  it.each([
    [400, 'rejected'],
    [404, 'rejected'],
    [408, 'retried'],
    [429, 'retried'],
    [503, 'retried'],
  ])('treats %s as %s', async (status, verdict) => {
    publishStatus = status;

    const publishing = new AdsbClient(
      adsbService.baseUrl,
      'client-token',
    ).publish(toPositionReport(sample(), 'LH455'));

    await expect(publishing).rejects.toBeInstanceOf(
      verdict === 'rejected'
        ? PositionRejectedError
        : PositionPublishFailedError,
    );
  });

  it('keeps draining after a report the service will never accept', async () => {
    const { feed, status } = feedFor();

    publishStatus = 400;
    publishBody = VALIDATION_ERROR;
    feed.accept(
      sample({ sampledAt: new Date(Date.UTC(2026, 7, 13, 12, 0, 0)) }),
    );
    await feed.drain();

    publishStatus = 200;
    publishBody = undefined;
    feed.accept(
      sample({ sampledAt: new Date(Date.UTC(2026, 7, 13, 12, 0, 1)) }),
    );
    await feed.drain();

    expect(status.snapshot().publishedCount).toBe(1);
    expect(status.snapshot().droppedCount).toBe(1);
  });
});

describe('acting on the flight when GSX reports a step', () => {
  const START_BOARDING = `/api/v1/flight/${FLIGHT_ID}/start-boarding`;
  const FINISH_OFFBOARDING = `/api/v1/flight/${FLIGHT_ID}/finish-offboarding`;

  const withDeboarding = (state: string): unknown[] =>
    boarding.value.map((service) => {
      if (service.id === 'Deboarding') {
        return { ...service, state };
      }

      return service.id === 'Boarding'
        ? { ...service, state: 'completed' }
        : service;
    });

  let api: StubService;
  let settingsAnswer: { status: number; body?: unknown };

  beforeEach(async () => {
    settingsAnswer = {
      status: 200,
      body: {
        integrationEnabled: true,
        autoBoardingEnabled: true,
        autoDeboardingEnabled: true,
      },
    };
    api = new StubService({
      'POST /api/v1/auth/device': () => ({
        status: 201,
        body: deviceAuthorization(api.baseUrl),
      }),
      'POST /api/v1/auth/device/token': () => ({
        status: 200,
        body: { accessToken: 'access-1', refreshToken: 'refresh-1' },
      }),
      'GET /api/v1/user/me/gsx-settings': () => settingsAnswer,
      [`POST ${START_BOARDING}`]: () => ({ status: 204 }),
      [`POST ${FINISH_OFFBOARDING}`]: () => ({ status: 204 }),
    });

    await api.start();
  });

  afterEach(async () => {
    await api.stop();
  });

  const fly = async (
    status: FlightStatus = 'checked_in',
    frames: unknown[][] = [boarding.value],
  ): Promise<void> => {
    const flightTracker = new FlightTrackerClient(
      api.baseUrl,
      new InMemoryTokenStore(),
    );
    await signIn(flightTracker);

    const logger = new Logger('error', null, 'test', () => undefined);
    const feed = new GroundServicesFeed(new StatusRegistry(), logger);
    const automation = new GsxAutomation(
      flightTracker,
      () => feed.services(),
      logger,
    );
    automation.setFlight({ id: FLIGHT_ID, status });
    automation.setSettings(await flightTracker.getGsxSettings());

    const controller = new AbortController();
    const evaluations: Promise<void>[] = [];

    await new GsxClient(
      {
        host: '127.0.0.1',
        port: 8744,
        helloTimeoutMs: 20,
        subscribeTimeoutMs: 20,
        open: () => {
          const socket = new StubGsx();

          const pushFrom = (index: number): void => {
            setImmediate(() => {
              if (index === frames.length) {
                socket.close();

                return;
              }

              socket.push({ v: 1, type: 'snapshot', services: frames[index] });
              pushFrom(index + 1);
            });
          };

          queueMicrotask(() => {
            socket.hello();
            pushFrom(0);
          });

          return socket;
        },
        sleep: () => {
          controller.abort();

          return Promise.resolve();
        },
      },
      {
        onStatus: (state) => feed.setStatus(state),
        onServices: (services) => {
          feed.accept(services);
          evaluations.push(automation.evaluate());
        },
        onStand: (stand) => feed.setStand(stand),
      },
    ).run(controller.signal);

    await Promise.all(evaluations);
  };

  it('tells the API that GSX started it, once', async () => {
    await fly();

    const requests = api.requestsTo(START_BOARDING);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBe('Bearer access-1');
    expect(JSON.parse(requests[0]?.body ?? '')).toEqual({ source: 'gsx' });
  });

  it('finishes offboarding once GSX completes deboarding, even as GSX goes back to offering it', async () => {
    await fly('offboarding_started', [
      withDeboarding('performing'),
      withDeboarding('completed'),
      withDeboarding('available'),
    ]);

    const requests = api.requestsTo(FINISH_OFFBOARDING);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBe('Bearer access-1');
    expect(JSON.parse(requests[0]?.body ?? '')).toEqual({ source: 'gsx' });
  });

  it('keeps offboarding open while GSX is still deboarding', async () => {
    await fly('offboarding_started', [withDeboarding('performing')]);

    expect(api.requestsTo(FINISH_OFFBOARDING)).toHaveLength(0);
  });

  it('keeps offboarding open while the pilot has automatic deboarding off', async () => {
    settingsAnswer = {
      status: 200,
      body: {
        integrationEnabled: true,
        autoBoardingEnabled: true,
        autoDeboardingEnabled: false,
      },
    };

    await fly('offboarding_started', [withDeboarding('completed')]);

    expect(api.requestsTo(FINISH_OFFBOARDING)).toHaveLength(0);
  });

  it('calls nothing while the pilot has automatic boarding off', async () => {
    settingsAnswer = {
      status: 200,
      body: {
        integrationEnabled: true,
        autoBoardingEnabled: false,
        autoDeboardingEnabled: true,
      },
    };

    await fly();

    expect(api.requestsTo(START_BOARDING)).toHaveLength(0);
  });

  it('reads an unexpected settings answer as off', async () => {
    settingsAnswer = { status: 200, body: { integrationEnabled: 'yes' } };

    await fly();

    expect(api.requestsTo(START_BOARDING)).toHaveLength(0);
  });

  it('surfaces an API too old to have the settings, for the caller to treat as off', async () => {
    settingsAnswer = { status: 404 };

    await expect(fly()).rejects.toThrow('failed with 404');
  });
});

describe('reading a turnaround out of GSX and onto the dashboard', () => {
  const drive = async (
    script: (socket: StubGsx) => void,
  ): Promise<StatusSnapshot[]> => {
    const status = new StatusRegistry();
    const logger = new Logger('error', null, 'test', () => undefined);
    const feed = new GroundServicesFeed(status, logger);
    const controller = new AbortController();
    const seen: StatusSnapshot[] = [];

    const client = new GsxClient(
      {
        host: '127.0.0.1',
        port: 8744,
        helloTimeoutMs: 20,
        subscribeTimeoutMs: 20,
        open: () => {
          const socket = new StubGsx();

          queueMicrotask(() => {
            script(socket);
            setImmediate(() => socket.close());
          });

          return socket;
        },
        sleep: () => {
          controller.abort();

          return Promise.resolve();
        },
      },
      {
        onStatus: (state) => {
          feed.setStatus(state);
          seen.push(status.snapshot());
        },
        onServices: (services) => {
          feed.accept(services);
          seen.push(status.snapshot());
        },
        onStand: (stand) => {
          feed.setStand(stand);
          seen.push(status.snapshot());
        },
      },
    );

    await client.run(controller.signal);

    return seen;
  };

  const withServices = (seen: StatusSnapshot[]): StatusSnapshot | undefined =>
    seen.filter((snapshot) => snapshot.groundServices.length > 0).at(-1);

  it('shows the boarding GSX is performing, with the stand it is on', async () => {
    const seen = await drive((socket) => {
      socket.hello();
      socket.push({
        v: 1,
        type: 'snapshot',
        services: boarding.value,
        parking: 'Terminal 4 - Concourse B|Gate 20A',
        airport: { icao: 'KJFK', name: 'Kennedy Intl' },
      });
    });

    const showing = withServices(seen);

    expect(showing?.groundHandling).toBe('connected');
    expect(showing?.stand).toEqual({
      airport: 'KJFK',
      parking: 'Terminal 4 - Concourse B|Gate 20A',
    });
    expect(
      showing?.groundServices.find((service) => service.id === 'boarding'),
    ).toMatchObject({
      state: 'performing',
      passengers: { done: 1, total: 1 },
      cargo: [
        { hold: 'front', unit: 'ULDs', done: 16, total: 20 },
        { hold: 'rear', unit: 'ULDs', done: 16, total: 16 },
      ],
    });
  });

  it('shows only the services that are worth showing', async () => {
    const seen = await drive((socket) => {
      socket.hello();
      socket.push({ v: 1, type: 'snapshot', services: boarding.value });
    });

    expect(
      withServices(seen)
        ?.groundServices.map((service) => service.id)
        .sort(),
    ).toEqual(['boarding', 'jetway']);
  });

  it('shows nothing at all when GSX cannot supply the feed', async () => {
    const seen = await drive((socket) => socket.hello(['menu', 'gate']));

    expect(seen.at(0)?.groundHandling).toBe('unsupported');
    expect(withServices(seen)).toBeUndefined();
  });

  it('forgets the turnaround when GSX goes away', async () => {
    const seen = await drive((socket) => {
      socket.hello();
      socket.push({ v: 1, type: 'snapshot', services: boarding.value });
    });

    expect(seen.at(-1)?.groundServices).toEqual([]);
    expect(seen.at(-1)?.groundHandling).toBe('searching');
  });
});

const LIVE_API = process.env.E2E_API_BASE_URL?.replace(/\/+$/, '') ?? '';

(LIVE_API === '' ? describe.skip : describe)(
  'signing in against a running MyPreflight API',
  () => {
    const decide = async (
      url: string,
      decision: 'approve' | 'deny',
    ): Promise<number> => {
      const web = await fetch(`${LIVE_API}/api/v1/auth/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'cabin-crew@example.com',
          password: 'P@$$w0rd',
        }),
      });
      const { accessToken } = (await web.json()) as { accessToken: string };
      const code = new URL(url).searchParams.get('code') ?? '';
      const decided = await fetch(
        `${LIVE_API}/api/v1/auth/device/${encodeURIComponent(code)}/${decision}`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      );

      return decided.status;
    };

    const signInAs = async (
      decision: 'approve' | 'deny',
      store = new InMemoryTokenStore(),
    ): Promise<{
      outcome: string;
      decisions: number[];
      transponder: FlightTrackerClient;
    }> => {
      const transponder = new FlightTrackerClient(LIVE_API, store);
      const decisions: Promise<number>[] = [];
      const outcome = await signInThroughBrowser(
        {
          api: transponder,
          browser: {
            open: (url) => {
              decisions.push(decide(url, decision));

              return Promise.resolve(true);
            },
          },
          logger: silentLogger(),
          deviceName: 'transponder-e2e',
        },
        () => undefined,
        AbortSignal.timeout(20_000),
      );

      return {
        outcome,
        decisions: await Promise.all(decisions),
        transponder,
      };
    };

    it('signs in through the browser and reads the pilot with the Transponder token', async () => {
      const { outcome, decisions, transponder } = await signInAs('approve');

      expect(decisions).toEqual([204]);
      expect(outcome).toBe('signed-in');
      await expect(transponder.getCurrentUser()).resolves.toMatchObject({
        email: 'cabin-crew@example.com',
      });
    }, 30_000);

    it('ends the session at the API when the pilot signs out', async () => {
      const store = new InMemoryTokenStore();
      const { outcome, transponder } = await signInAs('approve', store);
      const session = await store.read();

      expect(outcome).toBe('signed-in');
      expect(session).not.toBeNull();
      await expect(transponder.signOut()).resolves.toBe(true);

      const stale = new InMemoryTokenStore();
      await stale.write(session ?? { refreshToken: '' });

      await expect(
        new FlightTrackerClient(LIVE_API, stale).getCurrentUser(),
      ).rejects.toThrow(SessionExpiredError);
    }, 30_000);

    it('stops when the pilot declines in the browser', async () => {
      const { outcome, decisions } = await signInAs('deny');

      expect(decisions).toEqual([204]);
      expect(outcome).toBe('declined');
    }, 30_000);
  },
);
