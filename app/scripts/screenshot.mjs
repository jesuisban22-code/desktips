/**
 * Headless render check.
 *
 *   node scripts/screenshot.mjs [url] [outfile]
 *
 * Boot `npx vite preview --port 4173` first. Software rendering is slow, so
 * pass ?fx=0&q=low for a quick look; ?fx=1 verifies the post stack still runs.
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173/?fx=0&q=low'
const out = process.argv[3] ?? 'render.png'

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1500, height: 800 } })
const errors = []
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()) })

await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 })
await page.waitForTimeout(9000)
await page.screenshot({ path: out, animations: 'disabled', timeout: 180000 })

console.log(`wrote ${out} — ${errors.length} error(s)`)
errors.slice(0, 8).forEach(e => console.log('  ' + e.slice(0, 240)))
await browser.close()
