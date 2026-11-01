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

export type AutomatedService = Extract<ServiceId, 'boarding' | 'deboarding'>;

export const GSX_AUTOMATION_OFF: GsxSettings = {
  integrationEnabled: false,
  autoBoardingEnabled: false,
  autoDeboardingEnabled: false,
};

export function serviceToStart(
  services: GroundService[],
  status: FlightStatus | null,
  settings: GsxSettings,
): AutomatedService | null {
  if (!settings.integrationEnabled) {
    return null;
  }

  const requested = (id: AutomatedService): boolean =>
    services.some((service) => service.id === id && isRunning(service));

  if (
    settings.autoBoardingEnabled &&
    status === 'checked_in' &&
    requested('boarding')
  ) {
    return 'boarding';
  }

  if (
    settings.autoDeboardingEnabled &&
    status === 'on_block' &&
    requested('deboarding')
  ) {
    return 'deboarding';
  }

  return null;
}
