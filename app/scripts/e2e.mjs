/**
 * End-to-end check: real events in, agents moving out.
 *   node scripts/e2e.mjs <url> [seconds]
 *
 * Reports what the store ingested, what the room did with it, and any page
 * error. A green build proves none of this; only running it does.
 */
import { chromium } from 'playwright'
const url = process.argv[2]
const secs = Number(process.argv[3] ?? 30)

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
})
const p = await b.newPage({ viewport: { width: 900, height: 620 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)) })
p.on('response', r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`) })

await p.goto(url, { waitUntil: 'commit', timeout: 60000 })
await p.waitForTimeout(6000)

const seen = new Set()
let last = ''
const t0 = Date.now()
while ((Date.now() - t0) / 1000 < secs) {
  const snap = await p.evaluate(() => {
    const b = window.__bureau ?? {}
    const st = window.__bureauStore?.()
    return {
      actors: Object.entries(b).map(([id, a]) => ({ id, state: a.state, station: a.station, q: a.queue })),
      agents: st ? Object.keys(st.agents ?? {}).length : null,
      events: st ? (st.eventCount ?? null) : null,
    }
  }).catch(() => null)
  if (!snap) break
  for (const a of snap.actors) seen.add(`${a.id}`)
  const line = snap.actors.map(a => `${a.id.slice(0, 8)}:${a.state}@${a.station}(q${a.q})`).join('  ')
  if (line !== last && line) { console.log(`t+${((Date.now() - t0) / 1000).toFixed(0)}s  ${line}`); last = line }
  await p.waitForTimeout(1200)
}

const final = await p.evaluate(() => {
  const st = window.__bureauStore?.()
  return {
    agents: st ? Object.keys(st.agents ?? {}) : [],
    events: st?.eventCount ?? null,
    ignored: st?.ignored ?? null,
  }
}).catch(() => ({ agents: [], events: null, ignored: null }))

console.log('\ndistinct actors seen :', seen.size, [...seen].map(s => s.slice(0, 10)).join(', '))
console.log('agents in store      :', final.agents.length, final.agents.map(s => s.slice(0, 10)).join(', '))
console.log('events ingested      :', final.events, ' ignored:', final.ignored)
console.log('page errors          :', errs.length)
errs.slice(0, 5).forEach(e => console.log('  ERR', e.slice(0, 200)))
await p.screenshot({ path: process.env.E2E_SHOT ?? '/tmp/e2e.png', timeout: 200000 })
await b.close()
process.exit(errs.length ? 1 : 0)
