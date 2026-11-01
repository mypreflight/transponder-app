# desktop-runtime Specification

## Purpose
Run the two feeds as one long-lived process on the pilot's PC: credentials, lifecycle, the
tray, and enough diagnostics that a pilot can tell which of four connections is unhappy.
## Requirements
### Requirement: The pilot signs in once and the session is renewed unattended

The system SHALL sign in to `flight-tracker-api` through the pilot's browser, with the device
authorization flow: it asks the API for a code, shows the address and the code, opens the
address in the default browser, and polls at the interval the API names until the pilot
approves or declines there, or the code expires. The app SHALL NOT ask for, see or store a
password. It SHALL keep only the resulting tokens, and renew the short-lived access token from
the refresh token before it expires. A refresh that fails because the session is gone SHALL
leave the app running and let the pilot start a new browser sign-in.

The code SHALL be shown in full on screen so the pilot can compare it with the one the browser
shows before approving. Opening the browser SHALL be best effort: when it fails, the printed
address is the way in, and nothing else changes. The app SHALL send the machine's name, cut to
what the API accepts, so the pilot can recognise the session later.

Signing in SHALL be reachable for as long as the app is running, and not only in the moments
before the dashboard takes the console. The pilot SHALL be able to stop waiting at any time.
The outcome of an attempt SHALL be shown to the pilot rather than only written to the log file.

Where a session is already stored, the current flight SHALL be read as the app starts, and no
slower start-up work SHALL be allowed to hold that reading up. The pilot SHALL also be able to
ask for the flight to be read again at any time, so that something changed in the platform can
be picked up at once rather than at the next poll.

#### Scenario: First run

- **WHEN** the app starts with no stored session
- **THEN** it shows the address and the code, opens the browser on them, and does not publish
  anything until the pilot approves

#### Scenario: The browser does not open

- **WHEN** the default browser cannot be started
- **THEN** the address and the code stay on screen and the app keeps waiting for the approval

#### Scenario: The pilot declines in the browser

- **WHEN** the API answers that the sign-in was declined
- **THEN** the app stops polling at once and hands over to the dashboard, which names the key
  that starts a new sign-in

#### Scenario: The code expires

- **WHEN** the code runs out before the pilot approves, or the API no longer knows it
- **THEN** the app stops polling and offers a new code, which the pilot takes with Enter or
  skips with Ctrl+C

#### Scenario: The API cannot be reached while waiting

- **WHEN** a poll fails on the network or with a server fault
- **THEN** the app keeps polling at the same interval until the code expires

#### Scenario: The pilot stops waiting

- **WHEN** the pilot presses Ctrl+C at the console, or Esc on the dashboard, while a code is shown
- **THEN** polling stops at once, and the dashboard names the key that starts a new sign-in

#### Scenario: Signing in while the app is already running

- **WHEN** the pilot starts a sign-in from the dashboard
- **THEN** the dashboard shows the code and the address, the current flight is looked up as soon
  as the pilot approves rather than at the next poll, and the result of the attempt is put in
  front of the pilot

#### Scenario: A session was already stored

- **WHEN** the app starts with a session it can renew
- **THEN** the current flight is read at once, and nothing slower — the ADS-B token check among
  them — holds that reading up

#### Scenario: The pilot asks for the flight again

- **WHEN** the pilot presses the key that re-reads the flight
- **THEN** the flight is read at once, and holding the key down does not stack up requests

#### Scenario: Access token expires during a flight

- **WHEN** the access token reaches its expiry mid-flight
- **THEN** it is renewed from the refresh token with no interruption to either feed

#### Scenario: The session was revoked

- **WHEN** the refresh token is rejected
- **THEN** the app clears the stored session, names the key that starts a new browser sign-in,
  clears the Discord activity, and stops publishing positions

### Requirement: Secrets are held in the operating system credential store

The system SHALL store the refresh token in the Windows credential store, scoped to the
signed-in Windows user, with the encrypted blob beside the executable, and SHALL NOT write it
to a configuration file or a log. Where the credential store cannot be used, the fallback
SHALL be a `0600` file in the same folder. Where the folder cannot be written to, the token
SHALL be held in memory for the life of the process and nowhere else.

#### Scenario: Tokens at rest

- **WHEN** the pilot has signed in and the app is stopped
- **THEN** the folder holds the encrypted session and nothing readable, and no secret exists
  anywhere else on the machine

### Requirement: The ADS-B client token is validated at startup

The system SHALL verify the ADS-B client token against the service's client auth check before
publishing, and SHALL report an invalid or revoked token as an error the pilot can see rather
than publishing reports that are silently rejected.

#### Scenario: The token was revoked

- **WHEN** the stored ADS-B token is no longer valid
- **THEN** the app reports the ADS-B service as unauthorised, stops publishing, and keeps
  rich presence working

### Requirement: The tray reports the state of every connection

The system SHALL show, at any moment, whether each of the simulator, the Discord client, the
ADS-B service and the API is connected, together with the callsign it is publishing under and
the aircraft identifier the simulator reports.

