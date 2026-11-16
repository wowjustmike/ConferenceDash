# ConferenceDash: Event Database, Signal Strength and Source Expansion

Date: 2026-11-15 · Status: DRAFT, awaiting user approval
Builds on: `2026-11-15-conferencedash-design.md` (original spec), the finished web app and the finished pipeline.

## 1. Purpose and decisions

Build a complete, trustworthy database of US professional events from **today (2026-11-15) through 2027-12-31**, and show how much each event can be trusted.

Decisions from the user:

| Topic | Decision |
|---|---|
| Event scope | Professional conferences, conventions, trade shows and expos, **including public expos and fan conventions** (CES, trade shows, Comic-Con are in). **Out:** concerts, sports, festivals, Renaissance faires, anything primarily entertainment-for-the-public that is not an expo/convention. |
| Who reads pages | **Claude Code in-session, free.** The user opens Claude Code in this folder and asks for an update; Claude reads pages and writes the data. A later phase can swap in an API-driven runner. |
| Headless browser | Approved (Playwright + Chromium, local). |
| Accounts | User will create a free Ticketmaster developer key. No AI API key for now. |
| Credibility | Show a three-level **signal strength** per event (section 4). |

## 2. Architecture

```
 sources ──> fetch (HTTP or headless browser) ──> extract ──> observations ┐
 (registry)        │ politeness, cache                  ▲                 │
                   └─> inbox/ (pages needing a reader) ─┘ (Claude reads,  │
                       writes ingest/*.json)                              ▼
                                         dedupe + classify + verify ──> events ──> signal ──> export ──> web/public/events.json
                                                          SQLite database (source of truth)
```

- **Source of truth:** one SQLite file, `data/conferencedash.db`, using Node's built-in `node:sqlite` (no native build step). The file is git-ignored; `events.json` is the committed, shareable export.
- **Web app:** unchanged contract. It still loads `events.json`, now with two extra optional fields per event (`signal`, `kind`).
- **Two kinds of work:** *deterministic* (fetch, parse structured data, verify dates on official sites, score, export) runs as a CLI; *judgment* (reading messy pages, classifying events as in/out of scope, resolving ambiguous duplicates) is done by Claude in an update session and recorded through a validated `ingest` command. Both write to the same database.
- **Scale:** thousands of events is small for SQLite. The real limits are politeness to the sites we fetch and the effort of reading pages, so the design is incremental (ETag caching, per-host queues, resumable runs) and the export is sharded by month only if `events.json` exceeds 5 MB (the web loader reads an `index.json` when shards exist).

## 3. Data model (SQLite)

| Table | Purpose |
|---|---|
| `sources` | One row per declared source: `id`, `kind` (api, feed, venue-calendar, directory, aggregator, organizer-site, ticketing), `family` (see 4.2), `credibility` (points), `robots_ok`, `notes`, last health. |
| `fetches` | Every request made: url, host, status, fetched_at, etag, content hash, bytes. Drives caching, politeness and resumability. |
| `observations` | One row per sighting of an event by a source: raw name, dates, city/state, venue, organizer, url, `source_id`, `fetch_id`, `seen_at`, `extractor` (feed, jsonld, dom, claude). Never edited; new sightings are appended. |
| `events` | The merged, canonical event: id, name, start/end, `dates_confirmed`, city, state, venue, organizer, topics, `kind`, est_attendance, official_url, status (active/cancelled/past/excluded), `last_verified`, `signal_points`, `signal_bars`. |
| `event_observations` | Links observations to the event they support (many-to-one) with the merge decision and who made it (rule or Claude). |
| `inbox` | Pages fetched and saved as text that need a reader: url, source_id, saved path, status (pending, done, skipped), notes. |
| `runs` | One row per update run: timestamps, counts, per-source health, errors. |

Dedupe, ID stability and the "never lose or downgrade data" rules from the pipeline spec carry over unchanged (ids never change, confirmed dates are never reverted, an empty fetch never deletes events).

**Classification:** each event gets a `kind` of `conference`, `trade_show`, `expo`, `convention` or `fan_con`, or is marked `excluded` with a reason (concert, sports, festival, faire, private/social, other). Rules (keywords, source segment, e.g. Ticketmaster "Miscellaneous" only) decide the obvious cases; anything unclear goes to the inbox for Claude to judge. Excluded events stay in the database (so they are not re-added) but are never exported.

**Date window:** only events overlapping 2026-11-15..2027-12-31 are active. Earlier ones are archived; later ones are kept as "future" but not exported until the window moves (configurable `WINDOW_START` / `WINDOW_END`).

**Sample data:** the 23 placeholder events are removed from the export once the database holds at least 100 real active events (configurable), or sooner when a real event matches one.

## 4. Signal strength

### 4.1 Levels

Each event shows 1, 2 or 3 bars, with a tooltip listing the evidence.

| Bars | Meaning |
|---|---|
| 3 | **Confirmed.** The organizer's own site (or an organizer-run ticketing page) states this edition's dates and city, or at least three independent sources agree. |
| 2 | **Likely.** The venue/convention-bureau calendar lists it, or two independent sources agree, but the organizer's site has not confirmed it. |
| 1 | **Unconfirmed.** One source, not the organizer's site. |

### 4.2 Points and independence

Every observation belongs to a source `family` (the real publisher; sites that copy each other share a family and count once). Points per **distinct family**, summed per event:

| Evidence (per family) | Points |
|---|---|
| Organizer's official site confirms this edition's dates and city (verified by us) | 3 |
| Organizer-run ticketing/registration listing (e.g. Ticketmaster, Eventbrite organizer page, Cvent) | 3 |
| Venue or convention-bureau official calendar | 2 |
| Curated directory (e.g. Confs.tech) | 1 |
| Aggregator / scraped list | 1 |

