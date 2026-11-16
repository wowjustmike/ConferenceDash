import type { BrowserFetcher } from '../net/browser'
import { parseDateRangeText } from '../extract/eventitems'
import { toCandidateClean } from '../normalize'
import type { Candidate, SourceHealth, SourceRef } from '../types'

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
const CANDIDATES = [
  new RegExp(`${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}\\s*[-–—]\\s*${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}`, 'i'),
  new RegExp(`${MONTH}\\.?\\s+\\d{1,2}\\s*[-–—]\\s*${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}`, 'i'),
  new RegExp(`${MONTH}\\.?\\s+\\d{1,2}\\s*[-–—]\\s*\\d{1,2},?\\s+\\d{4}`, 'i'),
  new RegExp(`${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}`, 'i'),
]

/** Finds the first date range ("November 1-4, 2026") in a Moscone event page's text. */
export function parseMosconeDetail(text: string): { start: string; end: string } | null {
  for (const re of CANDIDATES) {
    const m = re.exec(text)
    const r = m ? parseDateRangeText(m[0]) : null
    if (r) return r
  }
  return null
}

/** Walks the month selector of the Moscone events calendar, collecting each event's page link. */
export async function collectMosconeLinks(browser: Pick<BrowserFetcher, 'withPage'>, url: string): Promise<{ name: string; href: string }[] | null> {
  return browser.withPage(url, async (page) => {
    await page.waitForSelector('#event_date')
    const months = await page.locator('#event_date option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))
    const found = new Map<string, string>()
    for (const m of months) {
      await page.locator('#event_date').selectOption(m)
      await page.waitForTimeout(1200)
      const links = await page.locator('.fc-event a[href^="/node/"], .fc-event a[href^="/events/"]').evaluateAll((els) => els.map((e) => ({ name: (e.textContent ?? '').trim(), href: (e as HTMLAnchorElement).getAttribute('href') ?? '' })))
      for (const l of links) if (l.name && l.href && !found.has(l.href)) found.set(l.href, l.name)
    }
    return [...found].map(([href, name]) => ({ name, href }))
  })
}

export async function fetchMoscone(
  browser: Pick<BrowserFetcher, 'withPage'>, fetchText: (url: string) => Promise<string | null>, url: string,
  defaults: { venue?: string; city?: string; state?: string }, now: () => Date,
): Promise<{ candidates: Candidate[]; health: SourceHealth }> {
  const id = 'moscone'
  const links = await collectMosconeLinks(browser, url)
  if (!links || links.length === 0) return { candidates: [], health: { id, ok: false, count: 0, error: links ? 'no events found' : 'fetch failed' } }
  const candidates: Candidate[] = []
  let failed = 0
  for (const l of links) {
    const detail = new URL(l.href, url).toString()
    const html = await fetchText(detail)
    if (html === null) { failed++; continue }
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    const range = parseMosconeDetail(text)
    if (!range) { failed++; continue }
    const source: SourceRef = { url: detail, type: 'html', fetched_at: now().toISOString() }
    const c = toCandidateClean({ name: l.name, start_date: range.start, end_date: range.end, ...defaults, official_url: detail, source })
    if (c) candidates.push(c)
  }
  return {
    candidates,
    health: candidates.length > 0 ? { id, ok: true, count: candidates.length, ...(failed ? { error: `${failed} of ${links.length} pages had no readable dates` } : {}) } : { id, ok: false, count: 0, error: 'no events found' },
  }
}
