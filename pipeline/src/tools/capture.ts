import { join } from 'node:path'
import { config } from '../config'
import { openDb } from '../db/db'
import { saveToInbox } from '../inbox'
import { createFetcher } from '../net/http'
import { createBrowserFetcher } from '../net/browser'

// npm run capture -- <url> [--source id] [--wait "text"] [--scrolls n] [--links]
async function main() {
  const a = process.argv.slice(2)
  const url = a[0]
  if (!url) throw new Error('usage: npm run capture -- <url> [--source id] [--wait text] [--scrolls n] [--links]')
  const opt = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
  const fetcher = createFetcher({ userAgent: config.userAgent, cacheDir: join(config.outDir, '../.cache') })
  const browser = createBrowserFetcher({ userAgent: config.userAgent, canFetch: fetcher.canFetch })
  const r = await browser.render(url, { waitForText: opt('--wait'), scrolls: Number(opt('--scrolls') ?? 0) })
  await browser.close()
  if (!r) { console.log(`SKIPPED (blocked, unreachable or timed out): ${url}`); process.exit(2) }
  const db = openDb(config.dbPath)
  const item = saveToInbox(db, join(config.outDir, '../inbox'), { url: r.finalUrl, sourceId: opt('--source') ?? new URL(url).host, text: r.text })
  console.log(`inbox #${item.id}: ${r.text.length} chars -> ${item.path}`)
  if (a.includes('--links')) {
    const links = [...r.html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([^<]{3,80})</g)].map((m) => `${m[2].trim()} -> ${m[1]}`)
    console.log([...new Set(links)].slice(0, 80).join('\n'))
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
