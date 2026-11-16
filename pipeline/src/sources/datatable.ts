import * as cheerio from 'cheerio'
import type { BrowserFetcher } from '../net/browser'
import { normalizeDate, toCandidateClean } from '../normalize'
import type { Candidate, SourceRef } from '../types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function dateFrom(scope: cheerio.Cheerio<never>, sel: { month: string; day: string; year: string }): string | null {
  const m = MONTHS.indexOf(scope.find(sel.month).first().text().trim().slice(0, 3).toLowerCase())
  const d = Number(scope.find(sel.day).first().text().trim())
  const y = Number(scope.find(sel.year).first().text().trim())
  if (m < 0 || !d || !y) return null
  return normalizeDate(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
}

/** Parses DataTables event rows with `.list-view-title` links and separate month/day/year blocks for start and end (McCormick Place layout). */
export function parseDataTableRows(rows: string[], source: SourceRef, defaults: { venue?: string; city?: string; state?: string } = {}): Candidate[] {
  const out: Candidate[] = []
  for (const html of rows) {
    const $ = cheerio.load(`<table><tbody>${html}</tbody></table>`)
    const a = $('.list-view-title').first()
    const name = a.text().replace(/\s+/g, ' ').trim()
    const root = $('tr').first() as unknown as cheerio.Cheerio<never>
    const start = dateFrom(root, { month: '[class*="start-month-word"]', day: '[class*="start-day-number"]', year: '[class*="start-year"]' })
      ?? dateFrom(root, { month: '[class*="month-word"]', day: '[class*="day-number"]', year: '[class*="year"]' })
    const end = dateFrom(root, { month: '[class*="end-month-word"]', day: '[class*="end-day-number"]', year: '[class*="end-year"]' }) ?? start
    if (!name || !start || !end) continue
    let url: string | undefined
    try { const u = new URL(a.attr('href') ?? '', source.url); if (u.protocol === 'http:' || u.protocol === 'https:') url = u.toString() } catch { /* none */ }
    const c = toCandidateClean({ name, start_date: start, end_date: end, ...defaults, ...(url ? { official_url: url } : {}), source })
    if (c) out.push(c)
  }
  return out
}

/** Shows up to 100 rows per page in a DataTables list and returns every row's HTML (paging if the table is longer). */
export async function fetchDataTable(browser: Pick<BrowserFetcher, 'withPage'>, url: string, o: { maxPages?: number } = {}): Promise<{ rows: string[]; total: number | null } | null> {
  return browser.withPage(url, async (page) => {
    await page.waitForSelector('table.dataTable tbody tr', { timeout: 15000 })
    const select = page.locator('.dataTables_length select, select[name$="_length"]').first()
    if ((await select.count()) > 0) await select.selectOption('100').catch(() => {})
    await page.waitForTimeout(800)
    const info = (await page.locator('.dataTables_info').first().textContent().catch(() => '')) ?? ''
    const total = /of\s+(\d+)/.exec(info)?.[1]
    const rows: string[] = []
    const seen = new Set<string>()
    for (let p = 0; p < (o.maxPages ?? 10); p++) {
      for (const r of await page.locator('table.dataTable tbody tr').evaluateAll((els) => els.map((e) => e.outerHTML))) if (!seen.has(r)) { seen.add(r); rows.push(r) }
      const next = page.locator('.paginate_button.next:not(.disabled)').first()
      if ((await next.count()) === 0) break
      await next.click()
      await page.waitForTimeout(500)
    }
    return { rows, total: total ? Number(total) : null }
  })
}
