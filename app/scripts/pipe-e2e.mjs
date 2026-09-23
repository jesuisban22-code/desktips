/**
 * Replays a recorded session through the real ingest path and asserts the room
 * would have something to show. No canvas: a software renderer takes seconds
 * per frame and starves the timers, which makes a perfectly healthy pipeline
 * look dead.
 *
 *   node scripts/pipe-e2e.mjs <base-url> <replay-path> [maxSeconds]
 */
import { chromium } from 'playwright'
const base = process.argv[2]
const replay = process.argv[3]
const maxSecs = Number(process.argv[4] ?? 90)

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
})
const p = await b.newPage({ viewport: { width: 900, height: 700 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)) })
p.on('response', r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`) })

await p.goto(`${base}?replay=${replay}&debug=pipe`, { waitUntil: 'commit', timeout: 60000 })

const t0 = Date.now()
let snap = null
while ((Date.now() - t0) / 1000 < maxSecs) {
  await p.waitForTimeout(2000)
  snap = await p.evaluate(() => ({
    replay: window.__replay ?? null,
    store: window.__bureauStore?.() ?? null,
  }))
  if (snap?.replay && snap.replay.fired >= snap.replay.loaded) break
}

const r = snap?.replay ?? {}
const s = snap?.store ?? {}
const agents = Object.keys(s.agents ?? {})
const subs = agents.filter(a => !a.endsWith(':main'))

console.log(`replay      : ${r.fired}/${r.loaded} events delivered (${r.starts} start)`)
console.log(`ingested    : ${s.eventCount}  ignored: ${s.ignored}`)
console.log(`agents      : ${agents.length}  (${subs.length} sub-agent)`)
console.log(`             ${agents.join(', ')}`)
console.log(`statuses    : ${JSON.stringify(s.agents)}`)
console.log(`errors      : ${errs.length}`)
errs.slice(0, 6).forEach(e => console.log('  ERR', e.slice(0, 200)))

const fail = []
if (!r.loaded) fail.push('replay file did not load')
if (r.fired < r.loaded) fail.push(`only ${r.fired}/${r.loaded} events delivered`)
if ((s.eventCount ?? 0) < r.loaded * 0.5) fail.push('most events never reached the store')
if (!agents.some(a => a.endsWith(':main'))) fail.push('no main agent — sub-agents would hand off to nobody')
if (subs.length === 0) fail.push('no sub-agents — the door choreography never runs')
if (errs.length) fail.push(`${errs.length} page error(s)`)

await b.close()
if (fail.length) { console.log('\nFAIL: ' + fail.join('; ')); process.exit(1) }
console.log('\nOK')
