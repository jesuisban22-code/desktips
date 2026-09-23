/**
 * Drag to orbit, then screenshot.
 *   node scripts/orbit.mjs <url> <out> [dragX] [dragY]
 *
 * Geometry that intersects is often invisible from the default isometric
 * angle; a second viewpoint is the cheapest way to catch it.
 */
import { chromium } from 'playwright'

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
})
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
const errs = []
p.on('pageerror', e => errs.push(e.message))

await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForTimeout(9000)

const dx = Number(process.argv[4] ?? 0)
const dy = Number(process.argv[5] ?? 0)
if (dx || dy) {
  await p.mouse.move(700, 450)
  await p.mouse.down()
  for (let i = 1; i <= 12; i++) await p.mouse.move(700 + (dx * i) / 12, 450 + (dy * i) / 12)
  await p.mouse.up()
  await p.waitForTimeout(2500)
}

await p.screenshot({ path: process.argv[3], animations: 'disabled', timeout: 200000 })
console.log('errors:', errs.length)
await b.close()
