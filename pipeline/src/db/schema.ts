export const SCHEMA_VERSION = 3

/** v2: remember which classifier version made each exclusion so rule-made exclusions can be re-checked. */
export const SCHEMA_V2 = 'alter table exclusions add column rule_version integer not null default 1'

export const SCHEMA_V1 = `
create table sources (
  id text primary key, kind text not null, family text not null, credibility integer not null default 0,
  robots_ok integer, notes text, last_health text
);
create table fetches (
  id integer primary key autoincrement, url text not null, host text not null, status integer, fetched_at text not null,
  etag text, content_hash text, bytes integer
);
create table observations (
  id integer primary key autoincrement,
  source_id text not null references sources(id),
  fetch_id integer references fetches(id),
  raw_name text not null, start_date text, end_date text, city text, state text, venue text, organizer text, url text,
  evidence_kind text not null, confirms_edition integer not null default 0, seen_at text not null, extractor text not null
);
create unique index observations_unique on observations(source_id, raw_name, coalesce(start_date,''), coalesce(city,''), coalesce(url,''), evidence_kind);
create table events (
  id text primary key, name text not null, start_date text not null, end_date text not null, dates_confirmed integer not null default 0,
  city text not null, state text not null, venue text not null default '', organizer text not null default '', topics_json text not null default '[]',
  kind text, est_attendance integer, official_url text not null, status text not null default 'active' check (status in ('active','cancelled','past')), last_verified text not null,
  confidence real not null default 0, signal_points integer not null default 0, signal_bars integer not null default 1, signal_json text,
  excluded_reason text, is_sample integer not null default 0, sources_json text not null default '[]'
);
create table event_observations (
  event_id text not null references events(id), observation_id integer not null references observations(id),
  decided_by text not null, primary key (event_id, observation_id)
);
create table inbox (
  id integer primary key autoincrement, url text not null, source_id text references sources(id), path text,
  status text not null default 'pending', notes text, created_at text not null
);
create table exclusions (
  event_key text primary key, reason text not null, name text not null, seen_at text not null
);
create table runs (
  id integer primary key autoincrement, started_at text not null, finished_at text, report_json text
);
`

/** v3: candidates read in-session by Claude and imported with `npm run ingest` (re-merged on every update run). */
export const SCHEMA_V3 = `
create table ingested (
  id integer primary key autoincrement, key text not null unique, candidate_json text not null, ingested_at text not null
);
`
