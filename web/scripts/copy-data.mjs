import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync('public', { recursive: true })
copyFileSync('../data/events.json', 'public/events.json')
