# Coverage: platform-family detection, a generic `cards` adapter, and `npm run probe`

Date: 2026-11-16. Status: draft for review. Sub-project C of the scale roadmap (A dedupe → B public → **C coverage** → D volume → E sharing).

## Goal

Adding a city must cost minutes, not an adapter. Today each venue calendar is a hand-written reader (`simpleview`, `datatable`, `moscone`, `loadmore`, ...) and nine sources took three waves of work. The target: `npm run probe -- <url>` tells us in one command whether a site is allowed, what kind of calendar it is, how many events it yields, and emits the registry entry; most US convention centers then get covered by running the probe over a list.

Non-goals: bypassing any block (robots, CAPTCHAs, bot walls stay rejected and recorded); aggregator discovery; changes to scoring; UI changes.

## How sites break down (from the nine we have)

| Family | Fingerprint in the DOM | Existing reader |
|---|---|---|
| schema.org Event JSON-LD | `<script type="application/ld+json">` with `@type: Event` | `parseJsonLd` (kind `page`) |
| iCal feed | `link[type="text/calendar"]`, `a[href$=".ics"]`, `?ical=1` | `parseIcs` (kind `ical`) |
| Convention-center cards | `.eventItem` + `.date` + `h3.title a` | `parseEventItems` (kinds `page`, `loadmore`) |
| Simpleview convention calendar | `article.convention-item` + `.filter.date_end` | `simpleview` |
| Simpleview list with range picker | `.item.isEvent` + `td[data-date]` | `simpleview-range` |
| DataTables list | `table.dataTable` / `.dataTables_wrapper` | `datatable` |
| One-off (Moscone) | host-specific | `moscone` |
| Anything else with repeated dated cards | repeated siblings each holding a date range and a link | **new: `cards`** |
| Nothing recognizable | — | `page` LLM extraction (capped), or in-session capture/ingest |

Three of the eight families already share one parser; the gap is (1) nobody detects which family a new URL is, and (2) sites with their own card markup need a parser per site. `cards` closes (2) for the common case; `probe` closes (1).

## Components

### 1. `src/sources/detect.ts` — pure detection

`detectCalendar(html: string, url: string): Detection[]`, sorted best first.

```ts
interface Detection { kind: RegistryEntry['kind'] | 'cards' | 'none'; count: number; evidence: string; cards?: CardsConfig; needsBrowser: boolean }
```

- Runs every fingerprint above against the HTML with cheerio and counts the events each would yield (it calls the existing parsers with a dummy `SourceRef`, so the count is the real count).
- `needsBrowser` is true for the JavaScript families (`simpleview`, `simpleview-range`, `datatable`, `loadmore`) and when the static HTML has the fingerprint but 0 items (the list is filled by script).
- `cards` detection: find the smallest repeated element (≥ 3 siblings with the same tag+class) where each sibling contains a `parseDateRangeText`-parsable string **or** a `<time datetime>` and at least one `<a href>`. Derive `CardsConfig { item, title, date, link?, time_attr? }` as CSS selectors (class-based, no nth-child), returning the config that parses the most siblings. No LLM involved.

### 2. `src/sources/cards.ts` — generic card adapter (new registry kind `cards`)

Registry entry: `{ kind: cards, url, item: ".event-card", title: ".event-card__title", date: ".event-card__date", link?: "a", render?: true, scrolls?: n, max_pages?: n, next?: "a.next" }`.

`parseCards(html, cfg, source, defaults)`: for each `item`, name = `title` text, dates = `parseDateRangeText(date text)` or the `datetime` attribute of `<time>` inside `date` (start and optional end), link = first `a[href]` in `link ?? item`, resolved against the page URL. Reuses `toCandidateClean`. `render: true` fetches through the browser (`render` with `scrolls`); `next` pages through with `collectPaged` (already in `simpleview.ts`; moved to a shared module). Same health rules as other readers: `fetch failed`, `no events found`, `partial: n of m`.

### 3. `src/tools/probe.ts` — `npm run probe -- <url> [--city C --state ST --venue V] [--add] [--list file]`

