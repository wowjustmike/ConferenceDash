# Database, Signal Strength and Export: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the event data into a local SQLite database that records every sighting of an event, score each event's credibility as 1-3 signal bars with its evidence, export it to `events.json`, and show the bars in the web app.

**Architecture:** `pipeline/src/db/` wraps Node's built-in `node:sqlite` (schema v1, repositories). Existing pipeline stages keep their safe-merge logic: events are loaded from the DB, merged with `mergeIntoExisting`, and saved back, while every candidate and verification is appended as an observation. A pure `scoreSignal` function turns observations into bars. An exporter writes the web's `events.json` (sharded only above 5 MB). The web app gets an optional `signal` and `kind` per event and a `SignalBars` component.

**Tech Stack:** Node 24 `node:sqlite`, TypeScript, Vitest, `yaml`, React (web).

**Spec:** `docs/superpowers/specs/2026-11-15-database-and-signal-design.md` (sections 2-4, 8, 9 step 1). Parent spec: `2026-11-15-conferencedash-design.md`.

## Global Constraints

- Database file: `data/conferencedash.db` (git-ignored). Export: `data/events.json` (committed). Web contract: `ConfEvent` in `web/src/lib/schema.ts` plus optional `signal` and `kind`.
- Date window: active events overlap `WINDOW_START=2026-11-15` .. `WINDOW_END=2027-12-31` (env-overridable).
- Signal: bars = 3 if points >= 3, 2 if points == 2, else 1. Points are summed per **distinct source family**: organizer official site confirming this edition 3; organizer-run ticketing listing 3; venue/convention-bureau calendar 2; curated directory 1; aggregator/scraped list 1. Penalties: -1 for conflicting dates, -1 if unconfirmed for more than 60 days; floor 1 for any visible event; a page that only shows another year's edition adds 0; cancelled events are hidden.
- Sample (`seed`) observations earn 0 points. Sample events are dropped from the export once at least 100 real active events exist (`SAMPLE_DROP_THRESHOLD`), or when a real event matches one.
- Excluded events (concert, sports, festival, faire, private/social) stay in the DB with a reason and are never exported.
- No change may delete events on an empty or failed fetch; ids never change; confirmed dates never revert (existing `mergeIntoExisting` rules).
- All DB writes for one run happen in a single transaction; the export is atomic (temp file + rename) and validated.
- Secrets never enter the DB, export or logs.

## Review Focus

1. Listings copied across aggregators must count as one family; three genuinely independent weak sources must reach 3 bars.
2. An official page that only shows last year's edition must add no points and must not confirm the new edition.
3. Running import/update twice must not duplicate observations or events (idempotent).
4. A failure mid-run must leave the database consistent (transaction rollback) and never write a partial `events.json`.
5. Excluded and out-of-window events must never reach the export; the sample-removal rule must not leave a half-empty app when real data is thin.
6. A sharded export must contain every event exactly once, and the web loader must handle both single-file and sharded forms.

---

## File Structure

```
pipeline/src/db/schema.ts        SQL for schema v1 + migrate()
pipeline/src/db/db.ts            openDb(path), withTransaction(db, fn)
pipeline/src/db/store.ts         repositories: sources, fetches, observations, events, inbox, runs
pipeline/src/credibility.ts      loadCredibility(), familyOf(), scoreSignal()
pipeline/sources/credibility.yaml  kinds -> points, family groups
pipeline/src/classify.ts         classifyKind(), inWindow()
pipeline/src/importer.ts         importEventsJson(db, events)
pipeline/src/exporter.ts         buildExport(), planShards(), writeExport()
pipeline/src/update.ts           CLI glue: run pipeline against the DB, then export
pipeline/test/**                 tests per module
web/src/lib/schema.ts            + signal, kind (optional)
web/src/lib/signal.ts            bars helpers
web/src/components/SignalBars.tsx
CLAUDE.md                        update-session procedure
```

---

### Task 1: Database layer and schema

**Files:** Create `src/db/schema.ts`, `src/db/db.ts`; test `test/db/db.test.ts`.

