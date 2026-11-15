# ConferenceDash: Design Spec

Date: 2026-11-15 · Status: DRAFT, awaiting user approval

## 1. Purpose

A fast, filterable directory of upcoming US conferences and trade shows. A user can see what is happening in any state, city or venue, when, and who is organizing it. Example: "which tech conferences are in Las Vegas vs. Los Angeles this spring?"

**Hands-off requirement:** data is collected, verified and refreshed automatically. Humans only intervene on rare low-confidence items.

Out of scope for v1: ticketing, user accounts, non-US events, session/speaker/agenda detail.

## 2. Decisions already made

- Desktop layout: left filter sidebar (design p.1). Mobile: bottom-sheet filters (p.8).
- Views: List, Calendar, Map, Compare cities, event detail drawer, empty and loading states (see `Design/ConferenceDash.pdf`).
- Approach: curated seed plus automated AI refresh. Aggregators are used for discovery only, never copied.
- Stack: React + Vite, static build, Leaflet map. Data is a versioned `events.json` built by a pipeline. No runtime server.

## 3. Architecture

Two independent parts joined by one file (`data/events.json`).

```
[ Pipeline (scheduled) ]  ->  data/events.json  ->  [ Static web app ]
  discover > fetch > extract > normalize > dedupe > verify > score > publish
```

**Web app** reads `events.json`, filters client-side (a few thousand records is trivial), and links out to the official site. It knows nothing about sources.

**Pipeline** is a set of small scripts run on a schedule (GitHub Actions cron):

| Stage | Job | Notes |
|---|---|---|
| discover | Produce candidate event URLs | From source registry (`sources/registry.yaml`); sitemaps, listing pages, feeds |
| fetch | Download pages/feeds | robots.txt respected, per-host rate limits, ETag/Last-Modified caching |
| extract | Turn a page into structured fields | Order: feed fields > JSON-LD `schema.org/Event` > LLM extraction with fixed schema |
| normalize | Canonical city/state/venue, dates, topic tags | Venue and city alias tables; topic taxonomy fixed list |
| dedupe | Merge same event from many sources | Key: normalized name + year + city; fuzzy match; LLM tie-break only on ambiguous pairs |
| verify | Re-read the **organizer's official page** | Sets `last_verified`, `dates_confirmed` |
| score | Confidence 0-1 from source count, agreement, verification age | Below threshold: quarantined, not published |
| publish | Write `events.json`, run schema validation, commit | Build fails on invalid data; last good file stays live |

**Models:** a small fast model (Haiku 5.5) for bulk extraction and topic tagging; a stronger model (Sonnet 5.5) for ambiguous dedupe, conflicting dates and verification disputes. Model IDs are config, not code.

## 4. Data model (per event)

`id, name, start_date, end_date, dates_confirmed (bool), city, state, venue, organizer, topics[], est_attendance (nullable), official_url, sources[] (url + type + fetched_at), last_verified, confidence, status (active | cancelled | past)`.

Only facts are stored. No copied descriptions or images. The app links to the organizer.

## 5. Sourcing strategy (summary; full playbook in `docs/SOURCING.md`)

1. **Tier 1, structured:** Confs.tech open JSON; iCal feeds (e.g. IAEE `?ical=1`, other `?ical=1` calendars); official APIs with free keys (Ticketmaster Discovery, filtered to venue/classification).
2. **Tier 2, official venue and convention-bureau calendars:** about 40 major venues/CVBs. Extracted via JSON-LD/iCal when present, otherwise LLM extraction. These are *partial* by their own admission (LVCVA: venues of 3,000+ seats, 90 days; Visit Las Vegas: "a sample"), so they seed and corroborate, not complete.
3. **Tier 3, aggregators (discovery only):** Tradeshowz, Luminik, ExpoAssist, Metro Exhibits, ConventionCalendar.com, 10times. They suggest names and dates; each lead must be confirmed on the organizer's own site before publishing. No bulk copying.
4. **Tier 4, submissions:** the "Submit your event" form feeds the same pipeline and is verified the same way.

## 6. Freshness and scheduling

- Events starting within 30 days: re-verified daily.
- 30-180 days: weekly. Beyond 180 days: monthly.
- Source discovery runs weekly; Tier 1 feeds daily.
- An event with no verification for 60 days shows the "Re-check due" badge (design p.1). Past events are archived automatically.

## 7. Reliability and compliance guardrails

- Respect robots.txt and site terms; identify with a generic user agent; low request rates.
- Each source has a health record. A source returning zero results or a changed shape raises an alert in the run summary and never wipes existing data.
- Published data is never overwritten by a lower-confidence run.
- Per-run cost cap on LLM calls.
- Open legal question: scraping terms of third-party aggregators were not reviewed; the design limits their use to discovery for that reason.

## 8. Testing

- Extractor tests against saved fixture pages for each source type.
- Schema validation of `events.json` in CI.
- Dedupe tests with known duplicate and near-duplicate pairs.
- Web app: filter logic unit tests; manual check against the design PDF.

## 9. Delivery phases

1. Web app against hand-seeded sample data (matches the design).
2. Pipeline skeleton plus Tier 1 sources (Confs.tech, iCal, Ticketmaster).
3. Tier 2 venue extractors for the top ~10 venues (Las Vegas, LA, Anaheim, Orlando, Chicago, Austin, Houston, NYC, Atlanta, San Francisco).
4. Verification, scoring, scheduled runs, source-health reporting.
5. Submit form; expand venues.

## 10. Needs from the user later

- An Anthropic API key for the scheduled pipeline (stored as a secret, never committed).
- A GitHub repository (this folder is not a git repo yet) to run the scheduled jobs and host the site.
- Optional: free Ticketmaster developer key.
