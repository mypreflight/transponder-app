# transponder-app

The Transponder: the Windows app on the pilot's PC that feeds MSFS positions to the ADS-B receiver and mirrors Discord rich presence.

Last reviewed: 2026-10-20

This repo is part of MyPreflight. The knowledge base lives in the product repo, [mypreflight/product](https://github.com/mypreflight/product). It is the primary source of truth for product decisions, standards and architecture. Read it by URL before working here:

- Start: https://raw.githubusercontent.com/mypreflight/product/main/CLAUDE.md
- Standards: https://raw.githubusercontent.com/mypreflight/product/main/technology/backend/standards.md
- Architecture: https://raw.githubusercontent.com/mypreflight/product/main/technology/backend/architecture.md
- Product: https://raw.githubusercontent.com/mypreflight/product/main/product/transponder.md

If this file or the code contradicts the knowledge base, the knowledge base takes precedence. Flag the conflict; don't silently change either side.

## Repo-specific notes

Keep this short. Anything shared between repos belongs in the knowledge base.

- Run locally: Node 26. `npm install`, then `npm start` with the environment from `.env.example`. `npx ts-node src/main.ts --print-frame` draws the dashboard without a simulator. Both local sockets are reachable from macOS.
- Test: `npm test` (unit and integration), `npm run lint`, `npm run typecheck`. `src/architecture.spec.ts` fails the suite if an import runs against the layer order.
- Deploy: bump `package.json` `version` in every PR. Merging to `main` tags the version, then builds the single Windows executable with Bun and smoke-tests it on a Windows runner before it's published to GitHub Releases.
- Layers: `domain/` → `application/` (ports) → `infrastructure/` and `presentation/`. Imports run downward only; `main.ts` wires everything.
- Pilots run old versions for a long time. Never change what the app sends in a way the API or the receiver can't still accept.

When your change alters product behaviour, also open a PR to the knowledge base updating the matching file.
