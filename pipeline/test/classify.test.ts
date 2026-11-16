import { classifyKind, inWindow } from '../src/classify'

test.each([
  ['Renaissance Faire', undefined, { excluded: 'faire' }],
  ['Texas Renaissance Festival', undefined, { excluded: 'faire' }],
  ['Coachella Music Festival', undefined, { excluded: 'festival' }],
  ['Summer Food Festival', undefined, { excluded: 'festival' }],
  ['NFL Draft', undefined, { excluded: 'sports' }],
  ['Spirit Royale Cheer: Marquee Championship Los Angeles', undefined, { excluded: 'sports' }],
  ['Rock the Bay Concert Series', undefined, { excluded: 'concert' }],
  ['Holiday Party', undefined, { excluded: 'social' }],
  ['Annual Charity Gala', undefined, { excluded: 'social' }],
  ['Wedding Expo', undefined, { kind: 'expo' }],
  ['San Diego Comic-Con', undefined, { kind: 'fan_con' }],
  ['Collect-A-Con Los Angeles', undefined, { kind: 'fan_con' }],
  ['Anime Expo 2027', undefined, { kind: 'fan_con' }],
  ['CES 2027', 'trade show', { kind: 'trade_show' }],
  ['NAB Show', undefined, { kind: 'trade_show' }],
  ['LA Auto Show 2026', undefined, { kind: 'trade_show' }],
  ['Natural Products Expo West', undefined, { kind: 'expo' }],
  ['National Restaurant Association Convention', undefined, { kind: 'convention' }],
  ['Black Hat USA', undefined, { kind: 'conference' }],
  ['JSNation US', undefined, { kind: 'conference' }],
  ['Cloud Security Summit', undefined, { kind: 'conference' }],
  ['MJBizCon', undefined, { kind: 'conference' }],
  ['Springfield Gathering', undefined, { unknown: true }],
  ["Tonight's Conversation: LIVE & UNCUT Los Angeles", undefined, { unknown: true }],
])('classifyKind(%s)', (name, hint, expected) => {
  expect(classifyKind(name as string, hint as string | undefined)).toEqual(expected)
})
test('a music/arts/food festival wins even when the name also says Comic Con', () => {
  expect(classifyKind('Comic Con Rock Festival')).toEqual({ excluded: 'festival' })
})
test('convention words override social words ("Holiday Gift Expo" is an expo)', () => {
  expect(classifyKind('Holiday Gift Expo')).toEqual({ kind: 'expo' })
})
const w = { start: '2026-11-15', end: '2027-12-31' }
test('inWindow is inclusive and overlap-based', () => {
  expect(inWindow({ start_date: '2026-11-10', end_date: '2026-11-15' }, w)).toBe(true)
  expect(inWindow({ start_date: '2026-11-01', end_date: '2026-11-14' }, w)).toBe(false)
  expect(inWindow({ start_date: '2027-12-31', end_date: '2028-01-02' }, w)).toBe(true)
  expect(inWindow({ start_date: '2028-01-01', end_date: '2028-01-02' }, w)).toBe(false)
  expect(inWindow({ start_date: '2027-03-01', end_date: '2027-03-02' }, w)).toBe(true)
})

test.each([
  ['Craft Brewers Conference', { kind: 'conference' }],
  ['Esports Championship Summit', { kind: 'conference' }],
  ['National Cheer Coaches Conference', { kind: 'conference' }],
  ['Pollstar Live! Concert Industry Conference', { kind: 'conference' }],
  ['Boxing Industry Expo', { kind: 'expo' }],
  ['Wine Industry Network Wine Festival Expo', { kind: 'expo' }],
  ['World Tour Operators Summit', { kind: 'conference' }],
  ['Marathon Oil Investor Forum', { kind: 'conference' }],
  ['Texas Renaissance Festival', { excluded: 'faire' }],
  ['NFL Draft', { excluded: 'sports' }],
])('professional-event words beat exclusion words: %s', (name, expected) => {
  expect(classifyKind(name as string)).toEqual(expected)
})
