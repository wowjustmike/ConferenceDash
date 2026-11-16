import { confidence } from '../src/score'

const ok = { reachable: true, datesConfirmed: true, cancelled: false, cityMatches: true, editionYearSeen: true }
const base = { agreeingSources: 1, hasOfficialUrl: true, conflictingDates: false, ageDays: 0 }

test('ordering: verified official > two agreeing sources > aggregator only', () => {
  const verified = confidence({ ...base, verification: ok })
  const two = confidence({ ...base, agreeingSources: 2 })
  const agg = confidence({ ...base, hasOfficialUrl: false })
  expect(verified).toBeGreaterThan(two)
  expect(two).toBeGreaterThan(agg)
  expect(agg).toBeLessThan(0.6)
  expect(two).toBeGreaterThanOrEqual(0.6)
  expect(verified).toBeGreaterThanOrEqual(0.85)
})
test('two aggregators agreeing is still below the publish threshold', () => {
  expect(confidence({ ...base, hasOfficialUrl: false, agreeingSources: 3 })).toBeLessThan(0.6)
})
test('single unverified source with an official url sits just below threshold', () => {
  expect(confidence(base)).toBeLessThan(0.6)
})
test('conflicting dates and stale verification lower the score', () => {
  const v = confidence({ ...base, verification: ok })
  expect(confidence({ ...base, verification: ok, conflictingDates: true })).toBeLessThan(v)
  expect(confidence({ ...base, verification: ok, ageDays: 200 })).toBeLessThan(v)
})
test('cancelled or unreachable verification', () => {
  expect(confidence({ ...base, verification: { ...ok, cancelled: true } })).toBeLessThan(0.3)
  expect(confidence({ ...base, agreeingSources: 2, verification: { ...ok, reachable: false, datesConfirmed: false, cityMatches: false, editionYearSeen: false } })).toBeLessThanOrEqual(confidence({ ...base, agreeingSources: 2 }))
})
test('always within 0..1', () => {
  for (const agreeing of [0, 1, 5, 50])
    for (const age of [0, 500])
      for (const conflict of [true, false]) {
        const s = confidence({ agreeingSources: agreeing, hasOfficialUrl: true, conflictingDates: conflict, ageDays: age, verification: ok })
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1)
      }
})