The system SHALL also show its state in the notification area, since that is the only part of it
visible while the simulator is fullscreen. That indicator SHALL distinguish a fault from standby
from waiting for a flight from transmitting, and SHALL name on hover what it is doing and any
fault. It SHALL offer no commands — those live on the status view — and SHALL cost neither a
second process nor a second file. Where the notification area cannot be reached, the system SHALL
carry on without it and SHALL say which call was refused.

#### Scenario: A pilot's track is missing

- **WHEN** the pilot opens the status view while the simulator identifier disagrees with the
  flight callsign
- **THEN** both values are visible, making the mismatch diagnosable without logs

#### Scenario: The simulator is fullscreen

- **WHEN** the pilot is flying and the console is behind the simulator
- **THEN** the notification area shows whether the transponder is transmitting, and hovering it
  names the callsign and how much has been sent

#### Scenario: The notification area refuses the icon

- **WHEN** any of the calls that place the icon fails
- **THEN** both feeds carry on and the log names the call that failed

#### Scenario: Everything is healthy in flight

- **WHEN** all four connections are up and the aircraft is airborne
- **THEN** the tray shows the callsign being published and the time of the last accepted
  report

### Requirement: The status view is read as five sections

The system SHALL group what it shows into the crew signed in, the current service, the
transponder, the Discord connection, and the state of the services it depends on. The
transponder section SHALL report the aircraft's own state — the identifier the simulator gives,
the squawk, the ground speed, and the mode the pilot has selected — separately from the flight
the API assigned, so that a disagreement between the two is visible rather than mysterious. It
SHALL report when the last report was accepted, precisely enough to tell a feed that stopped
from one that is a second old.

Every key the system offers SHALL be visually distinguishable from the words describing it. The
system SHALL NOT advertise quitting as one of them. Every key SHALL be named on one line at the
width the view is drawn for, in every state that line can be in, so that learning the keys never
costs the pilot a wider terminal.

#### Scenario: The simulator is flying a different aircraft than the flight assigns

- **WHEN** the simulator's identifier and the flight's tail differ
- **THEN** both are on the screen, in their own sections

#### Scenario: Nothing has been published for a while

- **WHEN** the feed stopped some minutes ago
- **THEN** the time of the last accepted report is shown, and is what reveals it

#### Scenario: All the keys at once

- **WHEN** the view is drawn at eighty columns in the state whose hint line is longest — a
  session to end, and the log pane open
- **THEN** every key it offers is named on that line, none of it cut off

### Requirement: A broken connection says why, on the screen

The system SHALL show, on the status view itself, the reason a connection is unhappy and not
only the fact of it. The reason SHALL be readable in full rather than truncated, and SHALL be
bounded so that a long one cannot displace the rest of the view. Where the pilot can act on the
fault, the message SHALL say what to do. A reason SHALL be cleared when the connection recovers.

#### Scenario: The simulator is not running

- **WHEN** the SimConnect connection cannot be established
- **THEN** the view names the simulator, says its pipe is absent, and says to start the
  simulator — without the pilot opening any log

#### Scenario: The simulator is across the network

- **WHEN** the connection to a configured `SIMCONNECT_HOST` is refused
- **THEN** the message names the host and points at the simulator's own configuration and the
  port, which is what is usually wrong

#### Scenario: More than one thing is wrong

- **WHEN** several connections are unhappy at once
- **THEN** one fault is shown, the one the pilot is most able to act on

#### Scenario: The connection recovers

- **WHEN** the simulator connects
- **THEN** the fault disappears from the view

### Requirement: Ending a session cannot strand a flight

The system SHALL let the pilot end the session from the status view, and SHALL refuse to do so
while the transponder is transmitting, showing that the action is unavailable rather than
failing when it is used. Signing out SHALL end the session at the API as well as on the PC, and
SHALL still forget it on the PC when the API cannot be reached.

#### Scenario: Signing out mid-flight

- **WHEN** the pilot asks to sign out while position reports are being published
- **THEN** nothing happens, and the action is shown as unavailable until transmission is
  switched off

#### Scenario: Signing out with the API unreachable

- **WHEN** the pilot signs out and the API does not answer
- **THEN** the stored session is cleared anyway, and the log says the session was only
  forgotten on this PC

### Requirement: The status view names the version at both ends and its own

The system SHALL show, alongside the state of each remote service, the version that service
reports and the version of the app itself. A version SHALL be obtained without a session and
without the ADS-B client token, so that it is still readable when either of those is what has
failed. A version that could not be read SHALL be shown as absent and SHALL NOT stop anything
else. Versions SHALL be re-read rarely, since neither changes except on a deployment.

#### Scenario: Reporting a fault against a deployment

- **WHEN** the pilot opens the status view
- **THEN** the version of the API, the version of the ADS-B service and the version of the app
  are all readable off one screen

#### Scenario: The session has expired

