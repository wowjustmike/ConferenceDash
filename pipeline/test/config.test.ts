import { loadConfig } from '../src/config'

test('defaults', () => {
  const c = loadConfig({})
  expect(c.publishThreshold).toBe(0.6)
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
