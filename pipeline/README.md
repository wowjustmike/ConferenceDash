# ConferenceDash pipeline

Collects, merges, verifies and publishes conference data into `../data/events.json`.

```bash
cd pipeline
npm install && npm install --prefix ../web      # the pipeline reuses the web app's schema
npm test
ANTHROPIC_API_KEY=... npm run pipeline -- --tier weekly --dry-run   # writes only pipeline/out/
ANTHROPIC_API_KEY=... npm run pipeline -- --tier daily              # updates data/events.json
```

- `--tier daily|weekly|monthly` controls which existing events are re-verified (see `src/schedule.ts`).
- Without `ANTHROPIC_API_KEY` the structured sources still work; LLM extraction and verification fallbacks are skipped.
- Output: `out/report.json` (per-source health, counts) and `out/quarantine.json`.
- Exit status is non-zero only if **every** source is unhealthy.
- Sources: `sources/registry.yaml`; rules and probe results: `../docs/SOURCING.md`.
- Automation: `.github/workflows/pipeline.yml` (needs repo secrets `ANTHROPIC_API_KEY`, optional `TICKETMASTER_KEY`) and `deploy.yml`.
