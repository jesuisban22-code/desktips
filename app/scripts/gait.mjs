import { build } from 'esbuild'
import { writeFileSync } from 'fs'
import { execFileSync } from 'child_process'

const out = await build({
  entryPoints: ['scripts/gait-probe.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  loader: { '.tsx': 'tsx' }, jsx: 'automatic',
  logLevel: 'error',
})
writeFileSync('node_modules/.gait-probe.mjs', out.outputFiles[0].text)
try {
  const r = execFileSync(process.execPath, ['node_modules/.gait-probe.mjs'], { encoding: 'utf8' })
  process.stdout.write(r)
} catch (e) {
  process.stdout.write(e.stdout ?? '')
  process.stderr.write(e.stderr ?? '')
  process.exit(e.status ?? 1)
}
