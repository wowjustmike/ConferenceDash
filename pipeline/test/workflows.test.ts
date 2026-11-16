import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const load = (f: string) => readFileSync(new URL(`../../.github/workflows/${f}`, import.meta.url), 'utf8')

test('pipeline workflow: schedules, tiers, secret names, no inline secrets', () => {
  const text = load('pipeline.yml')
  const y = parse(text)
  expect(y.on.schedule.map((s: { cron: string }) => s.cron)).toEqual(['0 9 * * *', '0 10 * * 0', '0 11 1 * *'])
  expect(y.on.workflow_dispatch.inputs.tier.options).toEqual(['daily', 'weekly', 'monthly'])
  expect(text).toContain('secrets.ANTHROPIC_API_KEY')
  expect(text).toContain('secrets.TICKETMASTER_KEY')
  expect(text).not.toMatch(/sk-ant-/)
  expect(y.concurrency['cancel-in-progress']).toBe(false)
})
test('deploy workflow parses and publishes web/dist to Pages', () => {
  const y = parse(load('deploy.yml'))
  expect(y.jobs.deploy.steps.some((s: { uses?: string }) => s.uses?.startsWith('actions/deploy-pages'))).toBe(true)
  expect(y.on.workflow_run.workflows).toEqual(['Pipeline'])
})
