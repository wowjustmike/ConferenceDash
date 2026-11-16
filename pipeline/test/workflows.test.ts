import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const load = (f: string) => readFileSync(new URL(`../../.github/workflows/${f}`, import.meta.url), 'utf8')

test('pipeline workflow: manual only until the database is persisted; secrets by name; commits the whole data dir', () => {
  const text = load('pipeline.yml')
  const y = parse(text)
  expect(y.on.schedule).toBeUndefined() // the SQLite database is git-ignored, so a stateless cron would rebuild it from the filtered export every run
  expect(y.on.workflow_dispatch.inputs.tier.options).toEqual(['daily', 'weekly', 'monthly'])
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
