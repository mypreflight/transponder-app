<div align="center">

[![mypreflight / transponder-app][banner]][homepage]

The desktop companion app for [**MyPreflight**][homepage] platform. App acts like an HTTP-based transponder, feeding
position from your flight simulator to our dedicated ADS-B receiver.

<a href="https://github.com/mypreflight/transponder-app/releases/latest">
  <img src="https://img.shields.io/badge/Download%20for%20Windows-2EA44F?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTEyIDE3IDUgMTBoNFYzaDZ2N2g0ek00IDE5aDE2djJINHoiLz48L3N2Zz4%3D" alt="Download for Windows" height="46">
</a>

**One file. No installer. Windows x64.**

</div>

## About

**MyPreflight** is a briefing service and electronic flight board app for your virtual flights, providing you realistic
figures, checklists, procedures and data to perform your flight like a real pilots do. You can customize your
experience, integrate with SimBrief and other tools. Check out our homepage at [mypreflight.io][homepage].

**This module** is the part running on your PC. It does things, that our servers cannot:
- reads your aircraft position and feeds it to our service, so you see your flight progress anywhere you are,
- sets your Discord rich presence, so your friends can be briefed on the flight you are commencing,
- reads the ground services running on your aircraft from GSX Pro, if you have it,
- connects with your printer, allowing you to print flight documents with real hardware.

[![integrity][ci-badge]][ci-url]
[![release][release-badge]][release-url]
[![license][license-badge]][license-url]

### Built with

[![TypeScript][ts-badge]][ts-url]
[![Node.js][node-shield]][node-url]
[![Bun][bun-badge]][bun-url]

Two runtime dependencies: `node-simconnect` and `dotenv`. Discord's IPC, the tray
icon and the dashboard are written against the platform directly.

## Getting started

### Requirements for end user

- **Windows 10** or **Windows 11**
- **Microsoft Flight Simulator 2024**
- **Discord**, if you want rich presence
- A **MyPreflight** account

### Install

No installer, nothing to configure.

1. Download `mypreflight-transponder.exe` from the [latest release][release-url].
2. Put it in a folder of its own.
3. Start the simulator, and Discord if you use it.
4. Start the app by double-click. Enter your MyPreflight credentials.
5. Your flight is going to be tracked automatically!

### Portable, and it stays that way

Everything the app writes lives in the folder the executable sits in, whichever
directory you happen to launch it from:

| File                            | What it holds                                          |
|---------------------------------|--------------------------------------------------------|
| `session.secret`                | your refresh token, encrypted with Windows DPAPI       |
| `mypreflight-transponder.log`   | the rolling log, capped at 5 MB plus one rotation      |
| `.env`                          | optional overrides, only if you write one              |

Nothing goes to `%APPDATA%`, nothing goes into the registry, no service is
registered and no shortcut is created. Deleting the folder uninstalls the app.
Carry the folder on a stick if you like; the session is the one thing that does
not travel, because DPAPI ties it to the Windows account that signed in, so the
app simply asks for the password again on a different machine.

If the folder cannot be written to — `C:\Program Files`, a read-only stick, a
locked share — the app says so on the dashboard and runs anyway, without a log
and without remembering the session. Move it somewhere you own, or point
`DATA_DIR` at a folder you can write to.

### Updates

The app asks GitHub for the newest release every 15 minutes and tells you when
it finds one:

```
  ^ update — v0.12.0 is out — press [u] to save it to your Downloads folder
```

Press `u` and it downloads that release into your Downloads folder as
`mypreflight-transponder-0.12.0.exe`, next to whatever is already there rather
than over it, and checks the download against the checksum GitHub publishes
before keeping it. Then quit the app and swap the executable for the new one —
it never replaces itself while running, and never restarts on its own.

For an unattended machine, `mypreflight-transponder.exe --download-update` does
the same thing and exits: nothing to download, or the path it wrote.

## Usage

Start a flight in the platform first. The callsign comes from that flight, so
nothing is published without one.

The dashboard has five sections: who is signed in, the current flight, the
transponder, Discord, and the state of both services. A sixth appears while
GSX is working your aircraft.

