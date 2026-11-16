import { loadConfig } from '../src/config'

test('defaults', () => {
  const c = loadConfig({})
  expect(c.publishThreshold).toBe(0.3)
  expect(c.maxLlmCalls).toBe(300)
  expect(c.extractModel).toBe('claude-haiku-5-5')
  expect(c.adjudicateModel).toBe('claude-sonnet-5-5')
  expect(c.userAgent).toBe('ConferenceDashBot/1.0')
})
test('env overrides', () => {
  const c = loadConfig({ MAX_LLM_CALLS: '10', EXTRACT_MODEL: 'x-model' })
  expect(c.maxLlmCalls).toBe(10)
  expect(c.extractModel).toBe('x-model')
})
test('garbage numeric env falls back to default', () => {
  expect(loadConfig({ MAX_LLM_CALLS: 'abc' }).maxLlmCalls).toBe(300)
})

test('database, window and export defaults', () => {
  const c = loadConfig({})
  expect(c.windowStart).toBe('2026-11-15')
  expect(c.windowEnd).toBe('2027-12-31')
  expect(c.sampleDropThreshold).toBe(100)
  expect(c.maxExportBytes).toBe(5 * 1024 * 1024)
  expect(c.dbPath).toMatch(/data\/conferencedash\.db$/)
  expect(loadConfig({ WINDOW_END: '2028-06-30', SAMPLE_DROP_THRESHOLD: '5' })).toMatchObject({ windowEnd: '2028-06-30', sampleDropThreshold: 5 })
})
