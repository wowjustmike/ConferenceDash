import type { Page } from 'playwright-core'

/** Clicks through a paged list, returning each item's HTML once (by id attribute), in order. */
export async function collectPaged(
  page: Page, o: { itemSelector: string; nextSelector: string; idAttr: string; maxPages: number; settleMs?: number },
): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  const snapshot = () => page.locator(o.itemSelector).evaluateAll((els, attr) => els.map((e) => ({ id: e.getAttribute(attr as string) ?? '', html: e.outerHTML })), o.idAttr)
  for (let p = 0; p < o.maxPages; p++) {
    const items = await snapshot()
    for (const it of items) if (it.id && !seen.has(it.id)) { seen.add(it.id); out.push(it.html) }
    const next = page.locator(o.nextSelector).first()
    if ((await next.count()) === 0) break
    const hidden = await next.evaluate((el) => getComputedStyle(el).display === 'none' || (el as HTMLElement).hasAttribute('disabled')).catch(() => true)
    if (hidden) break
    // The page has changed when the list of ids differs (a new page may start with an item the previous one also showed).
    const before = items.map((it) => it.id).join('\n')
    await next.dispatchEvent('click')
    const changed = await page.waitForFunction(
      ([sel, attr, prev]) => [...document.querySelectorAll(sel as string)].map((e) => e.getAttribute(attr as string) ?? '').join('\n') !== prev,
      [o.itemSelector, o.idAttr, before] as const, { timeout: 6000 },
    ).then(() => true).catch(() => false)
    if (!changed) break
    await page.waitForTimeout(o.settleMs ?? 400)
  }
  return out
}
