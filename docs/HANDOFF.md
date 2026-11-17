# ConferenceDash: handoff / current status

Last updated: 2026-11-17. Read this first in a fresh session, then `CLAUDE.md` (procedures and rules) and `docs/SOURCING.md` (probe results).

## Goal (user's words)
"A database of every conference going on in the US", filterable by state/city/venue/date/organizer, with a "signal strength" symbol showing how likely each event is real. In scope: professional conferences, expos, trade shows, conventions, fan cons (Comic-Con). Out: concerts, sports, festivals, Ren faires, private/social, non-US. Window: 2026-11-15 .. 2027-12-31.

## Live output
- **Public site:** https://wowjustmike.github.io/ConferenceDash/ (GitHub Pages, deployed by `.github/workflows/deploy.yml` on every push to `main`). Repo: https://github.com/wowjustmike/ConferenceDash (public, created 2026-11-16). Pipeline runs on a cron (daily/weekly/monthly tiers) and commits `data/` including the SQLite database; `git pull` before local updates.
- Dashboard mirror (private Artifact, Version 5): https://claude.ai/artifact/As4fkRrQvheYc3FFY5prME
- 463 events (2026-11-17, after the coverage wave): 66 at 3 bars, 265 at 2, 132 at 1. 32 cities, 21 states (Las Vegas 121, Orlando 49, San Diego 45, Chicago 41, New York 27).
- Republish: `cd web && npm run artifact`, then publish `web/dist-artifact/dashboard.html` with the Artifact tool using the same file path (keeps the URL).
- Known artifact limits: map pins show without tiles (CSP); "Add to calendar" download does nothing.

## Layout
- `web/` React+Vite+TS app (~110 tests). `pipeline/` Node 24/TS (~359 tests, `node:sqlite`). `data/conferencedash.db` (committed; CI writes it too), `data/events.json` and `events.csv` (committed exports). `docs/` specs, plans, SOURCING.md. Branch `main` on GitHub (see Live output).

## Pipeline commands (run in `pipeline/`)
`npm run update -- --tier daily|weekly|monthly [--dry-run]` (about 10 min; run in background), `npm run export`, `npm run capture -- <url> [--source id] [--wait text] [--scrolls n] [--links]`, `npm run inbox`, `npm run ingest -- batch.json`, `npm run topics -- map.json`, `npm run exclude -- map.json`, `npm run unexclude -- <id>`.

## Sources working (registry.yaml)
confs.tech (71), ticketmaster (15, key in git-ignored `.env`), LA Convention Center (23), Dallas KBHCCD (5), Orlando OCCC (61), McCormick Place (39), Moscone (20), Las Vegas convention calendar (142), ExpoAssist US (140, aggregator), plus 12 venue readers from the 2026-11-17 coverage wave (San Diego 55, Nashville ~62, Philadelphia 26, Charlotte 20, Cleveland 16, Indianapolis 12, Portland 12, Milwaukee 12, Denver 8, Raleigh 7, Detroit 4, Louisville 3; raw counts before scope exclusions).
Rejected/unreadable: Tradeshowz (bot block), thetradeshowcalendar.com, Anaheim CC and IAEE/tech.vegas (robots), Javits (security checkpoint), Atlanta GWCC (no calendar), Austin CC, Luminik.

## Signal bars
Points per distinct source family: organizer site confirming this edition 3; ticketing listing 3; venue calendar 2; directory 1; aggregator 1. -1 conflicting dates, -1 stale (>60 days). 3+ pts = 3 bars, 2 = 2, else 1. Rules in `pipeline/sources/credibility.yaml`.

## Rules I operate under (accepted by user)
Respect robots.txt, never bypass blocks/CAPTCHAs/bot protection, 1 req/sec/host, identified user agent `ConferenceDashBot/1.0`, no guessing hidden endpoints. Never create/push a GitHub repo or enable Pages without asking. Never print or commit secrets. User approved: headless browser, anything non-destructive, native execution ("don't ask again"), free in-session reading instead of an API key.

## To-do (in recommended order)
1. ~~Fix duplicate detection~~ Done 2026-11-15: city-aware name matching plus alias-at-export (`pipeline/src/alias.ts`, `npm run unalias`). 5 pairs collapsed.
2. ~~Go public~~ Done 2026-11-16 (see Live output). `ANTHROPIC_API_KEY` is not set as a repo secret yet; the user sets it with `gh secret set ANTHROPIC_API_KEY` when they want LLM extraction in CI.
2a0. ~~Coverage wave~~ Done 2026-11-17 (plan `docs/superpowers/plans/2026-11-16-coverage-probe.md`, merged to `main`). 12 new venue readers (Philadelphia, Nashville, San Diego, Charlotte, Cleveland, Raleigh, Indianapolis, Portland, Milwaukee, Denver, Detroit, Louisville). Real weekly run: 20/21 sources ok (Nashville render failed once; re-probe fine, CI run picks it up). Classifier v3 now screens dance/cheer/volleyball/card-game competitions, luncheons/dinners/balls/awards, shows and holiday markets; 51 stored items excluded via `npm run exclude` (37 by the new rules, 12 judgment calls, 2 duplicates). Undecided, left in: Mega Magic Classic (Detroit), TSN Marquee Main Event (San Diego), Queen City Classic (Charlotte), City of Philadelphia National Quartet Blockbuster, Ordinary Devotion (Denver).
2a1. **Custom domain (waiting on the user):** user wants a subdomain of mikedmonds.com (DNS at Netlify). Recommended: CNAME `conferences` -> `wowjustmike.github.io` in Netlify DNS, then set the Pages custom domain (`gh api -X PUT repos/wowjustmike/ConferenceDash/pages -f cname=conferences.mikedmonds.com`) and enforce HTTPS. Do NOT set the custom domain before the DNS record exists: Pages would redirect the github.io URL to a dead name. No code change needed (`--base=./`).
2a. **Next coverage:** shareable URLs/feedback link (roadmap E). Dedicated readers needed for Columbus, Salt Palace, Minneapolis, Sacramento, DC, Phoenix, New Orleans, Seattle, Pittsburgh, Baltimore, Boston, Austin, Oklahoma City (see SOURCING.md). Decisions are in memory `scale-roadmap-decisions`.
3. **Topic review:** about 25 events still "Other" (Pink27, Annual Conference 2027, ISSA, SYNERGY, RCMA, ALCC, ASLA, ...).
4. **Dates TBC:** many events lack this year's confirmed dates; match organizer sites.
5. ~~Scheduled refresh~~ Done 2026-11-16: crons in `.github/workflows/pipeline.yml`.
6. **Ticketmaster key** was pasted in chat; advise rotating it (only the Consumer Key is used, stored in `.env`).
7. After any data change: run both test suites, commit, `npm run artifact`, republish, report counts.

## Deferred minors
Shard prune order, shard threshold on compact JSON, evidence seenAt churn, source families keyed on full host.
