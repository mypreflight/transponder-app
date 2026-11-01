import type { FlightStatus } from './flight-status';
import {
  type GroundService,
  isRunning,
  type ServiceId,
} from './ground-services';

export type GsxSettings = {
  integrationEnabled: boolean;
  autoBoardingEnabled: boolean;
  autoDeboardingEnabled: boolean;
};

export type GsxStep =
  | 'start-boarding'
  | 'start-offboarding'
  | 'finish-offboarding';

export const GSX_AUTOMATION_OFF: GsxSettings = {
  integrationEnabled: false,
  autoBoardingEnabled: false,
  autoDeboardingEnabled: false,
};

export function stepToTake(
  services: GroundService[],
  status: FlightStatus | null,
  settings: GsxSettings,
): GsxStep | null {
  if (!settings.integrationEnabled) {
    return null;
  }

  const requested = (id: ServiceId): boolean =>
    services.some((service) => service.id === id && isRunning(service));
  const completed = (id: ServiceId): boolean =>
    services.some(
      (service) => service.id === id && service.state === 'completed',
    );

  if (
    settings.autoBoardingEnabled &&
    status === 'checked_in' &&
    requested('boarding')
  ) {
    return 'start-boarding';
  }

  if (!settings.autoDeboardingEnabled) {
    return null;
  }

  if (status === 'on_block' && requested('deboarding')) {
    return 'start-offboarding';
  }

  if (status === 'offboarding_started' && completed('deboarding')) {
    return 'finish-offboarding';
  }

  return null;
}
