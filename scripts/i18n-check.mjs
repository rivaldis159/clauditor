// Translation check: every English source string used with t()/tn()/t.n()/tk() must have an
// Indonesian entry, and no Indonesian text may be left hard-coded in the UI.
// usage: node scripts/i18n-check.mjs [--files a.tsx,b.ts] [--unused]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const args = process.argv.slice(2)
const only = args.includes('--files') ? args[args.indexOf('--files') + 1].split(',').map((f) => path.resolve(root, f)) : null
const showUnused = args.includes('--unused')

// ---- load the Indonesian dictionary per area (to spot conflicting duplicates)
const idDir = path.join(root, 'src/shared/i18n/id')
const areas = {}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'))
for (const f of fs.readdirSync(idDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')) {
  const out = path.join(tmp, f.replace(/\.ts$/, '.mjs'))
  await build({ entryPoints: [path.join(idDir, f)], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' })
  const mod = await import(pathToFileURL(out).href)
  areas[f.replace(/\.ts$/, '')] = Object.values(mod)[0]
}
fs.rmSync(tmp, { recursive: true, force: true })
const dict = {}
const conflicts = []
for (const [area, entries] of Object.entries(areas)) {
  for (const [k, v] of Object.entries(entries)) {
    if (k in dict && dict[k].value !== v) conflicts.push(`"${k}": ${dict[k].area}="${dict[k].value}" vs ${area}="${v}"`)
    dict[k] = { value: v, area }
  }
}

// ---- collect source files
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}
const files = (only ?? [...walk(path.join(root, 'src/renderer/src')), ...walk(path.join(root, 'src/main')), ...walk(path.join(root, 'src/shared'))]).filter(
  (f) => !f.includes(`${path.sep}i18n${path.sep}`) && !f.endsWith(`${path.sep}i18n.ts`)
)

// a string literal: '...', "..." or `...` without ${}
const STR = String.raw`(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|\x60((?:[^\x60\\$]|\\.)*)\x60)`
const unescape = (s) => s.replace(/\\(['"\x60\\])/g, '$1').replace(/\\n/g, '\n')
const pick = (m, i) => unescape(m[i] ?? m[i + 1] ?? m[i + 2] ?? '')
const reSingle = new RegExp(String.raw`(?:(?<![\w.])(?:t|tk)|(?<![\w.])t\.rich)\(\s*` + STR, 'g')
const rePlural = new RegExp(String.raw`(?<![\w])(?:tn|t\.n)\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*` + STR + String.raw`\s*,\s*` + STR, 'g')

const used = new Map()
const add = (key, where) => {
  if (!used.has(key)) used.set(key, where)
}
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(root, file)
  for (const m of src.matchAll(reSingle)) add(pick(m, 1), rel)
  for (const m of src.matchAll(rePlural)) {
    add(pick(m, 4), rel) // the `other` form is the dictionary key
  }
}

const missingKeys = [...used].filter(([k]) => !(k in dict))

// ---- leftover Indonesian heuristics (string literals and JSX text in UI code)
const WORDS = 'yang|dan|untuk|dengan|tidak|berkas|sesi|buka|tutup|simpan|batal|hapus|ganti|cari|tampilkan|sembunyikan|pengaturan|perubahan|sedang|belum|sudah|gagal|berhasil|semua|kosong|pilih|salin|jalankan|hentikan|izin|tolak|terima|lanjutkan|mulai|proyek|menunggu|selesai|bekerja|langkah|tulis|pesan|kirim|masuk|keluar|bawaan|otomatis|rencana|baris|detik|menit|jam|hari|lalu|baru saja|dari|ke|di|ini|itu|akan|bisa|perlu|atau|tanpa|lewat|saat|setelah|sebelum|terakhir|ditemukan|tersedia|berjalan|dibuka|diubah|disimpan|dihapus|ditolak|diterima|terminal baru|tampilan|lainnya|ringkasan|putar ulang|tinjau|mengedit|membaca|membuat|menjalankan|mencari|memperbarui|menugaskan'
const reIndo = new RegExp(String.raw`\b(${WORDS})\b`, 'i')
const leftovers = []
for (const file of files.filter((f) => f.includes(`${path.sep}renderer${path.sep}`) || f.includes(`${path.sep}main${path.sep}`))) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
    if (/^\s*(\*|\/\/|import |export \* )/.test(line)) return
    const literals = [...code.matchAll(new RegExp(STR, 'g'))].map((m) => pick(m, 1))
    const jsxText = [...code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1])
    for (const s of [...literals, ...jsxText]) {
      if (!/\s/.test(s.trim()) && !/^[A-Z][a-z]+$/.test(s.trim())) continue // identifiers, class names
      if (reIndo.test(s) && !/[{}=;]/.test(s) && !(s in dict)) {
        // English source strings that happen to contain short words like "di" are rare; flag for review
        leftovers.push(`${path.relative(root, file)}:${i + 1}  ${s.trim().slice(0, 90)}`)
        break
      }
    }
  })
}

const unused = Object.keys(dict).filter((k) => !used.has(k))
console.log(`dictionary: ${Object.keys(dict).length} entries | used keys: ${used.size} | files: ${files.length}`)
if (conflicts.length) console.log(`\nCONFLICTING DUPLICATES (${conflicts.length}):\n  ${conflicts.join('\n  ')}`)
if (missingKeys.length) console.log(`\nMISSING INDONESIAN (${missingKeys.length}):\n  ${missingKeys.map(([k, w]) => `${w}: ${JSON.stringify(k)}`).join('\n  ')}`)
if (leftovers.length) console.log(`\nPOSSIBLE HARD-CODED INDONESIAN (${leftovers.length}):\n  ${leftovers.join('\n  ')}`)
if (showUnused && unused.length) console.log(`\nUNUSED (may be dynamic) (${unused.length}):\n  ${unused.map((k) => JSON.stringify(k)).join('\n  ')}`)
if (!conflicts.length && !missingKeys.length && !leftovers.length) console.log('OK')
process.exitCode = missingKeys.length || conflicts.length ? 1 : 0
