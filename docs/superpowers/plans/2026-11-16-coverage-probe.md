# Coverage: detect, `cards` adapter, `probe` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run probe -- <url>` classifies any venue-calendar URL into a known reader family (or a derived generic `cards` config), dry-runs it, and emits the registry entry, so adding a city is one command plus a review.

**Architecture:** A pure `detectCalendar(html, url)` scores every family fingerprint by calling the existing parsers; a new `cards` reader parses any page of repeated dated cards from CSS selectors; `probe` orchestrates robots → static fetch → detect → (browser render → detect) → dry run → report/YAML. `collectPaged` moves to a shared paging module so `cards` can page like Simpleview does.

**Tech Stack:** Node 24 / TypeScript / tsx, cheerio, playwright-core (Chrome channel), zod, yaml, vitest. All in `pipeline/`.

**Spec:** `docs/superpowers/specs/2026-11-16-coverage-probe-design.md`

## Global Constraints

- Robots and blocks are never bypassed; `canFetch` gates every network call; 1 request/second/host via the existing fetchers; user agent `ConferenceDashBot/1.0`.
- The probe never writes the database and never commits.
- `--add` appends only when `count >= 3` and the derived id is not already in `registry.yaml`.
- Card selectors are class-based only (no `nth-child`, no ids).
- `cards` requires a year in the date text or a `datetime` attribute; otherwise the probe reports `needs reader`.
- Run `npx vitest run` in `pipeline/` before every commit; all 295+ existing tests stay green.
- Commits: conventional prefix, end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A page whose largest repeated dated block is a news list, not events → `cards` picks it; the probe's sample must make this visible (names + dates printed) and `--list` never auto-adds. Test in Task 1: two repeated groups, the larger one without links → the linked group wins.
2. Dates like `Nov 20 - 29` with no year → `cards` must not invent a year. Test in Task 2: card without a year yields no candidate and `parseCards` reports `missingYear` count.
3. A site that returns HTTP 403/429 or a challenge page → verdict `blocked: bot protection`, no retry, no browser attempt. Test in Task 3.
4. Relative and protocol-relative hrefs (`/events/x`, `//cdn.x/y`) → resolved against the final URL; `javascript:` and `mailto:` dropped. Test in Task 2.
5. The nine existing sources must still detect as their own family (regression). Test in Task 1 using the existing fixtures.

---

### Task 1: `detectCalendar` (pure detection)

**Files:**
- Create: `pipeline/src/sources/detect.ts`
- Create: `pipeline/test/sources/detect.test.ts`
- Create: `pipeline/test/fixtures/cards-time.html`, `pipeline/test/fixtures/cards-text.html`, `pipeline/test/fixtures/news-vs-events.html`
- Reuse fixtures: `event-jsonld.html`, `eventitems.html`, `dallas-items.html`, `simpleview-items.html`, `occc-items.html`, `datatable-rows.html`

