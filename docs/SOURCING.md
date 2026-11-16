# ConferenceDash Sourcing Playbook

Instructions for any future run (human or AI agent) that finds, verifies or refreshes conference data. Follow in order.

## Golden rules

1. **The organizer's official site is the source of truth.** Everything else is a lead.
2. Store facts only (name, dates, place, organizer, topics, size, URL). Never copy descriptions, logos or photos. Always link to the official site.
3. Never publish a date you could not confirm without marking `dates_confirmed: false` ("Dates TBC").
4. Never overwrite good data with worse data, and never delete on an empty fetch. An empty result means the source broke, so alert and keep what we have.
5. Respect robots.txt and site terms. Low rate, generic user agent.

## Source tiers (check in this order)

### Tier 1: structured, machine-readable (cheapest, most reliable)
| Source | How | Covers |
|---|---|---|
| Confs.tech data (github.com/tech-conferences/conference-data) | Read the JSON files by topic/year from the repo. Fields include name, url, startDate, endDate, city, country. Filter `country == "U.S.A."` | Software/tech conferences |
| iCal exports | Many WordPress "Events Calendar" sites expose `?ical=1`. Examples seen: iaee.com/events/month/YYYY-MM/?ical=1, tech.vegas/calendar/...?ical=1. Parse VEVENT. | Industry associations, local tech |
| Ticketmaster Discovery API | Free key, about 5,000 calls/day. `GET /discovery/v2/events` and `/venues`; filter by venue ID for convention venues. Deep paging capped (size x page < 1000). | Venue-linked events; skews to consumer events |
| RSS/Atom | Always check `<link rel="alternate" type="application/rss+xml">` and `/feed` on a calendar page before scraping HTML. | Misc. |

Do **not** use Eventbrite public search; that API was shut down in 2019-2020.

### Tier 2: official venue and convention-bureau calendars
Target venues (start list): Las Vegas Convention Center, Venetian/Sands Expo, Mandalay Bay, Caesars Forum, Anaheim CC, Los Angeles CC, Orange County CC (Orlando), McCormick Place (Chicago), Austin CC, George R. Brown (Houston), Javits (NYC), Georgia World Congress (Atlanta), Moscone (San Francisco).

Bureau calendars: lvcva.com/events (90-day snapshot, venues 3,000+ seats only), vegasmeansbusiness.com/planning-tools/convention-calendar (self-described sample), choosechicago.com convention calendar, visitlex-style CVB "convention calendar" pages. ConventionCalendar.com (IAVM) is an industry-wide venue calendar worth checking for feeds.

Extraction order per page: (1) JSON-LD `schema.org/Event` or `ItemList`; (2) iCal/RSS link; (3) LLM extraction with the fixed event schema. Discover pages via `sitemap.xml` and the listing pagination.

**Known limitation:** these calendars are intentionally partial. Use them to seed and corroborate, not as proof of completeness.

### Tier 3: aggregators (discovery leads only)
Tradeshowz.com, Luminik (per-venue pages), ExpoAssist (per-venue pages), Metro Exhibits trade show calendar, Expomarketing, Events in America (GlobalEdge), 10times (no public API; scraping terms unreviewed), Showsbee.

Use to learn that an event exists and a rough date. Then find the organizer's own site (search "<event name> <year>"), confirm there, and cite the official URL as the source. Do not republish an aggregator's records.

### Tier 4: submissions
The "Submit your event" form. Same verification as everything else.

## Per-event procedure

1. **Collect** candidates from tiers 1-3 (name, year, city, rough dates, lead URL).
2. **Normalize**: city/state to canonical form, venue aliases (e.g. "LVCC" = Las Vegas Convention Center), topics from the fixed taxonomy: Tech, Healthcare, Finance, Gaming, Marketing, Energy, Media, Hospitality, Automotive, Aviation, Retail, Entertainment, Cannabis, Education, Sports, Other.
3. **Deduplicate** on normalized name + year + city. Editions in different years are different events. Co-located events are separate if they have separate sites.
4. **Verify** on the official site: confirm dates, city, venue. If the site shows no dates for the upcoming edition, set `dates_confirmed: false`. If it says cancelled/postponed, set `status`.
5. **Score confidence**: official-site confirmation (high) + two independent sources agreeing (medium) + single aggregator only (low, do not publish).
6. **Publish** only events above the confidence threshold. Record every source URL and `fetched_at`.

