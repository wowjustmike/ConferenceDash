// Builds a single self-contained HTML file (inline CSS, inline JS, embedded events) for hosting as an Artifact.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
const index = readFileSync(join(dist, 'index.html'), 'utf8')
const css = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="\.?\/?([^"]+)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8')).join('\n')
const js = [...index.matchAll(/<script[^>]+src="\.?\/?([^"]+)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8')).join('\n')
if (!css || !js) throw new Error('could not find the built CSS/JS in dist/index.html')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
let events = readJson('../data/events.json')
if (!Array.isArray(events) && Array.isArray(events.shards)) events = events.shards.flatMap((s) => readJson(join('../data', s)))

const LINE_SEPARATORS = new RegExp('[\\u2028\\u2029]', 'g')
const safeJson = JSON.stringify(events).replace(/</g, '\\u003c').replace(LINE_SEPARATORS, '')
const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=.*$/gm, '')
const html = `<title>ConferenceDash</title>
<style>${css}</style>
<div id="root"></div>
<script>window.__CONFERENCEDASH_EVENTS__ = ${safeJson};</script>
<script type="module">${safeJs}</script>
`
mkdirSync('dist-artifact', { recursive: true })
writeFileSync('dist-artifact/dashboard.html', html)
console.log(`dashboard.html: ${(html.length / 1024).toFixed(0)} KB, ${events.length} events`)