**Interfaces:**
- Consumes: `parseJsonLd(html, source)`, `parseEventItems(html, source, defaults)`, `parseDateRangeText(text)`, `normalizeDate(s)`.
- Produces:
  ```ts
  export type DetectedKind = 'page' | 'ical' | 'loadmore' | 'simpleview' | 'simpleview-range' | 'datatable' | 'cards' | 'none'
  export interface CardsConfig { item: string; title: string; date: string; link?: string }
  export interface Detection { kind: DetectedKind; count: number; evidence: string; needsBrowser: boolean; cards?: CardsConfig; icalUrl?: string }
  export function detectCalendar(html: string, url: string): Detection[]   // best first; last element is always kind 'none' only when nothing else matched
  export function deriveCards(html: string): { config: CardsConfig; count: number; missingYear: number } | null
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/sources/detect.test.ts
const fx = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8')
test('JSON-LD page -> page, count = events, no browser', () => {
  const [d] = detectCalendar(fx('event-jsonld.html'), 'https://x.example/events')
  expect(d).toMatchObject({ kind: 'page', needsBrowser: false }); expect(d.count).toBeGreaterThan(0)
})
test('iCal link -> ical with the resolved feed URL', () => {
  const html = '<html><head><link rel="alternate" type="text/calendar" href="/feed.ics"></head><body></body></html>'
  expect(detectCalendar(html, 'https://x.example/events')[0]).toMatchObject({ kind: 'ical', icalUrl: 'https://x.example/feed.ics', needsBrowser: false })
})
test('eventItem cards with a Load More control -> loadmore (browser); without it -> page', () => {
  expect(detectCalendar(fx('dallas-items.html') + '<button>Load More Events</button>', 'https://x.example/')[0]).toMatchObject({ kind: 'loadmore', needsBrowser: true })
  expect(detectCalendar(fx('eventitems.html'), 'https://x.example/')[0]).toMatchObject({ kind: 'page', needsBrowser: false })
})
test('Simpleview convention calendar and range list are told apart and need the browser', () => {
  expect(detectCalendar(fx('simpleview-items.html') + '<div class="filter date_end"></div>', 'https://x.example/')[0]).toMatchObject({ kind: 'simpleview', needsBrowser: true })
  expect(detectCalendar(fx('occc-items.html') + '<td data-date="2026-12-01"></td>', 'https://x.example/')[0]).toMatchObject({ kind: 'simpleview-range', needsBrowser: true })
})
test('DataTables list -> datatable (browser)', () => {
  expect(detectCalendar(`<table class="dataTable">${fx('datatable-rows.html')}</table>`, 'https://x.example/')[0]).toMatchObject({ kind: 'datatable', needsBrowser: true })
})
test('generic cards with <time datetime> -> cards with derived class selectors', () => {
  const [d] = detectCalendar(fx('cards-time.html'), 'https://x.example/')
  expect(d.kind).toBe('cards'); expect(d.count).toBe(4)
  expect(d.cards).toEqual({ item: '.ev-card', title: '.ev-card__title', date: '.ev-card__when', link: 'a' })
  expect(d.cards!.item).not.toMatch(/nth-child|#/)
})
test('generic cards with text date ranges -> cards; a fingerprint with 0 items marks needsBrowser', () => {
  expect(detectCalendar(fx('cards-text.html'), 'https://x.example/')[0]).toMatchObject({ kind: 'cards', count: 3 })
  expect(detectCalendar('<div class="dataTables_wrapper"><table class="dataTable"></table></div>', 'https://x.example/')[0]).toMatchObject({ kind: 'datatable', count: 0, needsBrowser: true })
})
test('a bigger repeated group without links loses to a smaller linked group', () => {
  const [d] = detectCalendar(fx('news-vs-events.html'), 'https://x.example/')
  expect(d.kind).toBe('cards'); expect(d.cards!.item).toBe('.event')
})
test('nothing recognizable -> none', () => {
  expect(detectCalendar('<html><body><p>Hello</p></body></html>', 'https://x.example/')).toEqual([{ kind: 'none', count: 0, evidence: 'no calendar markup found', needsBrowser: true }])
})
```

Fixtures: `cards-time.html` = 4 `<article class="ev-card">` each with `<h3 class="ev-card__title"><a href="/e/n">Name n</a></h3><p class="ev-card__when"><time datetime="2027-03-0n">…</time> – <time datetime="2027-03-0(n+1)">…</time></p>`; `cards-text.html` = 3 `<li class="listing">` with `<span class="listing-title">` and `<span class="listing-date">Mar 3 - 5, 2027</span>` and a link; `news-vs-events.html` = 6 `<div class="news">` with `<span class="date">Jan 5, 2027</span>` and no link plus 3 `<div class="event">` with a date and `<a href>`.

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && npx vitest run test/sources/detect.test.ts`
Expected: FAIL — `Cannot find module '../../src/sources/detect'`

- [ ] **Step 3: Implement `detect.ts`**

`detectCalendar`: build a `SourceRef` stub `{ url, type: 'html', fetched_at: '' }`; compute one `Detection` per family in this order and sort by `count` desc with ties broken by that order: `page` (JSON-LD count via `parseJsonLd`), `ical` (`icalLink` logic copied from `registry.ts` — export it from `detect.ts` and have `registry.ts` import it), `loadmore` (`.eventItem` count when the body text matches `/load more/i`), `page` for `.eventItem` otherwise (count via `parseEventItems`), `simpleview` (`article.convention-item` count; fingerprint also `.filter.date_end`), `simpleview-range` (`.item.isEvent` count; fingerprint `td[data-date]`), `datatable` (`table.dataTable, .dataTables_wrapper`: count `tbody tr`), `cards` via `deriveCards`. Drop families whose fingerprint is absent; `needsBrowser` is `true` for the four JS families and for any family whose fingerprint is present with `count === 0`. Evidence strings: `"<n> schema.org Event entries"`, `"iCal link <url>"`, `"<n> .eventItem cards"`, `"<n> article.convention-item"`, `"<n> .item.isEvent"`, `"<n> table rows"`, `"<n> repeated <selector> cards"`.

`deriveCards`: group elements by `tag + sorted class list` (only elements with ≥ 1 class); keep groups with ≥ 3 members; for each member look for a date: first `time[datetime]` (start) and optional second (end), else the first descendant whose own text matches `parseDateRangeText`; a title: the first `h1–h4` or the first element whose class matches `/title|name|heading/i`, else the first `a`; a link: first `a[href]`. Score = members with (date ∧ title ∧ link). Choose the highest score; ties → fewer members. Selector for each role = `.` + the class list of that descendant (for `item`, the group's class list); `link` is `'a'`. `missingYear` = members whose date text parsed as a range without a four-digit year.

- [ ] **Step 4: Run to verify pass**

Run: `cd pipeline && npx vitest run test/sources/detect.test.ts test/sources/registry.test.ts`
Expected: PASS (registry tests still green after the `icalLink` move)

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/sources/detect.ts pipeline/src/sources/registry.ts pipeline/test/sources/detect.test.ts pipeline/test/fixtures/cards-*.html pipeline/test/fixtures/news-vs-events.html
git commit -m "feat(sources): detectCalendar classifies a page into a reader family or a derived cards config"
```