## Refresh cadence

Starts in under 30 days: daily. 30-180 days: weekly. 180+ days: monthly. Tier 1 feeds: daily. New-source discovery: weekly. Mark "Re-check due" at 60 days without verification. Archive past events.

## Failure handling

- Source returns 0 results, or HTML/JSON shape changed: flag in the run report, keep existing data, retry next run.
- Conflicting dates between sources: the official site wins; if no official site is reachable, publish as `dates_confirmed: false`.
- LLM extraction returns missing required fields: discard the record (do not guess).

## Ideas to evaluate later (unverified)

- Wikidata SPARQL for large, notable conferences (property IDs not yet checked).
- Paid event-intelligence APIs (e.g. PredictHQ) and Google Events via SerpApi: access terms and pricing not checked.
- Asking convention bureaus (e.g. Visit Las Vegas Meetings) for a bulk data feed.
- Firecrawl or similar crawl+extract service as the fetch layer; check current pricing first.

## Source probe results (2026-11-15)

Probed with `ConferenceDashBot/1.0`, honoring robots.txt. Registry: `pipeline/sources/registry.yaml`.

| Source | Result | Decision |
|---|---|---|
| Confs.tech (raw GitHub JSON) | Works. US rows carry `city: "City, ST"` and `country: "U.S.A."`. Live run: 71 US candidates | In use (no LLM needed) |
| lvcva.com/events | Allowed, reachable; listings are not schema.org Events | In registry; needs the LLM extractor |
| lacclink.com/events | Allowed, reachable; no Event JSON-LD | In registry; needs the LLM extractor |
| occc.net/events | Allowed, reachable; no Event JSON-LD | In registry; needs the LLM extractor |
| mccormickplace.com/events | Allowed, reachable; no Event JSON-LD | In registry; needs the LLM extractor |
| austinconventioncenter.com/events | Allowed, reachable; no JSON-LD at all | In registry; needs the LLM extractor |
| moscone.com/events | Allowed, reachable; JSON-LD present but not confirmed as Event entries | In registry; falls through to the LLM extractor |
| anaheimconventioncenter.com | robots.txt disallows our bot | **Rejected**; do not fetch. Ask the venue for a feed |
| iaee.com `?ical=1` feeds | robots.txt disallows our bot | **Rejected** |
| tech.vegas `?ical=1` feeds | robots.txt disallows our bot | **Rejected** |
| Javits (javitscenter.com/events) | HTTP 429 on first request | Retry later with backoff; not added |
| Venetian Expo, LVCC, Mandalay Bay | Guessed URLs did not resolve or timed out | Find correct URLs; LVCVA calendar covers Las Vegas meanwhile |
| George R. Brown (houstonfirst.com) | Guessed URL 404 | Find correct URL |
| Ticketmaster Discovery | Needs `TICKETMASTER_KEY` and venue IDs in `pipeline/sources/ticketmaster-venues.json` | Skipped until configured |

**Run results without an Anthropic key** (`npm run pipeline -- --tier weekly --dry-run`): Confs.tech supplied all candidates; the six venue pages returned "no events found" because they need LLM extraction. After skipping already-ended events: 71 candidates, 14 distinct upcoming events, 13 verified on their official sites, 13 published, 1 quarantined. Venue-page extraction quality is **unmeasured** until a key is available.

## How the pipeline decides to publish

1. Collect candidates from every healthy source; clean and normalize them.
2. Merge duplicates (exact key, official-URL match, name similarity >= 0.8; 0.5-0.8 goes to the LLM adjudicator).
3. Skip events that already ended. Verify new events immediately and existing ones when due for the tier.
4. Score confidence; publish at >= 0.6, quarantine the rest (`pipeline/out/quarantine.json`).
5. Never delete on an empty fetch, never lower confidence, never revert confirmed dates. Sample (`seed`) events are removed the first time a real event is published.
