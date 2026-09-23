import { chromium } from 'playwright'
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 800, height: 480 } })
const lines = []
page.on('console', m => { const t = m.text(); if (t.includes('[BUREAU]')) lines.push(t) })
page.on('pageerror', e => lines.push('ERR ' + e.message))
await page.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 90000 })
await page.waitForTimeout(Number(process.argv[3] ?? 35000))
lines.slice(0, 45).forEach(l => console.log(l.replace('[BUREAU] ', '')))
console.log('--- total', lines.length)
await browser.close()
