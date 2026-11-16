import { isSample } from './sample'
import type { ConfEvent } from './schema'

const ev = (types: string[]) => ({ sources: types.map((type) => ({ url: 'u', type, fetched_at: 'x' })) }) as ConfEvent

test('isSample is true only when every source is seed data', () => {
  expect(isSample(ev(['seed']))).toBe(true)
  expect(isSample(ev(['seed', 'seed']))).toBe(true)
  expect(isSample(ev(['seed', 'jsonld']))).toBe(false)
  expect(isSample(ev(['confs.tech']))).toBe(false)
  expect(isSample(ev([]))).toBe(false)
})
