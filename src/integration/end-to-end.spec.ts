import { StubGsx, StubService } from './stub-services';
import { SessionExpiredError } from '../application/ports/session';
import { FlightTrackerClient } from '../infrastructure/mypreflight/client';
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
import boarding from '../infrastructure/gsx/fixtures/services-boarding.json';

const FLIGHT_ID = '0f0f6b04-9a5f-4e6c-9c4e-1d2f0f38a3b1';

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
  let signInStatus = 200;
  let flightBody: unknown;
  let statusBody: unknown;
  let refreshes = 0;
  let accessTokensIssued = 0;

  beforeEach(async () => {
    presenceStatus = 200;
    signInStatus = 200;
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
      'POST /api/v1/auth/sign-in': () => {
        if (signInStatus !== 200) {
          return { status: signInStatus };
        }

        accessTokensIssued += 1;
        return {
          status: 200,
          body: {
            accessToken: `access-${accessTokensIssued}`,
            refreshToken: 'refresh-1',
          },
        };
      },
      'POST /api/v1/auth/refresh': (request) => {
        refreshes += 1;

        if (request.authorization !== 'Bearer refresh-1') {
          return { status: 401 };
        }

        accessTokensIssued += 1;

        return {
          status: 200,
          body: {
            accessToken: `access-${accessTokensIssued}`,
            refreshToken: 'refresh-1',
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

  it('signs in and resolves the current flight callsign', async () => {
    const flightTracker = client();
    await flightTracker.signIn('pilot@example.com', 'P@$$w0rd');

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
    await flightTracker.signIn('pilot@example.com', 'P@$$w0rd');

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
    await flightTracker.signIn('pilot@example.com', 'P@$$w0rd');

    clock += 15 * 60 * 1000;
    await flightTracker.getCurrentFlight();

    const refresh = api.requestsTo('/api/v1/auth/refresh')[0];

    expect(refreshes).toBe(1);
    expect(refresh?.authorization).toBe('Bearer refresh-1');
    expect(refresh?.body).toBe('');
    expect(api.requestsTo('/api/v1/user/me')[0]?.authorization).toBe(
      'Bearer access-2',
    );
  });

  it('blames the credentials when they are what was rejected', async () => {
    signInStatus = 401;

    await expect(client().signIn('pilot@example.com', 'wrong')).rejects.toThrow(
      'That email and password were not accepted.',
    );
  });

  it('names the status when the sign-in failed for some other reason', async () => {
    signInStatus = 503;

    await expect(
      client().signIn('pilot@example.com', 'P@$$w0rd'),
    ).rejects.toThrow('The API answered 503 to the sign-in.');
  });

  it('reads the crew off the same request the flight id came from', async () => {
    const flightTracker = client();
    await flightTracker.signIn('pilot@example.com', 'P@$$w0rd');

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
    await flightTracker.signIn('pilot@example.com', 'P@$$w0rd');

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
    await store.write({ refreshToken: 'stale' });
    const flightTracker = new FlightTrackerClient(api.baseUrl, store, fetch);

    await expect(flightTracker.getCurrentFlight()).rejects.toThrow(
      SessionExpiredError,
    );
    expect(await store.read()).toBeNull();
  });

  it('publishes the activity on a payload and clears it on no content', async () => {
    const flightTracker = client();
    await flightTracker.signIn('pilot@example.com', 'P@$$w0rd');

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

describe('starting boarding when GSX reports it', () => {
  const START_BOARDING = `/api/v1/flight/${FLIGHT_ID}/start-boarding`;

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
      'POST /api/v1/auth/sign-in': () => ({
        status: 200,
        body: { accessToken: 'access-1', refreshToken: 'refresh-1' },
      }),
      'GET /api/v1/user/me/gsx-settings': () => settingsAnswer,
      [`POST ${START_BOARDING}`]: () => ({ status: 204 }),
    });

    await api.start();
  });

  afterEach(async () => {
    await api.stop();
  });

  const fly = async (): Promise<void> => {
    const flightTracker = new FlightTrackerClient(
      api.baseUrl,
      new InMemoryTokenStore(),
    );
    await flightTracker.signIn('pilot@example.com', 'P@$$w0rd');

    const logger = new Logger('error', null, 'test', () => undefined);
    const feed = new GroundServicesFeed(new StatusRegistry(), logger);
    const automation = new GsxAutomation(
      flightTracker,
      () => feed.running(),
      logger,
    );
    automation.setFlight({ id: FLIGHT_ID, status: 'checked_in' });
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

          queueMicrotask(() => {
            socket.hello();
            setImmediate(() => {
              socket.push({ v: 1, type: 'snapshot', services: boarding.value });
              setImmediate(() => socket.close());
            });
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
