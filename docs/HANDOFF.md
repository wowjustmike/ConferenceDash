# ConferenceDash: handoff / current status

Last updated: 2026-11-15. Read this first in a fresh session, then `CLAUDE.md` (procedures and rules) and `docs/SOURCING.md` (probe results).

## Goal (user's words)
"A database of every conference going on in the US", filterable by state/city/venue/date/organizer, with a "signal strength" symbol showing how likely each event is real. In scope: professional conferences, expos, trade shows, conventions, fan cons (Comic-Con). Out: concerts, sports, festivals, Ren faires, private/social, non-US. Window: 2026-11-15 .. 2027-12-31.

## Live output
- Dashboard (private Artifact, Version 4): https://claude.ai/artifact/As4fkRrQvheYc3FFY5prME
- 354 events: 56 at 3 bars, 165 at 2, 133 at 1. About 26 cities, 16 states (Las Vegas ~124, Orlando ~47, Chicago ~41).
- Republish: `cd web && npm run artifact`, then publish `web/dist-artifact/dashboard.html` with the Artifact tool using the same file path (keeps the URL).
- Known artifact limits: map pins show without tiles (CSP); "Add to calendar" download does nothing.

## Layout
- `web/` React+Vite+TS app (~110 tests). `pipeline/` Node 24/TS (~285 tests, `node:sqlite`). `data/conferencedash.db` (git-ignored), `data/events.json` and `events.csv` (committed exports). `docs/` specs, plans, SOURCING.md. Local git, branch `main`, no remote. Last commit: "data: scope cleanup and topics for LA/Dallas events".

## Pipeline commands (run in `pipeline/`)
`npm run update -- --tier daily|weekly|monthly [--dry-run]` (about 10 min; run in background), `npm run export`, `npm run capture -- <url> [--source id] [--wait text] [--scrolls n] [--links]`, `npm run inbox`, `npm run ingest -- batch.json`, `npm run topics -- map.json`, `npm run exclude -- map.json`, `npm run unexclude -- <id>`.

## Sources working (registry.yaml)
confs.tech (71), ticketmaster (15, key in git-ignored `.env`), LA Convention Center (23), Dallas KBHCCD (5), Orlando OCCC (61), McCormick Place (39), Moscone (20), Las Vegas convention calendar (141), ExpoAssist US (140, aggregator).
Rejected/unreadable: Tradeshowz (bot block), thetradeshowcalendar.com, Anaheim CC and IAEE/tech.vegas (robots), Javits (security checkpoint), Atlanta GWCC (no calendar), Austin CC, Luminik.

## Signal bars
Points per distinct source family: organizer site confirming this edition 3; ticketing listing 3; venue calendar 2; directory 1; aggregator 1. -1 conflicting dates, -1 stale (>60 days). 3+ pts = 3 bars, 2 = 2, else 1. Rules in `pipeline/sources/credibility.yaml`.

## Rules I operate under (accepted by user)
Respect robots.txt, never bypass blocks/CAPTCHAs/bot protection, 1 req/sec/host, identified user agent `ConferenceDashBot/1.0`, no guessing hidden endpoints. Never create/push a GitHub repo or enable Pages without asking. Never print or commit secrets. User approved: headless browser, anything non-destructive, native execution ("don't ask again"), free in-session reading instead of an API key.

## To-do (in recommended order)
1. ~~Fix duplicate detection~~ Done 2026-11-15: city-aware name matching plus alias-at-export (`pipeline/src/alias.ts`, `npm run unalias`). 5 pairs collapsed.
2. **Go public (approved 2026-11-15):** public GitHub repo + Pages + weekly Actions refresh. Ask before creating the repo. Then coverage via platform-family adapters and a `probe` command, then data-volume checks, then shareable URLs/feedback link. Decisions are in memory `scale-roadmap-decisions`.
2b. **Second wave of venue readers:** Houston, Denver, Washington DC, San Diego, Nashville, Boston. Probe each first (robots, structure); skip blocked sites and record them in SOURCING.md.
3. **Topic review:** about 25 events still "Other" (Pink27, Annual Conference 2027, ISSA, SYNERGY, RCMA, ALCC, ASLA, ...).
4. **Dates TBC:** many events lack this year's confirmed dates; match organizer sites.
5. **Scheduled refresh** needs a GitHub repo, secrets and Pages. Requires the user's OK; nothing created. (`.github/workflows/pipeline.yml` is manual-only for now.)
6. **Ticketmaster key** was pasted in chat; advise rotating it (only the Consumer Key is used, stored in `.env`).
7. After any data change: run both test suites, commit, `npm run artifact`, republish, report counts.

## Deferred minors
Shard prune order, shard threshold on compact JSON, evidence seenAt churn, source families keyed on full host.