---

### Task 2: `cards` reader and shared paging

**Files:**
- Create: `pipeline/src/sources/cards.ts`
- Create: `pipeline/src/sources/paging.ts` (move `collectPaged` out of `simpleview.ts`, unchanged)
- Modify: `pipeline/src/sources/simpleview.ts` (import `collectPaged` from `./paging`), `pipeline/test/sources/simpleview.test.ts` (import path)
- Modify: `pipeline/src/sources/registry.ts` (kind `cards`, fields, dispatch), `pipeline/src/update.ts:125` (browser also when any entry has `render: true`)
- Create: `pipeline/test/sources/cards.test.ts`; Modify: `pipeline/test/sources/registry.test.ts`

**Interfaces:**
- Consumes: `CardsConfig` from Task 1; `collectPaged(page, { itemSelector, nextSelector, idAttr, maxPages, settleMs })`; `BrowserFetcher.render(url, { scrolls })` and `withPage`.
- Produces:
  ```ts
  export interface CardsParse { candidates: Candidate[]; missingYear: number; seen: number }
  export function parseCards(html: string, cfg: CardsConfig, source: SourceRef, defaults?: { venue?: string; city?: string; state?: string }, exclude?: string[]): CardsParse
  export async function fetchCards(browser: Pick<BrowserFetcher, 'render' | 'withPage'>, url: string, o: { scrolls?: number; next?: string; item: string; maxPages?: number }): Promise<{ html: string } | null>
  ```
  Registry fields (zod, all optional unless noted): `item` (required for `cards`), `title`, `date`, `link`, `render: boolean`, `scrolls: int`, `next: string`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/sources/cards.test.ts
