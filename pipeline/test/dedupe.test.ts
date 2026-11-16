import { matchKey, mergeCandidates, findAmbiguous, pairKey, resolveAmbiguous } from '../src/dedupe'
import { LlmBudget, type LlmClient } from '../src/extract/llm'
import type { Candidate, SourceType } from '../src/types'

const c = (name: string, o: Partial<Candidate> = {}, type: SourceType = 'confs.tech', url = `https://${type}.example/x`): Candidate => ({
  name, start_date: '2027-01-06', end_date: '2027-01-09', city: 'Las Vegas', state: 'Nevada', source: { url, type, fetched_at: '2026-11-01T00:00:00Z' }, ...o,
})

test('matchKey ignores year/international/annual wording', () => {
  expect(matchKey(c('CES'))).toBe(matchKey(c('CES 2027')))
  expect(matchKey(c('International CES'))).toBe(matchKey(c('CES 2027')))
  expect(matchKey(c('CES', { city: 'Austin' }))).not.toBe(matchKey(c('CES')))
  expect(matchKey(c('CES', { start_date: '2028-01-06', end_date: '2028-01-09' }))).not.toBe(matchKey(c('CES')))
})
test('CES / CES 2027 / International CES from three sources merge into one with 3 sources', () => {
  const m = mergeCandidates([
    c('CES', {}, 'ical', 'https://a.example/f.ics'),
    c('CES 2027', { official_url: 'https://www.ces.tech' }, 'jsonld', 'https://b.example/p'),
    c('International CES', {}, 'aggregator', 'https://c.example/p'),
  ])
  expect(m).toHaveLength(1)
  expect(m[0].sources).toHaveLength(3)
  expect(m[0].agreeing).toBe(3)
  expect(m[0].candidate.official_url).toBe('https://www.ces.tech')
  expect(m[0].conflictingDates).toBe(false)
})
test('different years of the same event stay separate', () => {
  const m = mergeCandidates([c('SXSW 2027'), c('SXSW 2028', { start_date: '2028-03-10', end_date: '2028-03-19' })])
  expect(m).toHaveLength(2)
})
test('same name in different cities stays separate', () => {
  expect(mergeCandidates([c('Summit'), c('Summit', { city: 'Austin', state: 'Texas' })])).toHaveLength(2)
})
test('co-located events with different names/sites stay separate', () => {
  const a = c('SXSW', { city: 'Austin', official_url: 'https://sxsw.com' }, 'jsonld', 'https://v.example/1')
  const b = c('SXSW EDU', { city: 'Austin', official_url: 'https://sxswedu.com' }, 'jsonld', 'https://v.example/2')
  expect(mergeCandidates([a, b])).toHaveLength(2)
  expect(findAmbiguous([a, b])).toHaveLength(1) // 0.5 <= similarity < 0.8 -> goes to adjudication
})
test('same official_url merges related names', () => {
  const m = mergeCandidates([c('Tech Expo', { official_url: 'https://expo.example/2027' }), c('Tech Expo Week', { official_url: 'https://expo.example/2027' }, 'jsonld')])
  expect(m).toHaveLength(1)
})
test('a shared organizer homepage does NOT merge unrelated co-located events', () => {
  const m = mergeCandidates([
    c('Black Hat USA', { official_url: 'https://www.informatech.com/' }, 'jsonld', 'https://v.example/1'),
    c('Cybersecurity Leadership Summit', { official_url: 'https://www.informatech.com/' }, 'jsonld', 'https://v.example/2'),
  ])
  expect(m).toHaveLength(2)
})
test('edition numbers and spacing variants do not split an event', () => {
  expect(matchKey(c('DEF CON 35'))).toBe(matchKey(c('DEF CON')))
  expect(mergeCandidates([c('DEF CON 35'), c('DEF CON')])).toHaveLength(1)
  expect(mergeCandidates([c('ReactConf'), c('React Conf')], undefined)).toHaveLength(1)
})
test('conflicting dates are flagged; official-url record wins', () => {
  const m = mergeCandidates([
    c('Adobe Summit', { start_date: '2027-03-23', end_date: '2027-03-25' }, 'aggregator', 'https://agg.example/p'),
    c('Adobe Summit', { start_date: '2027-03-24', end_date: '2027-03-26', official_url: 'https://business.adobe.com/summit' }, 'jsonld', 'https://adobe.example/p'),
  ])
  expect(m).toHaveLength(1)
  expect(m[0].conflictingDates).toBe(true)
  expect(m[0].candidate.start_date).toBe('2027-03-24')
  expect(m[0].agreeing).toBe(1)
})
test('missing city merges into the single matching city group; fills gaps', () => {
  const m = mergeCandidates([c('HIMSS Global Conference', { organizer: 'HIMSS' }), c('HIMSS', { city: undefined, state: undefined, est_attendance: 28000 }, 'ical', 'https://z.example/f.ics')])
  expect(m).toHaveLength(1)
  expect(m[0].candidate).toMatchObject({ organizer: 'HIMSS', est_attendance: 28000, city: 'Las Vegas' })
})
test('adjudicated ambiguous pairs merge only when judged same', () => {
  const a = c('SXSW', { city: 'Austin' }, 'jsonld', 'https://v.example/1')
  const b = c('SXSW EDU', { city: 'Austin' }, 'jsonld', 'https://v.example/2')
  const judged = new Map([[pairKey(a, b), true]])
  expect(mergeCandidates([a, b], judged)).toHaveLength(1)
  expect(mergeCandidates([a, b], new Map([[pairKey(a, b), false]]))).toHaveLength(2)
})
test('resolveAmbiguous: batches into one call; bad replies are conservative (false)', async () => {
  const a = c('SXSW', { city: 'Austin' }), b = c('SXSW EDU', { city: 'Austin' })
  let calls = 0
  const client: LlmClient = { extract: async () => { calls++; return { same: [true] } } }
  expect(await resolveAmbiguous(client, new LlmBudget(5), [[a, b]])).toEqual([true])
  expect(calls).toBe(1)
  const bad: LlmClient = { extract: async () => 'garbage' }
  expect(await resolveAmbiguous(bad, new LlmBudget(5), [[a, b]])).toEqual([false])
  expect(await resolveAmbiguous(client, new LlmBudget(0), [[a, b]])).toEqual([false])
})