- **WHEN** the API rejects the stored session
- **THEN** the API's version is still shown, because reading it never needed the session

#### Scenario: A service cannot be reached at all

- **WHEN** a version cannot be read
- **THEN** the row shows the state without a version, and both feeds carry on unaffected

#### Scenario: A service has no status route

- **WHEN** a service answers nothing useful at its root
- **THEN** the version is read from the service's own API document instead, rather than being
  reported as absent

#### Scenario: A newer build has been released

- **WHEN** the newest published release is newer than the running build
- **THEN** the view says an update is possible and names the version

#### Scenario: Running a build from source

- **WHEN** the running build has no release version
- **THEN** no update is offered, whatever has been published

### Requirement: The app survives the sim it accompanies, and registers itself nowhere

The system SHALL keep running when the simulator, Discord, or the network go away, and a crash
in one feed SHALL NOT stop the other: each runs as an independently supervised loop that is
restarted with a bounded, backing-off delay. The system SHALL NOT install itself to start with
Windows, write a registry entry, or place a shortcut, because nothing outside the folder the
pilot dropped it in is the app's to write. A pilot who wants it to start with Windows SHALL be
able to do that with a shortcut of their own placing.

#### Scenario: One feed fails

- **WHEN** the position feed throws an unexpected error
- **THEN** it is restarted by its supervisor and rich presence is unaffected

#### Scenario: A dependency is absent for a long time

- **WHEN** the simulator or the network is away for hours
- **THEN** the retry interval grows to a ceiling rather than either giving up or hammering, and
  the app is still there when the dependency returns

#### Scenario: Uninstalling

- **WHEN** the pilot deletes the folder
- **THEN** nothing of the app remains on the machine, because nothing was registered

### Requirement: Diagnostics are local, bounded and readable from the dashboard

The system SHALL write a rolling local log of connection state, published report counts and
failures, bounded in size and rotated rather than grown without limit, with credentials redacted
from every line it writes. The recent log SHALL be readable from the dashboard itself, on a key,
and SHALL be hidden until asked for so a healthy flight is not narrated at the pilot. A message
the pilot needs to act on SHALL NOT depend on that pane being open.

#### Scenario: A pilot reports a problem

- **WHEN** the pilot opens the log pane after a failed flight
- **THEN** it shows when each connection came and went and how many reports were published and
  dropped, and the log file carries the same history for attaching to a report

#### Scenario: A credential passes through a message

- **WHEN** a token, a password or an authorization header would appear in a log line
- **THEN** it is redacted before the line is written or shown

#### Scenario: The log outgrows its bound

- **WHEN** the log file reaches its size limit
- **THEN** it is rotated and the app keeps logging, rather than filling the pilot's disk

#### Scenario: Something needs the pilot's attention

- **WHEN** a sign-in fails, or an update is waiting
- **THEN** it is put on the frame itself, not only into the log pane

### Requirement: Everything the app writes lives in one folder it was put in

The system SHALL resolve every file it writes — the encrypted session and the log — against
the directory holding the executable, independent of the working directory it was started
from. It SHALL NOT write to `%APPDATA%`, `%LOCALAPPDATA%`, the registry, or any other location
outside that folder, and SHALL NOT register a service, a shortcut or an autostart entry.
Deleting the folder SHALL remove every trace of the app but the downloads the pilot asked for.

A pilot who wants the state elsewhere SHALL be able to name that folder in configuration,
Windows-style variables included, and the folder SHALL be created if it does not exist.

Where there is no executable to sit beside — the app run from source under a runtime — the
working directory SHALL be used instead.

#### Scenario: Started from somewhere else

- **WHEN** the app is launched by a shortcut, a terminal or a scheduled task whose working
  directory is not the app's folder
- **THEN** the session and the log are written beside the executable, not into that directory

#### Scenario: Carried on a stick

- **WHEN** the folder is copied to another machine and the app is started
- **THEN** it runs, and asks the pilot to sign in again in the browser, because the credential
  store bound the session to the Windows account that signed in

#### Scenario: The pilot wants the state somewhere else

- **WHEN** `DATA_DIR` names a folder, absolute or relative to the app, with or without
  `%WINDOWS_STYLE%` variables
- **THEN** the session and the log go there, and the folder is created if needed

### Requirement: A folder that cannot be written to is a reported state, not a failure

The system SHALL detect that it cannot write to its own folder before it needs to, SHALL keep
running with the session held in memory only and no log file, and SHALL put the folder and the
way out in front of the pilot on the dashboard rather than only in a log line it cannot write.
It SHALL NOT fall back to any other location on the machine.

#### Scenario: Dropped into Program Files

- **WHEN** the app runs from a folder that refuses writes
- **THEN** the dashboard names that folder, says the session and the log are off, and both
  feeds run as normal

#### Scenario: The pilot signs in anyway

- **WHEN** the pilot signs in while the folder takes no writes
- **THEN** the session works for as long as the app runs, and is gone at the next start