**Interfaces:** Produces
```ts
function openDb(path: string): DatabaseSync          // creates dirs, enables foreign_keys + WAL, runs migrate()
function migrate(db: DatabaseSync): void             // idempotent; sets PRAGMA user_version = 1
function withTransaction<T>(db: DatabaseSync, fn: () => T): T   // BEGIN/COMMIT, ROLLBACK + rethrow on error
```
Tables (columns per spec section 3): `sources(id TEXT PK, kind, family, credibility, robots_ok, notes, last_health)`, `fetches(id INTEGER PK, url, host, status, fetched_at, etag, content_hash, bytes)`, `observations(id INTEGER PK, source_id FK, fetch_id FK NULL, raw_name, start_date, end_date, city, state, venue, organizer, url, evidence_kind, confirms_edition INT, seen_at, extractor, UNIQUE(source_id, raw_name, start_date, city, url))`, `events(id TEXT PK, name, start_date, end_date, dates_confirmed INT, city, state, venue, organizer, topics_json, kind, est_attendance, official_url, status, last_verified, confidence REAL, signal_points INT, signal_bars INT, signal_json, excluded_reason, is_sample INT)`, `event_observations(event_id FK, observation_id FK, decided_by, PRIMARY KEY(event_id, observation_id))`, `inbox(id INTEGER PK, url, source_id, path, status, notes, created_at)`, `runs(id INTEGER PK, started_at, finished_at, report_json)`.

- [ ] **Step 1:** Tests: `openDb(':memory:')` has all 7 tables and `user_version === 1`; calling `migrate` twice changes nothing; inserting an observation with an unknown `source_id` throws (foreign keys on); the observations UNIQUE constraint rejects an exact duplicate; `withTransaction` rolls back both inserts when the second throws and rethrows; nested use does not leave an open transaction.
- [ ] **Step 2:** Run `npx vitest run test/db` in `pipeline/`; expect FAIL. Implement; expect PASS. Commit `feat: sqlite database layer`.

### Task 2: Credibility rules and signal scoring

**Files:** Create `sources/credibility.yaml`, `src/credibility.ts`; test `test/credibility.test.ts`.

**Interfaces:** Produces
```ts
type EvidenceKind = 'official-site' | 'ticketing' | 'venue-calendar' | 'directory' | 'aggregator' | 'seed'
interface Evidence { family: string; kind: EvidenceKind; confirmsEdition: boolean; seenAt: string; label: string }
interface Signal { points: number; bars: 1 | 2 | 3; evidence: { label: string; family: string; kind: EvidenceKind; points: number; seenAt: string }[]; flags: ('conflicting-dates' | 'stale')[] }
function loadCredibility(path?: string): Credibility          // validates yaml: points per kind, family groups
function familyOf(host: string, c: Credibility): string      // maps hosts to a family (copy-sites share one)
function scoreSignal(ev: Evidence[], opts: { conflictingDates: boolean; today: Date; c?: Credibility }): Signal
```
Per distinct family, take the best-scoring evidence; `official-site` and `ticketing` only count when `confirmsEdition` is true (otherwise 0); `seed` is 0. Staleness: newest `confirmsEdition` evidence older than 60 days (or none) applies -1.