const src = { url: 'https://x.example/events/', type: 'html' as const, fetched_at: '2026-11-16T00:00:00Z' }
const cfg = { item: '.ev-card', title: '.ev-card__title', date: '.ev-card__when', link: 'a' }
test('parses <time datetime> start/end and resolves relative links', () => {
  const r = parseCards(fx('cards-time.html'), cfg, src, { city: 'Denver', state: 'CO' })
  expect(r.candidates).toHaveLength(4); expect(r.missingYear).toBe(0)
  expect(r.candidates[0]).toMatchObject({ name: 'Name 1', start_date: '2027-03-01', end_date: '2027-03-02', city: 'Denver', state: 'Colorado', official_url: 'https://x.example/e/1' })
})
test('parses text date ranges', () => {
  const r = parseCards(fx('cards-text.html'), { item: '.listing', title: '.listing-title', date: '.listing-date' }, src)
  expect(r.candidates.map((c) => [c.start_date, c.end_date])).toEqual([['2027-03-03', '2027-03-05'], ['2027-04-10', '2027-04-10'], ['2027-12-30', '2028-01-02']])
})
test('a card without a year yields no candidate and is counted', () => {
  const html = '<div class="c"><span class="t">X</span><span class="d">Nov 20 - 29</span><a href="/x">x</a></div>'.repeat(3)
  expect(parseCards(html, { item: '.c', title: '.t', date: '.d' }, src)).toMatchObject({ candidates: [], missingYear: 3, seen: 3 })
})
test('protocol-relative hrefs resolve; javascript:/mailto: links are dropped', () => {
  const html = '<div class="c"><span class="t">A</span><span class="d">Jan 5, 2027</span><a href="//cdn.example/a">a</a></div><div class="c"><span class="t">B</span><span class="d">Jan 6, 2027</span><a href="javascript:void(0)">b</a></div>'
  const r = parseCards(html, { item: '.c', title: '.t', date: '.d' }, src)
  expect(r.candidates[0].official_url).toBe('https://cdn.example/a'); expect(r.candidates[1].official_url).toBeUndefined()
})
test('exclude patterns drop cards by name', () => {
  expect(parseCards(fx('cards-time.html'), cfg, src, {}, ['Name 2']).candidates).toHaveLength(3)
})
test('fetchCards pages with next and dedupes items', async () => { /* same local-server pattern as simpleview.test.ts collectPaged tests: 2 pages of .ev-card, expect 8 cards in html */ })
```
Add to `registry.test.ts`: `test('cards entries parse selectors and run through the DOM reader without the LLM')` — a `cards` entry with `fetchText` returning `cards-time.html`, LLM stub that throws; expect `health.ok` and `count 4`; and `test('cards entry with render uses the browser render')` — browser stub with `render` returning the fixture, expect it was called once.

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && npx vitest run test/sources/cards.test.ts test/sources/registry.test.ts`
Expected: FAIL — module not found / unknown kind `cards` (zod)

- [ ] **Step 3: Implement**

`paging.ts`: move `collectPaged` verbatim; `simpleview.ts` re-exports it (`export { collectPaged } from './paging'`) so existing imports keep working.
`cards.ts`: `parseCards` as specified; the `datetime` attribute is passed through `normalizeDate` (it accepts `YYYY-MM-DD…`); the text path uses `parseDateRangeText`; the year check is `/\b\d{4}\b/` on the date text or presence of `datetime`. `fetchCards`: if `next`, `withPage` + `collectPaged({ itemSelector: item, nextSelector: next, idAttr: 'data-cd-id' })` after assigning `data-cd-id = index` to each item via `page.evaluate` on every page (ids must exist for dedupe); else `render(url, { scrolls })`. Returns `{ html }` (for `next`, concatenates the collected outerHTMLs inside a `<div>`).
`registry.ts`: extend the zod `Entry` and add a `cards` branch in `runEntry` before the generic loop: `render || next` → `fetchCards` (browser required, else health `browser unavailable`), otherwise `fetchText`; then `parseCards`; health `no events found` when 0, `error: "<n> cards without a year"` when `missingYear > 0`.
`update.ts`: browser condition adds `|| e.kind === 'cards' && (e.render || e.next)`.

- [ ] **Step 4: Run to verify pass**

