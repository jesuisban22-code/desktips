/**
 * Capture a sequence of frames so movement can actually be inspected.
 *   node scripts/timelapse.mjs <url> <outPrefix> <count> <intervalMs>
 */
import { chromium } from 'playwright'

const url = process.argv[2]
const prefix = process.argv[3] ?? '/tmp/frame'
const count = Number(process.argv[4] ?? 6)
const gap = Number(process.argv[5] ?? 2500)

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } })
const errors = []
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()) })

await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 })
await page.waitForTimeout(4000)

for (let i = 0; i < count; i++) {
  await page.screenshot({ path: `${prefix}-${String(i).padStart(2, '0')}.png`, animations: 'disabled', timeout: 180000 })
  if (i < count - 1) await page.waitForTimeout(gap)
}
console.log(`${count} frames — ${errors.length} error(s)`)
errors.slice(0, 8).forEach(e => console.log('  ' + e.slice(0, 240)))
await browser.close()