- [ ] **Step 1:** Table-driven tests, each asserting `bars` and `points`: one aggregator -> 1/1; two aggregators from different families -> 2 bars; **three aggregators from different families -> 3 bars**; three aggregators sharing one family (copy sites) -> 1; official site confirming edition -> 3 bars alone; official site with `confirmsEdition:false` (last year's page) -> 0 pts, bars 1; ticketing confirmed -> 3; venue calendar alone -> 2; venue + directory -> 3; conflicting dates on a 3-point event -> 2 bars with flag; stale (100 days) official -> 2 bars with flag; seed only -> 1 bar, 0 points; empty evidence -> bars 1. The evidence list in the result names each family's points.
- [ ] **Step 2:** Run, FAIL; implement; PASS. Commit `feat: signal scoring`.

### Task 3: Repositories

**Files:** Create `src/db/store.ts`; test `test/db/store.test.ts`.

**Interfaces:** Consumes `openDb`, `withTransaction`, `Evidence`. Produces
```ts
function upsertSource(db, s: { id: string; kind: string; family: string; credibility: number; notes?: string }): void
function recordFetch(db, f: { url: string; status: number | null; etag?: string; contentHash?: string; bytes?: number }): number   // returns fetch id; host derived from url
function addObservation(db, o: ObservationInput): { id: number; inserted: boolean }   // idempotent on the UNIQUE key; refreshes seen_at when it already exists
function loadEvents(db): ConfEvent[]                    // all non-excluded events as ConfEvent (+ signal, kind)
function saveEvents(db, events: ConfEvent[], meta?: Record<string, { kind?: string; isSample?: boolean }>): void  // upsert by id, one transaction
function linkObservation(db, eventId: string, observationId: number, decidedBy: 'rule' | 'claude'): void
function evidenceFor(db, eventId: string): Evidence[]
function markExcluded(db, eventId: string, reason: string): void
```

- [ ] **Step 1:** Tests: `addObservation` twice with identical data returns `inserted:false` the second time and leaves one row; `saveEvents` then `loadEvents` round-trips every `ConfEvent` field (topics array, null attendance, sources array); `saveEvents` twice leaves the same row count; `markExcluded` removes the event from `loadEvents` but keeps the row; `evidenceFor` returns the evidence of linked observations only; a thrown error inside `saveEvents` rolls everything back (e.g. invalid status).
- [ ] **Step 2:** Run, FAIL; implement; PASS. Commit.

### Task 4: Classification and date window

**Files:** Create `src/classify.ts`; test `test/classify.test.ts`.

**Interfaces:** Produces
```ts
type Kind = 'conference' | 'trade_show' | 'expo' | 'convention' | 'fan_con'
type Classification = { kind: Kind } | { excluded: string } | { unknown: true }
function classifyKind(name: string, hint?: string): Classification
function inWindow(ev: { start_date: string; end_date: string }, w: { start: string; end: string }): boolean
```
Exclusion reasons: `concert`, `sports`, `festival`, `faire`, `social`. Keyword rules are conservative; anything not matched either way is `{ unknown: true }` (goes to the inbox later).

- [ ] **Step 1:** Tests: "Renaissance Faire" -> excluded `faire`; "Coachella Music Festival" -> `festival`; "NFL Draft" or "Championship Game" -> `sports`; "Holiday Party"/"Wedding Expo" mix: "Holiday Party" -> `social`; "San Diego Comic-Con" -> `fan_con`; "CES 2027" with hint "trade show" -> `trade_show`; "NAB Show" -> `trade_show`; "Black Hat USA" -> `conference`; "Springfield Gathering" -> unknown; "Comic Con Rock Festival" -> excluded (festival wins only when no convention keyword... decide: festival keyword with music) -- assert whichever rule you choose and document it in the test name. `inWindow`: event spanning the window start is in; ended before start is out; starting after end is out; boundaries inclusive.
- [ ] **Step 2:** Run, FAIL; implement; PASS. Commit.

### Task 5: Import current data into the database

**Files:** Create `src/importer.ts`; test `test/importer.test.ts`.

**Interfaces:** Consumes `store`, `familyOf`. Produces `importEventsJson(db, events: ConfEvent[]): { events: number; observations: number }`. Each `ConfEvent.sources[i]` becomes an observation: `type confs.tech` -> kind `directory`, family `confs.tech`; `html`/`jsonld` from a venue host -> `venue-calendar`; `ical` -> `venue-calendar`; `api` -> `ticketing`; `aggregator` -> `aggregator`; `llm` -> by registry entry, default `aggregator`; `seed` -> `seed` (sets `is_sample`). Events whose official URL was verified (`dates_confirmed && last_verified`) also get an `official-site` observation with `confirmsEdition: true`.

- [ ] **Step 1:** Tests using a small fixture of 4 events (seed, confs.tech, venue html, verified official): counts of events and observations; sample flag set only on seed-only events; running the import twice leaves identical counts (idempotent); a verified event gets an official-site observation.
- [ ] **Step 2:** Run, FAIL; implement; PASS. Commit.

### Task 6: Pipeline writes to the database

**Files:** Modify `src/run.ts`; test `test/run.db.test.ts`.

**Interfaces:** `RunDeps` gains `db: DatabaseSync`. `runPipeline` (a) seeds the DB from `existing` events on first use, (b) appends every candidate as an observation and every reachable verification as an `official-site` observation (`confirmsEdition = datesConfirmed && editionYearSeen`), (c) loads existing events from the DB, applies `mergeIntoExisting` exactly as today, saves the result in one `withTransaction`, (d) records a `runs` row. `writeEvents` is removed from `RunDeps`; export is a separate step (Task 7). Classification: candidates classified `excluded` are recorded as observations, marked excluded, and not merged; `unknown` ones are merged but flagged `kind: null` (later plans route them to the inbox).

- [ ] **Step 1:** Tests with the fake deps from `run.test.ts` plus an in-memory DB: after one run the DB has the expected events and observations; **a second identical run adds no new observations and no new events**; an excluded candidate ("Summer Music Festival") never appears in `loadEvents`; a thrown error in the save step leaves the DB as it was (rollback) and `runs` records the failure; all-sources-failed leaves events untouched.
- [ ] **Step 2:** Run, FAIL; implement (reuse existing merge safeguards); PASS; update `run.test.ts` for the changed deps. Commit.

### Task 7: Signal in the pipeline and the exporter

**Files:** Create `src/exporter.ts`; modify `src/db/store.ts` (persist `signal_*`); test `test/exporter.test.ts`.

**Interfaces:** Produces
```ts
function recomputeSignals(db, today: Date): number     // recalculates signal for every event from evidenceFor + conflicting-dates flag; returns events updated
function buildExport(db, opts: { windowStart: string; windowEnd: string; sampleDropThreshold: number; today: Date }): ExportEvent[]   // ConfEvent + { signal, kind }
function planShards(events: ExportEvent[], maxBytes: number): { single: ExportEvent[] } | { shards: Map<string, ExportEvent[]>; index: { months: string[]; counts: Record<string, number> } }
function writeExport(dir: string, plan): void          // data/events.json (single) or data/events/index.json + data/events/YYYY-MM.json; atomic, schema-validated
```
`buildExport` excludes: excluded events, status `cancelled`/`past`, events outside the window, and sample events once `realActive >= sampleDropThreshold` (or when matched by a real event). Shards are keyed by the event's start month.

- [ ] **Step 1:** Tests: `recomputeSignals` gives 3 bars to an event with a confirmed official observation and 1 bar to a single-aggregator event; an event with last year's-edition official evidence stays 1 bar; `buildExport` drops excluded, cancelled, past and out-of-window events; sample events remain below the threshold and vanish at it; `planShards` returns `single` under the limit and shards over it, with **every event in exactly one shard** and counts summing to the total; `writeExport` leaves the previous file untouched when validation fails and writes valid JSON atomically otherwise.
- [ ] **Step 2:** Run, FAIL; implement; PASS. Commit.

### Task 8: Update and export commands

**Files:** Create `src/update.ts`; modify `package.json` scripts; test `test/update.test.ts`.

**Interfaces:** `npm run update -- --tier weekly [--dry-run]` opens `data/conferencedash.db`, imports `data/events.json` if the DB is empty (first run), runs `runPipeline`, `recomputeSignals`, then `buildExport` + `writeExport` (skipped on `--dry-run`), and prints a summary (new, changed, by bars, quarantined). `npm run export` runs only recompute + export. Missing/invalid `.env` values never printed.

- [ ] **Step 1:** Test `runUpdate({ dbPath: ':memory:', ... })` with fake deps end to end: first run imports the seed, publishes, exports, summary counts by bars correct; a second run changes nothing in the export (byte-identical); `--dry-run` writes no export; export failure keeps the old `events.json`.
- [ ] **Step 2:** Run, FAIL; implement; PASS. Commit.

### Task 9: Web: schema, SignalBars, filter and sort

**Files:** Modify `web/src/lib/schema.ts`, `filters.ts`, `url.ts`, `components/ResultsList.tsx`, `ResultCards.tsx`, `EventDrawer.tsx`, `MapView.tsx`, `FilterSidebar.tsx`, `styles.css`; create `web/src/lib/signal.ts`, `web/src/components/SignalBars.tsx`; tests alongside.

**Interfaces:** `EventSchema` gains optional `signal: { points: number; bars: 1|2|3; evidence: {label: string; family: string; kind: string; points: number; seenAt: string}[]; flags: string[] }` and `kind`. Produces `<SignalBars bars evidence? size? />` (an `svg` with `role="img"` and `aria-label="Signal strength N of 3"`, plus a `title` tooltip listing the evidence) and `signalFor(ev): { bars: 1|2|3; evidence: ... }` (defaults to 1 bar, no evidence when `signal` is absent). `Filters` gains `minSignal: 1|2|3` (URL `signal=3`); `SortBy` gains `'signal'`.

- [ ] **Step 1:** Tests: events without `signal` still parse and render 1 bar (backward compatible); `SignalBars` has the right accessible label for 1/2/3 and fills the right number of bars; list rows, cards and the drawer show the bars, and the drawer lists each evidence item with its points; the filter "Confirmed only" keeps only 3-bar events and round-trips through the URL; sorting by signal puts 3-bar events first with date as tiebreak; invalid `signal` data (bars 7) causes only that event to be skipped (existing per-item behavior); **`useEvents`/`defaultLoad` handles the sharded form**: when `events.json` is a manifest `{ shards: string[] }` it fetches each listed shard and concatenates them, and a failed shard shows the existing error state (no partial list).
- [ ] **Step 2:** Run `npx vitest run` in `web/`; expect FAIL. Implement; expect PASS; `npm run build` passes. Commit.

### Task 10: Migrate for real, document, verify

**Files:** Create `CLAUDE.md`; modify `README.md`, `.gitignore` (`data/*.db`, `data/*.db-*`, `.env`).

- [ ] **Step 1:** Write `CLAUDE.md`: the update-session procedure (run `npm run update -- --tier weekly`, review summary, export, report), the rules (scope, evidence, politeness, no deleting on empty fetch), where things live, and a note that inbox/ingest arrive in the next plan.
- [ ] **Step 2:** Run `npm run update -- --tier weekly --dry-run` in `pipeline/` against the live sources, then without `--dry-run`; expected: `data/conferencedash.db` created, `data/events.json` rewritten with `signal` and `kind` on every event, at least the 15 real events present, summary printed. Spot-check three events' evidence by hand against their sources.
- [ ] **Step 3:** Start the web app, confirm the bars show in list, drawer and map panel, the "Confirmed only" filter works, and mobile renders; fix visual issues.
- [ ] **Step 4:** Run both test suites and both builds; commit `docs: update-session procedure and foundation verification`.

---

## Self-review notes

- **Spec coverage:** database and schema (T1, T3), signal rules and examples (T2, T7), classification and window (T4, T7), migration of current data (T5), operating model commands (T8, T10 `CLAUDE.md`), export and sharding (T7), web display, filter, sort (T9). Browser fetcher, inbox/ingest and source waves are the next plans.
- **Review Focus coverage:** 1 and 2 (T2, T7), 3 (T3, T5, T6, T8), 4 (T1, T6, T7, T8), 5 (T4, T7), 6 (T7 for the exporter; T9 for the web loader, which reads a `{ shards: [...] }` manifest in `events.json`; the exporter writes that manifest when sharding).
- **Type consistency:** `Evidence`, `Signal`, `EvidenceKind`, `Kind`, `Classification`, `ExportEvent` defined once and reused.