1. `canFetch(url)` (robots + public address). Disallowed → report `blocked: robots.txt` and stop. Any HTTP 403/429/challenge page → `blocked: bot protection`; never retried in the same run.
2. Static fetch → `detectCalendar`. If the best detection has `count >= 3` and `!needsBrowser`, done.
3. Otherwise, if a browser is available: render (`scrolls: 3`, networkidle) → `detectCalendar` again on the rendered DOM.
4. Dry run of the chosen reader for at most 2 pages → sample of up to 5 candidates (name, dates, url) so a human can eyeball them. Candidates outside the window or without dates are counted as rejected.
5. Output: a readable report, the JSON written to `pipeline/out/probes/<host>.json`, and the suggested YAML entry (`id` = host without `www.`/TLD, `venue`/`city`/`state` from flags, `kind`, selectors, `render`). With `--add`, the entry is appended to `registry.yaml` only when `count >= 3` and the id is new.
6. `--list file`: one URL per line (`# comments`, optional `| city | state | venue` columns); probes each, prints a table (url, verdict, kind, count), writes all reports. Rate limiting is per host already.

The probe never writes to the database and never commits.

### 4. Seed list `pipeline/sources/venue-candidates.txt`

About 40 US convention centers and bureau calendars (Houston GRB, Denver CCC, Washington DC Walter E. Washington, San Diego CC, Nashville Music City Center, Boston BCEC/Hynes, Atlanta GWCC, Phoenix CC, Seattle Summit, New Orleans Ernest N. Morial, Indianapolis ICC, Philadelphia PCC, Salt Palace, Kansas City Bartle Hall, Minneapolis CC, Charlotte CC, San Antonio Henry B. González, Austin CC, Detroit Huntington Place, Miami Beach CC, Fort Lauderdale/Broward, Tampa CC, Columbus GCCC, Cleveland Huntington CC, Pittsburgh DLCC, Baltimore CC, Louisville KICC, Cincinnati Duke Energy CC, Milwaukee Baird Center, St. Louis America's Center, Oklahoma City CC, Raleigh CC, Portland OCC, Sacramento SAFE Credit Union CC, San Jose McEnery, Long Beach CC, Reno-Sparks CC, Albuquerque CC, Omaha CHI Health Center, Honolulu HCC). URLs are looked up and verified by the probe, not guessed into the registry. Known rejects (Anaheim, IAEE, Javits, Tradeshowz) are listed as `# rejected` so they are not re-probed.

### 5. Wiring

- `registry.ts`: add `cards` to the kind enum and the `item/title/date/link/render/scrolls/next` fields (zod); `runEntry` dispatches to `cards.ts`. `update.ts` creates the browser when any entry has `render: true`.
- `collectPaged` moves from `simpleview.ts` to `src/sources/paging.ts` (import updated; no behavior change).
- `package.json`: `"probe": "tsx src/tools/probe.ts"`.
- `docs/SOURCING.md` gets a "Probe results (2026-11-xx)" table from the `--list` run; rejects stay documented with the reason.

## Testing (TDD, vitest)

- `detect.test.ts`: fixture HTML per family (reuse `test/fixtures` where present; add minimal ones) → expected kind, count, `needsBrowser`; a cards fixture with three different markups → derived selectors; a page with no dated repeats → `none`.
- `cards.test.ts`: text date ranges, `<time datetime>` ranges, relative links, exclude patterns, `next` paging via the injected browser stub used by the simpleview tests.
- `probe.test.ts`: injected `fetchText`/`canFetch`/`browser` stubs: robots-blocked → `blocked`, static JSON-LD → no browser call, script-filled list → browser used, `--add` appends a valid entry once and refuses a duplicate id, `--list` table.
- `registry.test.ts`: a `cards` entry parses and runs.

## Rollout

1. Build detect → cards → probe with tests; run the probe over the current nine sources as a regression check (each must detect its own family with a count ≥ the current source count minus a tolerance).
2. Probe the seed list; add every site with `count >= 3`; record every reject in SOURCING.md with its reason.
3. `npm run update -- --tier weekly` locally (after `git pull`), review quarantine and topics, commit, push; CI deploys.
4. Report counts by city and bars; events that need topic judgment go through `npm run topics` as before.

## Risks and limits

- Card detection chooses by count, so a page with many dated *news* items could win over a smaller events list; the probe's sample output is the check, and `--add` is never automatic in `--list` mode.
- Sites that render dates without a year (Simpleview style) are handled by the family readers, not by `cards`; a `cards` site without years is reported as `needs reader`.
- Browser-rendered sources cost ~5-20 s each; at 40 sources the weekly run stays under the 60-minute CI timeout, which the run report will confirm.
