import { chromium } from 'playwright'
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 800, height: 480 } })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForTimeout(2500)
let prev = ''
for (let i = 0; i < 50; i++) {
  const s = await page.evaluate(() => {
    const b = window.__bureau ?? {}
    return Object.entries(b).map(([id, a]) =>
      `${id}:${a.state}@${a.station} q=${a.queue} pos=(${a.x},${a.z})`).join(' | ')
  })
  if (s !== prev) { console.log(`t+${(i*0.6).toFixed(1)}s  ${s}`); prev = s }
  await page.waitForTimeout(600)
}
console.log('errors:', errs.length)
errs.slice(0,3).forEach(e=>console.log('ERR', e.slice(0,200)))
await browser.close()
