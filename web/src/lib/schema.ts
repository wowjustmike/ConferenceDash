import { z } from 'zod'

export const TOPICS = [
  'Tech', 'Healthcare', 'Finance', 'Gaming', 'Marketing', 'Energy', 'Media', 'Hospitality',
  'Automotive', 'Aviation', 'Retail', 'Entertainment', 'Cannabis', 'Education', 'Sports', 'Other',
] as const
export type Topic = (typeof TOPICS)[number]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const SignalSchema = z.object({
  points: z.number(),
  bars: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  evidence: z.array(z.object({ label: z.string(), family: z.string(), kind: z.string(), points: z.number(), seenAt: z.string() })),
  flags: z.array(z.string()),
})
export type Signal = z.infer<typeof SignalSchema>

export const EventSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    start_date: isoDate,
    end_date: isoDate,
    dates_confirmed: z.boolean(),
    city: z.string().min(1),
    state: z.string().min(1),
    venue: z.string(),
    organizer: z.string(),
    topics: z.array(z.enum(TOPICS)),
    est_attendance: z.number().nullable(),
    official_url: z.string().url().refine((u) => /^https?:\/\//i.test(u), { message: 'official_url must be http(s)' }),
    sources: z.array(z.object({ url: z.string(), type: z.string(), fetched_at: z.string() })),
    last_verified: isoDate,
    confidence: z.number().min(0).max(1),
    status: z.enum(['active', 'cancelled', 'past']),
    signal: SignalSchema.optional(),
    kind: z.string().optional(),
  })
  .refine((e) => e.end_date >= e.start_date, { message: 'end_date before start_date' })

export type ConfEvent = z.infer<typeof EventSchema>

export function parseEvents(raw: unknown): { events: ConfEvent[]; skipped: number } {
  if (!Array.isArray(raw)) {
    console.warn('events.json is not an array')
    return { events: [], skipped: 0 }
  }
  const events: ConfEvent[] = []
  let skipped = 0
  raw.forEach((item, i) => {
    const r = EventSchema.safeParse(item)
    if (r.success) events.push(r.data)
    else {
      skipped++
      console.warn(`Skipping event #${i}: ${r.error.issues[0]?.message ?? 'invalid'}`)
    }
  })
  return { events, skipped }
}