```
╭─ 3 XPNDR ─────────────────╮╭─ 4 COMMS ─────────────────────────────────────╮
│ sim:      ● connected     ││ discord:  ● connected                         │
│ callsign: [LH455]         ││ presence: [ON]                                │
│ tail:     [SP-LVD]        ││ BER -> WAW                                    │
│ squawk:   [2000]          ││ Cruise, landing at 15:50z                     │
│ mode:     [MODE C]        ││                                               │
│ spd:      451kt           ││                                               │
│ call:     11:30:30z       ││                                               │
╰───────────────────────────╯╰───────────────────────────────────────────────╯
```

### Ground services, if you have GSX

If [GSX Pro][gsx-url] is running, the app reads the turnaround from it and shows
what is happening on the dashboard: who is boarding, how many are aboard, how the
holds are filling, how much fuel has gone in.

```
╭─ 6 GROUND ────────────────────────────────────────────────────────────────╮
│ EDDB · Gate A15                                                           │
│ boarding   [RUNNING]    30/122 pax · bags 40% · front 16/20 ULDs           │
│ refueling  [RUNNING]    2221 kg loaded                                     │
│ jetway     [DONE]       docked                                             │
╰───────────────────────────────────────────────────────────────────────────╯
```

It is entirely optional and it reads only — nothing is ever sent to GSX, and no
service is requested, bypassed or cancelled on your behalf. If GSX is not
installed the section simply never appears and nothing reports a fault.

With the GSX integration turned on in your MyPreflight settings, the app also
acts on what it reads: when you request boarding through GSX on a checked-in
flight, it starts boarding in MyPreflight, and when you request deboarding once
you have reported on block, it starts offboarding, then finishes it when GSX
completes deboarding. Boarding and deboarding each have their own switch, and you
can still do any of these steps yourself. Finishing boarding stays with you,
because it needs your final loadsheet.

The app looks for GSX on this machine every twenty seconds, so starting GSX after
the app, or restarting it mid-flight, is picked up on its own. It needs a GSX new
enough to advertise its service feed; an older one connects and says so rather
than showing half a turnaround.

Set `GSX_ENABLED=false` to switch the whole thing off, or `GSX_HOST` and
`GSX_PORT` if GSX runs on a different machine from the app.

### The transponder switches itself

It looks up your current flight the moment it starts, and follows that flight
through the platform from then on:

| The flight reports  | The transponder |
|---------------------|-----------------|
| boarding started    | `MODE C`        |
| on block            | `STBY`          |

It comes up in `STBY` and stays there until boarding starts, so it never
publishes a position for a flight that has not begun. Start it mid-flight and
it arms itself straight away rather than waiting for the next boarding — the
flight is already under way. Between those two edges the switch is yours:
press `t` and it stays where you put it until the flight reaches the next edge.

Reports go out every ten seconds, and every thirty above 10,000 ft, where a
position a few seconds old is a position a few miles out either way. Takeoff and
touchdown are always published on the second they happen.

### Keys

| Key | What it does                                                    |
|-----|-----------------------------------------------------------------|
| `s` | sign in, or sign out — refused while the transponder transmits  |
| `t` | switch the transponder between `MODE C` and `STBY` by hand      |
| `c` | publish under a callsign you type, rather than the flight's     |
| `r` | read the current flight again, without waiting for the poll     |
| `d` | show the log                                                    |
| `u` | download a newer release, when there is one                     |

## Development

Needs Node 26. Both local sockets are reachable from macOS, so no Windows machine
is needed day to day.

### Layout

Four layers, and a file at the top that knows all of them. What a file may import
runs downward only — `main.ts` is the exception, because building the object graph
is what it is for.

```
src/
  main.ts           composition root: reads the config, wires everything, starts the loops
  domain/           the rules, and nothing that talks to anything: callsign, squawk,
                    report cadence, the flight phases that arm the transponder
  application/      the use cases: both feeds, sign-in, the updater, the supervisor
                    that restarts them, and the status registry they all report into
    ports/          what the use cases need, in their own words — an interface per
                    collaborator, and the error types the outcomes are branched on
  infrastructure/   everything outside the process, grouped by what it talks to —
                    mypreflight/  adsb/  github/  sim/  discord/  platform/  config/
  presentation/     the two things a pilot looks at: tui/ and tray/
  integration/      tests that span the layers, against stub services over real HTTP
```