Run: `cd pipeline && npx vitest run`
Expected: all green (existing simpleview tests pass through the re-export)

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/sources/cards.ts pipeline/src/sources/paging.ts pipeline/src/sources/simpleview.ts pipeline/src/sources/registry.ts pipeline/src/update.ts pipeline/test/sources/cards.test.ts pipeline/test/sources/registry.test.ts pipeline/test/sources/simpleview.test.ts
git commit -m "feat(sources): generic cards reader driven by CSS selectors, with render and paging"
```

---

### Task 3: `probe` core (`probeUrl`) with injected I/O

**Files:**
- Create: `pipeline/src/probe.ts`
- Create: `pipeline/test/probe.test.ts`

**Interfaces:**
- Consumes: `detectCalendar`, `deriveCards`, `parseCards`, `parseJsonLd`, `parseIcs`, `parseEventItems`, `parseSimpleviewItems`, `parseSimpleviewListItems`, `parseDataTableRows`, `fetchLoadMore`, `fetchSimpleviewCalendar`, `fetchSimpleviewRange`, `fetchDataTable`, `fetchCards`.
- Produces:
  ```ts
  export type Verdict = 'ok' | 'blocked: robots.txt' | 'blocked: bot protection' | 'unreachable' | 'needs reader' | 'nothing found'
  export interface ProbeDeps {
    canFetch(url: string): Promise<boolean>
    fetchText(url: string): Promise<string | null>
    /** Status of the last fetchText call (null when it threw / timed out). */
    lastStatus(): number | null
    browser?: Pick<BrowserFetcher, 'render' | 'withPage'>
    now(): Date
  }
  export interface ProbeResult {
    url: string; host: string; verdict: Verdict; detection: Detection | null; usedBrowser: boolean
    count: number; sample: { name: string; start_date?: string; end_date?: string; official_url?: string }[]
    rejected: number; entry: Record<string, unknown> | null; note?: string
  }
  export function probeUrl(url: string, deps: ProbeDeps, meta?: { city?: string; state?: string; venue?: string; id?: string }): Promise<ProbeResult>
  export function entryId(url: string): string        // 'www.denverconvention.com' -> 'denverconvention'
  export function entryYaml(entry: Record<string, unknown>): string   // one list item, 2-space indented under `sources:`
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/probe.test.ts
const deps = (o: Partial<ProbeDeps> & { html?: string; status?: number }): ProbeDeps => ({
  canFetch: async () => true, fetchText: async () => o.html ?? null, lastStatus: () => o.status ?? (o.html ? 200 : null), now: () => new Date('2026-11-16T00:00:00Z'), ...o,
})
test('robots disallow -> blocked, no fetch, no browser', async () => {
  const fetchText = vi.fn(); const r = await probeUrl('https://x.example/events', deps({ canFetch: async () => false, fetchText }))
  expect(r.verdict).toBe('blocked: robots.txt'); expect(fetchText).not.toHaveBeenCalled(); expect(r.entry).toBeNull()
})
test('HTTP 403/429 -> blocked: bot protection, browser never used', async () => {
  const render = vi.fn(); const r = await probeUrl('https://x.example/events', deps({ html: null as never, status: 403, browser: { render, withPage: vi.fn() } }))
  expect(r.verdict).toBe('blocked: bot protection'); expect(render).not.toHaveBeenCalled()
})
test('static JSON-LD page -> ok, kind page, entry without render, sample <= 5, browser not used', async () => {
  const render = vi.fn(); const r = await probeUrl('https://x.example/events', deps({ html: fx('event-jsonld.html'), browser: { render, withPage: vi.fn() } }), { city: 'Denver', state: 'CO' })
  expect(r.verdict).toBe('ok'); expect(r.entry).toMatchObject({ id: 'x', kind: 'page', type: 'html', url: 'https://x.example/events', city: 'Denver', state: 'CO' })
  expect(r.sample.length).toBeLessThanOrEqual(5); expect(render).not.toHaveBeenCalled()
})
test('script-filled list -> browser render, then cards detection', async () => {
  const render = vi.fn(async () => ({ html: fx('cards-time.html'), text: '', finalUrl: 'https://x.example/events' }))
  const r = await probeUrl('https://x.example/events', deps({ html: '<div class="dataTables_wrapper"><table class="dataTable"></table></div>', browser: { render, withPage: vi.fn() } }))
  expect(r.usedBrowser).toBe(true); expect(r.verdict).toBe('ok'); expect(r.entry).toMatchObject({ kind: 'cards', render: true, item: '.ev-card' })
})
test('cards without years -> needs reader', async () => {
  const html = '<div class="c"><span class="t">X</span><span class="d">Nov 20 - 29</span><a href="/x">x</a></div>'.repeat(3)
  expect((await probeUrl('https://x.example/', deps({ html }))).verdict).toBe('needs reader')
})
test('no markup and no browser -> nothing found; unreachable when fetch returns null with no status', async () => {
  expect((await probeUrl('https://x.example/', deps({ html: '<p>hi</p>' }))).verdict).toBe('nothing found')
  expect((await probeUrl('https://x.example/', deps({}))).verdict).toBe('unreachable')
})
test('entryId and entryYaml', () => {
  expect(entryId('https://www.denverconvention.com/events/')).toBe('denverconvention')
  expect(entryYaml({ id: 'a', kind: 'cards', type: 'html', url: 'https://a.example/', item: '.c' })).toBe("  - id: a\n    kind: cards\n    type: html\n    url: https://a.example/\n    item: '.c'\n")
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && npx vitest run test/probe.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `probe.ts`**

Flow per spec §3: `canFetch` → `fetchText`; `null` with status 403/429/503 → `blocked: bot protection`; `null` otherwise → `unreachable`; `detectCalendar`; if best `count >= 3 && !needsBrowser` use it; else if `deps.browser` → `render(url, { scrolls: 3 })` → `detectCalendar` on the rendered HTML (`usedBrowser = true`); pick best. Dry run: call the family's parser on the HTML in hand (static or rendered) — no second navigation except `ical` (fetch the feed) — producing candidates; `count` = candidates with dates inside `[now, now+2y]`; `rejected` = the rest; `sample` = first 5. Verdicts: cards with `missingYear > 0 && count === 0` → `needs reader`; best kind `none` → `nothing found`; else `ok`. `entry`: `{ id, kind, type: 'html' | 'ical', url, venue?, city?, state?, ...cardsFields, render?: true, end_date?: '2027-12-31' for simpleview kinds }`. `entryYaml`: `yaml.stringify([entry])` re-indented by two spaces, strings containing `.` or `:` quoted — match the test exactly.

- [ ] **Step 4: Run to verify pass**

Run: `cd pipeline && npx vitest run test/probe.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/probe.ts pipeline/test/probe.test.ts
git commit -m "feat(probe): classify a calendar URL, dry-run its reader, and build the registry entry"
```

---

### Task 4: `probe` CLI: report files, `--add`, `--list`

**Files:**
- Create: `pipeline/src/tools/probe.ts`
- Modify: `pipeline/src/net/http.ts` (expose `lastStatus()` on the fetcher: record the final response status per `fetchText` call), `pipeline/test/net/http.test.ts`
- Modify: `pipeline/package.json` (`"probe": "tsx src/tools/probe.ts"`), `CLAUDE.md` (one line under in-session tools)
- Create: `pipeline/test/tools/probe-cli.test.ts`

**Interfaces:**
- Consumes: `probeUrl`, `entryYaml`, `entryId`, `createFetcher`, `createBrowserFetcher`, `loadRegistry`.
- Produces:
  ```ts
  export function parseListFile(text: string): { url: string; city?: string; state?: string; venue?: string }[]   // "url | city | state | venue", '#' comments, blank lines ignored
  export function addToRegistry(registryPath: string, entry: Record<string, unknown>): { added: boolean; reason?: 'exists' | 'too few' }
  export function reportPath(outDir: string, host: string): string      // <outDir>/probes/<host>.json
  export function formatTable(results: ProbeResult[]): string           // url | verdict | kind | count
  ```
  CLI: `npm run probe -- <url> [--city C] [--state ST] [--venue V] [--id X] [--add]` and `npm run probe -- --list <file> [--add]`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/tools/probe-cli.test.ts
test('parseListFile reads url and optional columns, skips comments', () => {
  expect(parseListFile('# rejected\nhttps://a.example/ | Denver | CO | Colorado CC\n\nhttps://b.example/\n')).toEqual([{ url: 'https://a.example/', city: 'Denver', state: 'CO', venue: 'Colorado CC' }, { url: 'https://b.example/' }])
})
test('addToRegistry appends a valid entry once and refuses a duplicate id', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'reg-')), 'registry.yaml'); writeFileSync(p, 'sources:\n  - id: a\n    kind: page\n    type: html\n    url: https://a.example/\n')
  expect(addToRegistry(p, { id: 'b', kind: 'cards', type: 'html', url: 'https://b.example/', item: '.c' })).toEqual({ added: true })
  expect(loadRegistry(p).map((e) => e.id)).toEqual(['a', 'b'])
  expect(addToRegistry(p, { id: 'b', kind: 'page', type: 'html', url: 'https://b.example/' })).toEqual({ added: false, reason: 'exists' })
})
test('formatTable one row per result', () => { expect(formatTable([r1, r2]).split('\n')).toHaveLength(3) /* header + 2 */ })
// test/net/http.test.ts (add)
test('lastStatus reports the final response status; null after a network error', async () => { /* fetchImpl returning 403 -> fetchText null, lastStatus() 403; fetchImpl throwing -> null */ })
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipeline && npx vitest run test/tools/probe-cli.test.ts test/net/http.test.ts`
Expected: FAIL — module not found / `lastStatus is not a function`

- [ ] **Step 3: Implement**

`http.ts`: keep `let last: number | null`; set it from the final `Response.status` in `fetchText` (or `null` on throw/safeTarget refusal); add `lastStatus: () => last` to the returned object (type update where `createFetcher`'s return type is declared).
`tools/probe.ts`: arg parsing like `capture.ts`; build `createFetcher` + (lazily) `createBrowserFetcher`; for each target call `probeUrl`; print a readable report: verdict, kind, evidence, count/rejected, the sample lines `YYYY-MM-DD..YYYY-MM-DD  Name  url`, then the YAML entry; write JSON to `reportPath(config.outDir, host)`; `--add` → `addToRegistry` when `verdict === 'ok' && count >= 3` (else print why not). `--list` → `parseListFile`, sequential probes, `formatTable` at the end; `--add` with `--list` is ignored with a printed note (spec: never auto-add in list mode). Exit code 2 when a single-URL probe is not `ok`. Close the browser at the end.
`CLAUDE.md` tools list: "`npm run probe -- <url> [--city --state --venue] [--add]` classifies a calendar page and emits its registry entry; `--list file` probes many."

- [ ] **Step 4: Run to verify pass**

Run: `cd pipeline && npx vitest run && npm run probe -- https://www.laconventioncenter.com/events/ --city "Los Angeles" --state CA`
Expected: suite green; the probe prints verdict `ok`, kind `loadmore` or `page`, count ≥ 2, and a YAML entry (no `--add`, so the registry is untouched: `git status` shows no change to `registry.yaml`)

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/tools/probe.ts pipeline/src/net/http.ts pipeline/package.json CLAUDE.md pipeline/test/tools/probe-cli.test.ts pipeline/test/net/http.test.ts
git commit -m "feat(probe): CLI with per-host reports, --add to the registry, and --list batch mode"
```

---

### Task 5: Regression on the current registry and the seed list

**Files:**
- Create: `pipeline/sources/venue-candidates.txt`
- Modify: `docs/SOURCING.md` (new "Probe results" table), `pipeline/sources/registry.yaml` (entries added by `--add`)

**Interfaces:** consumes the CLI only.

- [ ] **Step 1: Regression over the nine current sources**

Run: for each `url` in `registry.yaml` with a `city`: `npm run probe -- <url> --city <city> --state <state>`
Expected: each prints the family currently in the registry (or `cards` for LACC is acceptable only if count ≥ the current 23) and `count` ≥ 80 % of the source's last `report.json` count. Record any mismatch in the plan's PR notes; a mismatch in detection is a bug in Task 1 — fix there with a test before continuing.

- [ ] **Step 2: Write the seed list**

`venue-candidates.txt`: one line per venue from the spec §4 (`url | city | state | venue`), with URLs found by looking at each venue's site (never guessed into the registry); the known rejects (Anaheim, IAEE, tech.vegas, Javits, Tradeshowz, thetradeshowcalendar) under `# rejected (do not re-probe)` as comments.

