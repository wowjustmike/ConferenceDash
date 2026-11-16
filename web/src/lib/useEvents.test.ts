import { defaultLoad } from './useEvents'

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response

afterEach(() => vi.unstubAllGlobals())

test('a plain events.json array is returned as is', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json([{ id: 'a' }])))
  expect(await defaultLoad()).toEqual([{ id: 'a' }])
})
test('a shard manifest is expanded and concatenated in order', async () => {
  const fetchMock = vi.fn(async (u: string) => {
    if (u.endsWith('events.json')) return json({ shards: ['events/2027-01.json', 'events/2027-02.json'] })
    if (u.endsWith('2027-01.json')) return json([{ id: 'jan' }])
    return json([{ id: 'feb' }])
  })
  vi.stubGlobal('fetch', fetchMock)
  expect(await defaultLoad()).toEqual([{ id: 'jan' }, { id: 'feb' }])
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
test('a failing shard rejects the whole load (no partial list)', async () => {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.endsWith('events.json') ? json({ shards: ['events/a.json', 'events/b.json'] }) : u.endsWith('a.json') ? json([{ id: 'a' }]) : json([], false))))
  await expect(defaultLoad()).rejects.toThrow()
})
