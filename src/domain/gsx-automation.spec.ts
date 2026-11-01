import type { FlightStatus } from './flight-status';
import type { GroundService, ServiceId, ServiceState } from './ground-services';
import {
  GSX_AUTOMATION_OFF,
  type GsxSettings,
  stepToTake,
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

describe('stepToTake', () => {
  it.each<ServiceState>(['requested', 'performing'])(
    'starts boarding on a checked-in flight once GSX has it %s',
    (state) => {
      expect(
        stepToTake([service('boarding', state)], 'checked_in', ALL_ON),
      ).toBe('start-boarding');
    },
  );

  it.each<ServiceState>(['requested', 'performing'])(
    'starts deboarding on a flight on block once GSX has it %s',
    (state) => {
      expect(
        stepToTake([service('deboarding', state)], 'on_block', ALL_ON),
      ).toBe('start-offboarding');
    },
  );

  it.each<ServiceState | null>(['requestable', 'completed', 'bypassed', null])(
    'leaves boarding alone while GSX has it %s',
    (state) => {
      expect(
        stepToTake([service('boarding', state)], 'checked_in', ALL_ON),
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
      stepToTake([service('boarding', 'requested')], status, ALL_ON),
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
      stepToTake([service('deboarding', 'requested')], status, ALL_ON),
    ).toBeNull();
  });

  it('finishes offboarding once GSX has completed deboarding', () => {
    expect(
      stepToTake(
        [service('deboarding', 'completed')],
        'offboarding_started',
        ALL_ON,
      ),
    ).toBe('finish-offboarding');
  });

  it.each<ServiceState | null>([
    'requestable',
    'requested',
    'performing',
    'bypassed',
    null,
  ])('leaves offboarding open while GSX has deboarding %s', (state) => {
    expect(
      stepToTake([service('deboarding', state)], 'offboarding_started', ALL_ON),
    ).toBeNull();
  });

  it.each<FlightStatus | null>([
    'taxiing_in',
    'on_block',
    'offboarding_finished',
    'closed',
    null,
  ])('does not finish offboarding on a flight that is %s', (status) => {
    expect(
      stepToTake([service('deboarding', 'completed')], status, ALL_ON),
    ).toBeNull();
  });

  it('takes finishing offboarding from the automatic deboarding switch', () => {
    const completed = [service('deboarding', 'completed')];

    expect(
      stepToTake(completed, 'offboarding_started', {
        ...ALL_ON,
        autoDeboardingEnabled: false,
      }),
    ).toBeNull();
    expect(
      stepToTake(completed, 'offboarding_started', {
        ...ALL_ON,
        integrationEnabled: false,
      }),
    ).toBeNull();
    expect(
      stepToTake(completed, 'offboarding_started', {
        ...ALL_ON,
        autoBoardingEnabled: false,
      }),
    ).toBe('finish-offboarding');
  });

  it('never finishes boarding, because that needs the final loadsheet', () => {
    expect(
      stepToTake(
        [service('boarding', 'completed')],
        'boarding_started',
        ALL_ON,
      ),
    ).toBeNull();
  });

  it('does nothing while the integration is off, whatever the other switches say', () => {
    const settings = { ...ALL_ON, integrationEnabled: false };

    expect(
      stepToTake([service('boarding', 'requested')], 'checked_in', settings),
    ).toBeNull();
    expect(
      stepToTake([service('deboarding', 'requested')], 'on_block', settings),
    ).toBeNull();
  });

  it('honours each automatic switch on its own', () => {
    expect(
      stepToTake([service('boarding', 'requested')], 'checked_in', {
        ...ALL_ON,
        autoBoardingEnabled: false,
      }),
    ).toBeNull();
    expect(
      stepToTake([service('boarding', 'requested')], 'checked_in', {
        ...ALL_ON,
        autoDeboardingEnabled: false,
      }),
    ).toBe('start-boarding');
    expect(
      stepToTake([service('deboarding', 'requested')], 'on_block', {
        ...ALL_ON,
        autoDeboardingEnabled: false,
      }),
    ).toBeNull();
  });

  it('ignores every other ground service', () => {
    expect(
      stepToTake([service('refueling', 'performing')], 'checked_in', ALL_ON),
    ).toBeNull();
  });

  it('starts nothing with the settings it assumes before it has read any', () => {
    expect(
      stepToTake(
        [service('boarding', 'requested')],
        'checked_in',
        GSX_AUTOMATION_OFF,
      ),
    ).toBeNull();
  });
});
