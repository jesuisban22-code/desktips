/** Poll the actor debug surface to verify agents actually reach stations. */
import { chromium } from 'playwright'
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 520 } })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForTimeout(3000)
const seen = {}
for (let i = 0; i < 40; i++) {
  const snap = await page.evaluate(() => window.__bureau ?? {})
  for (const [id, a] of Object.entries(snap)) {
    seen[id] ??= { stations: new Set(), states: new Set(), maxQ: 0, maxSpeed: 1, carried: 0 }
    seen[id].stations.add(a.station)
    seen[id].states.add(a.state)
    seen[id].maxQ = Math.max(seen[id].maxQ, a.queue)
    seen[id].maxSpeed = Math.max(seen[id].maxSpeed, a.speed)
    seen[id].carried = Math.max(seen[id].carried, a.carrying)
  }
  await page.waitForTimeout(1500)
}
for (const [id, v] of Object.entries(seen)) {
  console.log(`${id}: stations=[${[...v.stations].join(', ')}] states=[${[...v.states].join(', ')}] maxQueue=${v.maxQ} maxSpeed=${v.maxSpeed} maxCarried=${v.carried}`)
}
console.log('errors:', errs.length)
errs.slice(0,5).forEach(e=>console.log(' ', e.slice(0,200)))
await browser.close()
