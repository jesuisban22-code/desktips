/**
 * Contact sheet: render several pieces at several angles into one image grid.
 *   node scripts/sheet.mjs <base> <out.png> <piece>[,piece...] [angles]
 */
import { chromium } from 'playwright'
const base = process.argv[2], out = process.argv[3]
const pieces = process.argv[4].split(',')
const angles = (process.argv[5] ?? '35:18,140:16,-55:10').split(',').map(s => s.split(':'))
const rOv = process.argv[6] ?? ''
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
})
const shots = []
for (const piece of pieces) {
  for (const [a, e] of angles) {
    const p = await b.newPage({ viewport: { width: 560, height: 480 } })
    const errs = []
    p.on('pageerror', x => errs.push(x.message))
    await p.goto(`${base}?debug=piece&p=${piece}&a=${a}&e=${e}${rOv ? `&r=${rOv}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await p.waitForTimeout(5000)
    const f = `/tmp/_sheet_${piece}_${a}_${e}.png`
    await p.screenshot({ path: f, animations: 'disabled', timeout: 120000 })
    shots.push([piece, a, e, f, errs.length])
    await p.close()
  }
}
await b.close()
console.log(JSON.stringify({ out, cols: angles.length, shots }))
