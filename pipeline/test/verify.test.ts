import { verifyOfficialSite } from '../src/verify'
import { LlmBudget, type LlmClient } from '../src/extract/llm'

const ev = { name: 'CES 2027', official_url: 'https://www.ces.tech', start_date: '2027-01-06', end_date: '2027-01-09', city: 'Las Vegas' }
const llm = (reply: unknown = { confirms: false, cancelled: false }) => { const c = { calls: 0, extract: async () => { c.calls++; return reply } }; return c as LlmClient & { calls: number } }
const page = (body: string) => async () => `<html><body>${body}</body></html>`

test('page stating the exact range, year and city confirms without the LLM', async () => {
  const l = llm()
  const v = await verifyOfficialSite(page('<h1>CES 2027</h1><p>January 6-9, 2027 · Las Vegas, NV</p>'), l, new LlmBudget(5), ev)
  expect(v).toMatchObject({ reachable: true, datesConfirmed: true, cancelled: false, cityMatches: true, editionYearSeen: true })
  expect(l.calls).toBe(0)
})
test('abbreviated month, en dash and ISO forms are recognized', async () => {
  const l = llm()
  expect((await verifyOfficialSite(page('Jan. 6 – 9, 2027 Las Vegas'), l, new LlmBudget(5), ev)).datesConfirmed).toBe(true)
  expect((await verifyOfficialSite(page('<time>2027-01-06</time> Las Vegas'), l, new LlmBudget(5), ev)).datesConfirmed).toBe(true)
})
test('cross-month ranges', async () => {
  const e = { ...ev, start_date: '2026-11-30', end_date: '2026-12-04' }
  expect((await verifyOfficialSite(page('Nov 30 - Dec 4, 2026 Las Vegas'), llm(), new LlmBudget(5), e)).datesConfirmed).toBe(true)
})
test('a page showing only last year\'s edition does not confirm the new one', async () => {
  const l = llm()
  const v = await verifyOfficialSite(page('CES 2026 was held January 6-9, 2026 in Las Vegas. See you next year!'), l, new LlmBudget(5), ev)
  expect(v.datesConfirmed).toBe(false)
  expect(v.editionYearSeen).toBe(false)
  expect(l.calls).toBe(0) // year not seen -> not even worth asking the model
})
test('same day numbers but a different month do not confirm', async () => {
  const v = await verifyOfficialSite(page('Join us March 6-9, 2027 in Las Vegas'), llm(), new LlmBudget(5), ev)
  expect(v.datesConfirmed).toBe(false)
})
test('cancelled / postponed wording sets cancelled', async () => {
  expect((await verifyOfficialSite(page('CES 2027 has been cancelled. Las Vegas'), llm(), new LlmBudget(5), ev)).cancelled).toBe(true)
  expect((await verifyOfficialSite(page('The 2027 event was postponed.'), llm(), new LlmBudget(5), ev)).cancelled).toBe(true)
  expect((await verifyOfficialSite(page('See our cancellation policy for 2027 tickets. January 6-9, 2027 Las Vegas'), llm(), new LlmBudget(5), ev)).cancelled).toBe(false)
})
test('unreachable site -> reachable false', async () => {
  const v = await verifyOfficialSite(async () => null, llm(), new LlmBudget(5), ev)
  expect(v).toEqual({ reachable: false, datesConfirmed: false, cancelled: false, cityMatches: false, editionYearSeen: false })
})
test('unresolved case (year seen, no date match) asks the LLM once and honors its answer', async () => {
  const l = llm({ confirms: true, cancelled: false })
  const v = await verifyOfficialSite(page('CES 2027 — the first week of the new year in Las Vegas'), l, new LlmBudget(5), ev)
  expect(l.calls).toBe(1)
  expect(v.datesConfirmed).toBe(true)
  const bad = await verifyOfficialSite(page('CES 2027 — early next year in Las Vegas'), llm('garbage'), new LlmBudget(5), ev)
  expect(bad.datesConfirmed).toBe(false)
  const none = await verifyOfficialSite(page('CES 2027 — early next year in Las Vegas'), llm({ confirms: true }), new LlmBudget(0), ev)
  expect(none.datesConfirmed).toBe(false)
})
