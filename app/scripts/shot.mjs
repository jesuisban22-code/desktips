import { chromium } from 'playwright'
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'],
})
const jobs = JSON.parse(process.argv[2])
for (const [url, out] of jobs) {
  const p = await b.newPage({ viewport: { width: 1100, height: 820 } })
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 })
  await p.waitForTimeout(6000)
  await p.screenshot({ path: out, animations: 'disabled', timeout: 200000 })
  console.log(out, 'errors:', errs.length, errs.slice(0,2).join(' | '))
  await p.close()
}
await b.close()
