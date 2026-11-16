import type { BrowserFetcher } from '../net/browser'

/** Clicks a "Load More" control until it disappears (or `maxClicks`), then returns the full page HTML. */
export async function fetchLoadMore(
  browser: Pick<BrowserFetcher, 'withPage'>, url: string, o: { text?: RegExp; maxClicks?: number; settleMs?: number; itemSelector?: string } = {},
): Promise<{ html: string; clicks: number } | null> {
  return browser.withPage(url, async (page) => {
    const item = o.itemSelector ?? '.eventItem'
    const more = page.getByText(o.text ?? /load more events/i).first()
    let clicks = 0
    for (; clicks < (o.maxClicks ?? 25); clicks++) {
      if ((await more.count()) === 0 || !(await more.isVisible().catch(() => false))) break
      const before = await page.locator(item).count()
      await more.dispatchEvent('click')
      const grew = await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel as string).length > (n as number), [item, before] as const, { timeout: 6000 }).then(() => true).catch(() => false)
      if (!grew) break
      await page.waitForTimeout(o.settleMs ?? 400)
    }
    return { html: await page.content(), clicks }
  })
}