`bars = 3 if points >= 3, 2 if points == 2, else 1`.

Adjustments: **−1** if sources disagree on dates (the official source's dates win and the event is flagged); **−1** if nothing has confirmed it in 60 days; an event that the official site says is cancelled/postponed becomes `cancelled` and is hidden. Points never go below 1 for a visible event; bars cannot be 3 on the strength of unconfirmed-year pages (a page showing only last year's edition adds nothing).

The rules and the family table live in `pipeline/sources/credibility.yaml`, are unit-tested with the examples above, and every score stores its evidence list so the UI can explain it.

### 4.3 Web display

A small three-bar icon beside the Verified badge in the list, cards, drawer and map panel; filled bars = level; tooltip/drawer lists each evidence item ("Confirmed on official site, checked 3 days ago; listed by Las Vegas Convention Center"). A filter for "Confirmed only" and a sort option are included. The existing `Verified ≤30 days` and `Dates TBC` badges stay and are independent (freshness vs. credibility).

## 5. Operating model: update sessions (free, in-session)

1. User opens Claude Code in the project and says e.g. "update the database".
2. `npm run update` runs all deterministic sources (feeds, APIs including Ticketmaster, structured pages, headless-browser venue calendars), saves pages that need reading into `inbox/`, verifies due events on official sites, re-scores, and prints a summary.
3. Claude works the inbox: reads each saved page, writes `ingest/<name>.json` (candidates with source, evidence quote and a `kind`/exclude judgment), and runs `npm run ingest`, which validates every record (schema, date window, evidence text actually appears in the page, scope rules) before touching the database.
4. `npm run export` writes `events.json`; Claude reports counts, new/changed/removed events and anything needing a human decision.
5. A project `CLAUDE.md` documents this procedure and the rules, so any future session can run it without re-deriving anything. An automated, API-driven version later replaces step 3 with `extractWithLlm` (already written) and a scheduled runner.

## 6. Source expansion (waves)

Each wave: probe (robots.txt, terms, structure) → adapter → tests on saved fixtures → live run → results recorded in `docs/SOURCING.md`. Rejected sources are recorded with the reason.

- **Wave 0 (done):** Confs.tech, LA Convention Center cards.
- **Wave 1: headless-browser venue calendars:** Las Vegas (LVCVA 90-day calendar, venue sites), Orlando (OCCC), Chicago (McCormick Place), Austin, San Francisco (Moscone), plus further large venues (Anaheim is blocked by robots.txt and stays excluded). The browser loads the public page as a visitor would and reads the rendered calendar; if the page's own data request is clearly public, robots-allowed and within the site's terms, it may be read directly. No logins, no CAPTCHA or bot-protection workarounds, identified user agent, 1 request/second/host, cached.
- **Wave 2: Ticketmaster Discovery** (free key; "Miscellaneous"/convention-type classifications at convention venues; counts as an organizer-run ticketing family).
- **Wave 3: directories and aggregators** (Tradeshowz, ExpoAssist, Luminik, Metro Exhibits, Expomarketing, Showsbee, Neventum and similar): used to discover events and add corroboration; each is probed for robots/terms first and treated as one family per publisher.
- **Wave 4: organizer verification at scale:** for every discovered event find the organizer's own site (search + the aggregators' outbound links), verify dates/city, record the official URL and fill organizer/venue/attendance.
- **Other leads to probe:** industry associations' event pages, convention-bureau "meetings" calendars (Visit Las Vegas, Choose Chicago, Visit Orlando, etc.), Wikidata, PredictHQ free plan (limited to a few saved locations; evaluate), IAEE (blocked by robots, excluded).

## 7. Error handling and safety

- A source that fails or returns nothing is marked unhealthy and never causes deletion.
- Every ingest record is validated; invalid records are rejected with a reason in the run log.
- Evidence rule: an event Claude ingests must include a short verbatim quote from the page that contains its name and dates; the ingest step checks the quote occurs in the saved page text.
- Secrets (the Ticketmaster key) live in an untracked `.env`, never in the database, exports or logs.
- All fetching respects robots.txt, rate limits, size limits and private-address blocking (already built).

## 8. Testing

- Database layer: migrations, constraints, round-trip, idempotent re-ingest.
- Signal scoring: table-driven tests from section 4 (including the user's examples: three weak independent sources → 3 bars; one official source → 3 bars; two weak → 2; one weak → 1; copied listings count once; conflict and staleness penalties).
- Ingest validation: rejects out-of-window dates, missing evidence, unknown kinds, excluded categories.
- Export: schema-valid, sharding threshold, sample-data removal rule, stable ids.
- Adapters: fixture-based tests per source; one live smoke run per wave recorded in the docs.
- Web: signal bars component, tooltip, filter, sort.

## 9. Delivery

1. **Foundation:** SQLite layer, migration of current `events.json` data, observations/events model, signal scoring, export, web display of bars. `CLAUDE.md` update procedure.
2. **Browser fetcher and inbox/ingest workflow** (Playwright, saved page text, validated ingest).
3. **Waves 1-3**, each as its own small plan, with live runs and an update session to read the inbox.
4. **Wave 4** organizer verification and enrichment.
5. **Later:** API-driven automation (swap in the LLM client), GitHub scheduling, public deploy.

Out of scope for now: non-US events, accounts/login scraping, paid data providers, any scraping that needs bypassing a block.

## 10. Needs from the user

- The Ticketmaster developer key (when wave 2 starts) pasted into a `.env` file (I will show exactly how).
- Approval to run Playwright's one-time browser download (~150 MB).
- During update sessions: patience for the first large reading pass (hundreds of pages); I will work the inbox in batches and report progress.
