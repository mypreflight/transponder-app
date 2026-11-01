# gsx-flight-automation Specification

## Purpose

Start boarding and offboarding on the pilot's MyPreflight flight when the pilot requests them
through GSX, and finish offboarding when GSX completes deboarding, so the pilot doesn't do the
same step twice. The system acts on MyPreflight only: nothing is ever sent to GSX.

## Requirements

### Requirement: A service requested through GSX starts on the flight

The system SHALL start boarding when GSX reports boarding as requested or being performed and the current flight is checked in, and SHALL start offboarding when GSX reports deboarding as requested or being performed and the current flight is on block. It SHALL tell the API that GSX is the source of the request.

#### Scenario: Boarding requested

- **WHEN** GSX reports boarding as requested on a checked-in flight
- **THEN** boarding is started on the flight, naming GSX as the source

#### Scenario: Deboarding requested before on-block is reported

- **WHEN** GSX reports deboarding as requested while the flight is not yet on block, and the pilot then reports on block while GSX still has it running
- **THEN** offboarding is started once the app sees the flight on block

### Requirement: Offboarding finishes when GSX completes deboarding

The system SHALL finish offboarding when GSX reports deboarding as completed and the current flight's offboarding has started, however it was started, and SHALL tell the API that GSX is the source. A completion SHALL count even if GSX has since gone back to offering deboarding. A bypassed deboarding SHALL NOT count, because passengers were not seen off. The system SHALL NOT finish boarding, which needs the final loadsheet from the pilot.

#### Scenario: Deboarding completes

- **WHEN** GSX reports deboarding as completed on a flight whose offboarding has started
- **THEN** offboarding is finished on the flight, naming GSX as the source

#### Scenario: The pilot started offboarding themselves

- **WHEN** the pilot started offboarding in the app and GSX then completes deboarding
- **THEN** offboarding is finished on the flight, naming GSX as the source

#### Scenario: Deboarding was bypassed

- **WHEN** GSX reports deboarding as bypassed on a flight whose offboarding has started
- **THEN** offboarding stays open for the pilot to finish

### Requirement: The pilot's switches decide

The system SHALL read the pilot's GSX settings from the API, and SHALL start boarding only with the integration and automatic boarding on, and start or finish offboarding only with the integration and automatic deboarding on. It SHALL do nothing until it has read them, and SHALL treat an API that cannot answer as having everything off. The integration switch governs these steps only: reading GSX and showing the turnaround on the dashboard stay as they are.

#### Scenario: A switch is off

- **WHEN** GSX reports boarding as requested while automatic boarding is off
- **THEN** nothing is sent to the API

### Requirement: A step is taken once, and failures are retried gently

The system SHALL send one request for each step on each flight, however often GSX reports it, SHALL wait about thirty seconds before retrying a request that failed, and SHALL NOT let a failed request affect any other function.

#### Scenario: GSX keeps reporting boarding

- **WHEN** GSX reports boarding again before the flight's new status has been read
- **THEN** no second request is sent

#### Scenario: The API refuses

- **WHEN** the API refuses a request, because the pilot started it themselves or a switch has just changed
- **THEN** a warning is logged and position reporting, rich presence and the dashboard carry on
