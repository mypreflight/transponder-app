import type { FlightStatus } from './flight-status';
import type { GroundService, ServiceId, ServiceState } from './ground-services';
import {
  GSX_AUTOMATION_OFF,
  type GsxSettings,
  serviceToStart,
} from './gsx-automation';

function service(id: ServiceId, state: ServiceState | null): GroundService {
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

const ALL_ON: GsxSettings = {
  integrationEnabled: true,
  autoBoardingEnabled: true,
  autoDeboardingEnabled: true,
};

describe('serviceToStart', () => {
  it.each<ServiceState>(['requested', 'performing'])(
    'starts boarding on a checked-in flight once GSX has it %s',
    (state) => {
      expect(
        serviceToStart([service('boarding', state)], 'checked_in', ALL_ON),
      ).toBe('boarding');
    },
  );

  it.each<ServiceState>(['requested', 'performing'])(
    'starts deboarding on a flight on block once GSX has it %s',
    (state) => {
      expect(
        serviceToStart([service('deboarding', state)], 'on_block', ALL_ON),
      ).toBe('deboarding');
    },
  );

  it.each<ServiceState | null>(['requestable', 'completed', 'bypassed', null])(
    'leaves boarding alone while GSX has it %s',
    (state) => {
      expect(
        serviceToStart([service('boarding', state)], 'checked_in', ALL_ON),
      ).toBeNull();
    },
  );

  it.each<FlightStatus | null>([
    'created',
    'ready',
    'boarding_started',
    'on_block',
    null,
  ])('does not start boarding on a flight that is %s', (status) => {
    expect(
      serviceToStart([service('boarding', 'requested')], status, ALL_ON),
    ).toBeNull();
  });

  it.each<FlightStatus | null>([
    'in_cruise',
    'taxiing_in',
    'offboarding_started',
    'checked_in',
    null,
  ])('does not start deboarding on a flight that is %s', (status) => {
    expect(
      serviceToStart([service('deboarding', 'requested')], status, ALL_ON),
    ).toBeNull();
  });

  it('does nothing while the integration is off, whatever the other switches say', () => {
    const settings = { ...ALL_ON, integrationEnabled: false };

    expect(
      serviceToStart(
        [service('boarding', 'requested')],
        'checked_in',
        settings,
      ),
    ).toBeNull();
    expect(
      serviceToStart(
        [service('deboarding', 'requested')],
        'on_block',
        settings,
      ),
    ).toBeNull();
  });

  it('honours each automatic switch on its own', () => {
    expect(
      serviceToStart([service('boarding', 'requested')], 'checked_in', {
        ...ALL_ON,
        autoBoardingEnabled: false,
      }),
    ).toBeNull();
    expect(
      serviceToStart([service('boarding', 'requested')], 'checked_in', {
        ...ALL_ON,
        autoDeboardingEnabled: false,
      }),
    ).toBe('boarding');
    expect(
      serviceToStart([service('deboarding', 'requested')], 'on_block', {
        ...ALL_ON,
        autoDeboardingEnabled: false,
      }),
    ).toBeNull();
  });

  it('ignores every other ground service', () => {
    expect(
      serviceToStart(
        [service('refueling', 'performing')],
        'checked_in',
        ALL_ON,
      ),
    ).toBeNull();
  });

  it('starts nothing with the settings it assumes before it has read any', () => {
    expect(
      serviceToStart(
        [service('boarding', 'requested')],
        'checked_in',
        GSX_AUTOMATION_OFF,
      ),
    ).toBeNull();
  });
});
