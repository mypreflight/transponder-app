# gsx-flight-automation Specification

## Purpose

Start boarding and offboarding on the pilot's MyPreflight flight when the pilot requests them
through GSX, so the pilot doesn't do the same step twice. The system acts on MyPreflight only:
nothing is ever sent to GSX.

## Requirements

### Requirement: A service requested through GSX starts on the flight

The system SHALL start boarding when GSX reports boarding as requested or being performed and the current flight is checked in, and SHALL start offboarding when GSX reports deboarding as requested or being performed and the current flight is on block. It SHALL tell the API that GSX is the source of the request.

#### Scenario: Boarding requested

- **WHEN** GSX reports boarding as requested on a checked-in flight
- **THEN** boarding is started on the flight, naming GSX as the source

#### Scenario: Deboarding requested before on-block is reported

- **WHEN** GSX reports deboarding as requested while the flight is not yet on block, and the pilot then reports on block while GSX still has it running
- **THEN** offboarding is started once the app sees the flight on block

### Requirement: The pilot's switches decide

The system SHALL read the pilot's GSX settings from the API, and SHALL start boarding only with the integration and automatic boarding on, and offboarding only with the integration and automatic deboarding on. It SHALL start nothing until it has read them, and SHALL treat an API that cannot answer as having everything off. The integration switch governs starting services only: reading GSX and showing the turnaround on the dashboard stay as they are.

#### Scenario: A switch is off

- **WHEN** GSX reports boarding as requested while automatic boarding is off
- **THEN** nothing is sent to the API

### Requirement: A service is started once, and failures are retried gently

The system SHALL send one request for each service on each flight, however often GSX reports it, SHALL wait about thirty seconds before retrying a request that failed, and SHALL NOT let a failed request affect any other function.

#### Scenario: GSX keeps reporting boarding

- **WHEN** GSX reports boarding again before the flight's new status has been read
- **THEN** no second request is sent

#### Scenario: The API refuses

- **WHEN** the API refuses a request, because the pilot started it themselves or a switch has just changed
- **THEN** a warning is logged and position reporting, rich presence and the dashboard carry on