Imports run downward only, and the adapters reach the core through `application/ports`
rather than the use cases directly — `src/architecture.spec.ts` walks the tree and fails
the suite on anything that does not.

Tests sit beside what they test, so `domain/rate-policy.ts` is covered by
`domain/rate-policy.spec.ts`.

```bash
npm install
npm test           # unit and integration tests
npm run lint       # biome
npm run typecheck
npm start          # needs the environment in .env.example
npm run build:exe  # single Windows executable, needs bun

npx ts-node src/main.ts --print-frame   # the dashboard, drawn without a simulator
```

Under `ts-node` the app has no executable to sit beside, so it keeps its state
in the working directory. `DATA_DIR` overrides that in either case, and expands
`%WINDOWS_STYLE%` variables.

## Contact

My name is Oskar, an experienced programmer, cybersecurity enthusiast, and conference speaker from Poland. Feel free to
contact me via the platforms below:

<div align="center">

[![LinkedIn][linkedin-badge]][linkedin-url]
[![GitHub][github-badge]][github-url]
[![Website][web-badge]][web-url]

</div>

## License

A public domain under the [Unlicense][license-url]. Do what you want with it. I am an experienced software engineer, but
I am not connected anyhow with the airline industry. This project is created for educational purposes only and should
not be used for real-world aviation operations.

[linkedin-badge]: https://img.shields.io/badge/Oskar%20Barcz-0A66C2?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTIwLjQ1IDIwLjQ1aC0zLjU1di01LjU3YzAtMS4zMy0uMDMtMy4wNC0xLjg1LTMuMDQtMS44NSAwLTIuMTQgMS40NS0yLjE0IDIuOTR2NS42N0g5LjM1VjloMy40MXYxLjU2aC4wNWMuNDgtLjkgMS42NC0xLjg1IDMuMzctMS44NSAzLjYgMCA0LjI3IDIuMzcgNC4yNyA1LjQ2djYuMjl6TTUuMzQgNy40M2MtMS4xNCAwLTIuMDYtLjkzLTIuMDYtMi4wNiAwLTEuMTQuOTItMi4wNiAyLjA2LTIuMDYgMS4xNCAwIDIuMDYuOTMgMi4wNiAyLjA2IDAgMS4xNC0uOTMgMi4wNi0yLjA2IDIuMDZ6bTEuNzggMTMuMDJIMy41NlY5aDMuNTZ2MTEuNDV6TTIyLjIzIDBIMS43N0MuNzkgMCAwIC43NyAwIDEuNzN2MjAuNTRDMCAyMy4yMy43OSAyNCAxLjc3IDI0aDIwLjQ1QzIzLjIgMjQgMjQgMjMuMjMgMjQgMjIuMjdWMS43M0MyNCAuNzcgMjMuMiAwIDIyLjIzIDB6Ii8%2BPC9zdmc%2B&logoColor=white
[linkedin-url]: https://www.linkedin.com/in/oskarbarcz
[github-badge]: https://img.shields.io/badge/@oskarbarcz-181717?style=for-the-badge&logo=github&logoColor=white
[github-url]: https://github.com/oskarbarcz
[web-badge]: https://img.shields.io/badge/barcz.me-4A5568?style=for-the-badge&logo=googlechrome&logoColor=white
[web-url]: https://barcz.me

[gsx-url]: https://www.fsdreamteam.com/products_gsxpro.html
[banner]: .github/assets/background.png
[homepage]: https://mypreflight.io
[ci-badge]: https://img.shields.io/github/actions/workflow/status/mypreflight/transponder-app/integrity.yaml?branch=main&style=for-the-badge&label=integrity
[ci-url]: https://github.com/mypreflight/transponder-app/actions/workflows/integrity.yaml
[release-badge]: https://img.shields.io/github/v/release/mypreflight/transponder-app?style=for-the-badge
[release-url]: https://github.com/mypreflight/transponder-app/releases/latest
[license-badge]: https://img.shields.io/github/license/mypreflight/transponder-app?style=for-the-badge
[license-url]: https://unlicense.org
[node-shield]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org
[ts-badge]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org
[bun-badge]: https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white
[bun-url]: https://bun.sh
