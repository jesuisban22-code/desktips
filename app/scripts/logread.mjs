import { chromium } from 'playwright'
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 800, height: 480 } })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 90000 })
await page.waitForTimeout(Number(process.argv[3] ?? 30000))
const log = await page.evaluate(() => window.__bureauLog ?? [])
log.slice(0, 50).forEach(l => console.log(l))
console.log('--- entries:', log.length, 'errors:', errs.length)
errs.slice(0,4).forEach(e => console.log('ERR', e.slice(0,200)))
await browser.close()
