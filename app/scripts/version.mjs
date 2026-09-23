// Met la même version partout où Bureau la déclare, avant de publier.
//   node app/scripts/version.mjs 0.2.0
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const v = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) {
  console.error("usage : node app/scripts/version.mjs 0.2.0")
  process.exit(1)
}
const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const edit = (rel, fn) => { const p = path.join(app, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8"))) }

edit("package.json", s => s.replace(/("version":\s*")[^"]+"/, `$1${v}"`))
edit("src-tauri/tauri.conf.json", s => s.replace(/("version":\s*")[^"]+"/, `$1${v}"`))
edit("src-tauri/Cargo.toml", s => s.replace(/(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+"/, `$1${v}"`))
console.log(`Version ${v}. Ensuite : git commit -am "Bureau ${v}" && git tag v${v} && git push --follow-tags`)
