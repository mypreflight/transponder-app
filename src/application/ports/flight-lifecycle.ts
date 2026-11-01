export interface FlightLifecycle {
  startBoarding(flightId: string): Promise<void>;
  startOffboarding(flightId: string): Promise<void>;
}