- [ ] **Step 3: Batch probe**

Run: `npm run probe -- --list sources/venue-candidates.txt`
Expected: a table with a verdict per venue; JSON reports in `pipeline/out/probes/`.

- [ ] **Step 4: Add the `ok` sites one by one, reviewing each sample**

Run per site: `npm run probe -- <url> --city … --state … --venue … --add`
Expected: `added` for sites whose 5-event sample looks like conferences/expos with correct dates; skip (and note) sites whose sample is wrong even if `ok`.

- [ ] **Step 5: Document and verify**

Add the "Probe results (date)" table to `docs/SOURCING.md` (url, verdict, kind, count, decision). Run `cd pipeline && npx vitest run && npm run update -- --tier weekly --dry-run` and check `pipeline/out/report.json`: every new source `ok` with a count; any `no events found` goes back to Step 4 or into SOURCING.md as rejected.

- [ ] **Step 6: Commit**

```bash
git add pipeline/sources/venue-candidates.txt pipeline/sources/registry.yaml docs/SOURCING.md
git commit -m "data(sources): probe results for the top US convention centers; new venue readers"
```

---

### Task 6: Live refresh and publish

- [ ] **Step 1:** `git pull --rebase` (CI commits the database), then `cd pipeline && npm run update -- --tier weekly` (background, ~10–25 min).
- [ ] **Step 2:** Review `pipeline/out/quarantine.json` and the new events' topics; apply `npm run topics` / `npm run exclude` maps for judgment calls; `npm run export`.
- [ ] **Step 3:** Run both suites (`pipeline/`, `web/`); commit `data: refresh weekly (coverage wave 4)`; push. Deploy runs automatically; confirm `https://wowjustmike.github.io/ConferenceDash/events.json` has the new count.
- [ ] **Step 4:** Update `docs/HANDOFF.md` counts (events, bars, cities) and mark C done; commit.
