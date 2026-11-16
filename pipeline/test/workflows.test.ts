import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const load = (f: string) => readFileSync(new URL(`../../.github/workflows/${f}`, import.meta.url), 'utf8')

test('pipeline workflow: scheduled per tier with the database committed; secrets by name; commits the whole data dir', () => {
  const text = load('pipeline.yml')
  const y = parse(text)
  // Three crons, one per tier; the run maps github.event.schedule back to the tier it stands for.
  expect(y.on.schedule.map((s: { cron: string }) => s.cron)).toEqual(['0 9 * * *', '0 10 * * 0', '0 11 1 * *'])
  expect(text).toContain('github.event.schedule')
  expect(text).toContain("'0 10 * * 0') tier=weekly")
  expect(text).toContain("'0 11 1 * *') tier=monthly")
  expect(y.on.workflow_dispatch.inputs.tier.options).toEqual(['daily', 'weekly', 'monthly'])
  // The database must come from the checkout, so the run never rebuilds it from the filtered export.
  expect(text).toContain('data/conferencedash.db')
  expect(text).toContain('secrets.ANTHROPIC_API_KEY')
  expect(text).toContain('secrets.TICKETMASTER_KEY')
  expect(text).not.toMatch(/sk-ant-/)
  expect(text).toContain('git add -A data')
  expect(text).toMatch(/persist/i)
  expect(y.concurrency['cancel-in-progress']).toBe(false)
})
test('deploy workflow parses and publishes web/dist to Pages', () => {
  const y = parse(load('deploy.yml'))
  expect(y.jobs.deploy.steps.some((s: { uses?: string }) => s.uses?.startsWith('actions/deploy-pages'))).toBe(true)
  expect(y.on.workflow_run.workflows).toEqual(['Pipeline'])
})
