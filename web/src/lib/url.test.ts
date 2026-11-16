import { filtersToParams, paramsToFilters } from './url'
import { EMPTY_FILTERS, type Filters } from './filters'

test('round trip of a full filter set', () => {
  const f: Filters = {
    q: 'cloud', preset: 'custom', from: '2027-01-01', to: '2027-03-01', states: ['Nevada', 'California'],
    cities: ['Las Vegas'], venues: ['Venetian Expo'], topics: ['Tech', 'Media'], organizer: 'Informa', sizes: ['10-30k'], minSignal: 3,
  }
  expect(paramsToFilters(filtersToParams(f))).toEqual(f)
})
test('default filters produce an empty query', () => {
  expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('')
  expect(paramsToFilters(new URLSearchParams(''))).toEqual(EMPTY_FILTERS)
})
test('unknown topics, sizes and presets are dropped', () => {
  const f = paramsToFilters(new URLSearchParams('topics=Bogus&topics=Tech&sizes=huge&sizes=u10k&preset=zzz'))
  expect(f.topics).toEqual(['Tech'])
  expect(f.sizes).toEqual(['u10k'])
  expect(f.preset).toBe(EMPTY_FILTERS.preset)
})
test('values containing commas survive', () => {
  const f = { ...EMPTY_FILTERS, venues: ['Hall A, East'] }
  expect(paramsToFilters(filtersToParams(f)).venues).toEqual(['Hall A, East'])
})

test('signal param is validated and defaults to 1', () => {
  expect(paramsToFilters(new URLSearchParams('signal=3')).minSignal).toBe(3)
  expect(paramsToFilters(new URLSearchParams('signal=9')).minSignal).toBe(1)
  expect(paramsToFilters(new URLSearchParams('signal=abc')).minSignal).toBe(1)
  expect(filtersToParams({ ...EMPTY_FILTERS, minSignal: 2 }).get('signal')).toBe('2')
  expect(filtersToParams(EMPTY_FILTERS).has('signal')).toBe(false)
})
