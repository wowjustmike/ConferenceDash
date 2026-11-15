import { filtersToParams, paramsToFilters } from './url'
import { EMPTY_FILTERS, type Filters } from './filters'

test('round trip of a full filter set', () => {
  const f: Filters = {
    q: 'cloud', preset: 'custom', from: '2027-01-01', to: '2027-03-01', states: ['Nevada', 'California'],
    cities: ['Las Vegas'], venues: ['Venetian Expo'], topics: ['Tech', 'Media'], organizer: 'Informa', sizes: ['10-30k'],
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
