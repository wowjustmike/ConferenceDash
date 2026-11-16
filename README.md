# ConferenceDash

A fast, filterable directory of upcoming US conferences and trade shows: browse by state, city, venue, date, topic and organizer, in list, calendar, map or compare-cities views.

## Run it

```bash
cd web
npm install
npm run dev      # copies ../data/events.json into web/public, serves http://localhost:5173
npm test         # vitest
npm run build    # type-check + production build into web/dist
```

## Data

The app reads one file, `data/events.json` (schema: `web/src/lib/schema.ts`), exported from the SQLite database `data/conferencedash.db` (see `CLAUDE.md` for the update procedure). Each event carries a `signal` (1-3 bars of credibility with its evidence). Today it holds **sample seed data**: dates and attendance are placeholders and the UI says so. The planned automated pipeline (Plan 2) will replace this file on a schedule; see:

- `docs/superpowers/specs/2026-11-15-conferencedash-design.md` — design spec
- `docs/SOURCING.md` — where and how events are sourced and verified
- `docs/superpowers/plans/2026-11-15-web-app.md` — this web app's plan
- `Design/ConferenceDash.pdf` — visual design

URL state: filters and the active view are kept in the query string (`?states=Nevada&topics=Tech&view=calendar`), so any view can be shared.
