import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
mkdirSync('public', { recursive: true })
copyFileSync('../data/events.json', 'public/events.json')
// A sharded export keeps its monthly files in data/events/.
rmSync('public/events', { recursive: true, force: true })
if (existsSync('../data/events')) cpSync('../data/events', 'public/events', { recursive: true })
