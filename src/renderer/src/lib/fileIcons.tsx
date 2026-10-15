import manifest from 'material-icon-theme/dist/material-icons.json'
import { useApp } from '@/state/app'

// Every SVG of the Material Icon Theme becomes a hashed asset URL; <img> loads them lazily.
const svgUrls = import.meta.glob('../../../../node_modules/material-icon-theme/icons/*.svg', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

const urlById = new Map<string, string>()
for (const [p, url] of Object.entries(svgUrls)) {
  const name = p.slice(p.lastIndexOf('/') + 1, -4)
  urlById.set(name, url)
}

type Dict = Record<string, string>
interface Manifest {
  iconDefinitions: Record<string, { iconPath: string }>
  file: string
  folder: string
  folderExpanded: string
  fileExtensions: Dict
  fileNames: Dict
  folderNames: Dict
  folderNamesExpanded: Dict
  languageIds: Dict
  light?: { fileExtensions?: Dict; fileNames?: Dict; folderNames?: Dict; folderNamesExpanded?: Dict }
}
const m = manifest as unknown as Manifest

function urlFor(iconId: string | undefined): string | undefined {
  if (!iconId) return undefined
  const def = m.iconDefinitions[iconId]
  if (def) {
    const file = def.iconPath.slice(def.iconPath.lastIndexOf('/') + 1, -4)
    const u = urlById.get(file)
    if (u) return u
  }
  return urlById.get(iconId)
}

// extension → language id fallbacks for common files missing from fileExtensions
const LANG_BY_EXT: Dict = {
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  py: 'python',
  html: 'html',
  css: 'css',
  php: 'php',
  java: 'java',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  sh: 'shellscript',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  bat: 'bat'
}

export function fileIconUrl(name: string, light: boolean): string {
  const lower = name.toLowerCase()
  const lightMap = light ? m.light : undefined
  let id = lightMap?.fileNames?.[lower] ?? m.fileNames[lower]
  if (!id) {
    // longest matching multi-part extension first: e.g. "d.ts", "spec.ts", "ts"
    const parts = lower.split('.')
    for (let i = 1; i < parts.length && !id; i++) {
      const ext = parts.slice(i).join('.')
      id = lightMap?.fileExtensions?.[ext] ?? m.fileExtensions[ext]
      if (!id && i === parts.length - 1) {
        const lang = LANG_BY_EXT[ext]
        if (lang) id = m.languageIds[lang]
      }
    }
  }
  return urlFor(id) ?? urlFor(m.file) ?? ''
}

export function folderIconUrl(name: string, open: boolean, light: boolean): string {
  const lower = name.toLowerCase()
  const lightMap = light ? m.light : undefined
  const id = open
    ? (lightMap?.folderNamesExpanded?.[lower] ?? m.folderNamesExpanded[lower] ?? m.folderExpanded)
    : (lightMap?.folderNames?.[lower] ?? m.folderNames[lower] ?? m.folder)
  return urlFor(id) ?? ''
}

export function FileIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const light = useApp((s) => s.theme === 'light')
  const src = fileIconUrl(name, light)
  return <img className={className ? `ficon ${className}` : 'ficon'} src={src} width={size} height={size} alt="" draggable={false} />
}

export function FolderIcon({ name, open, size = 16 }: { name: string; open: boolean; size?: number }) {
  const light = useApp((s) => s.theme === 'light')
  return <img className="ficon" src={folderIconUrl(name, open, light)} width={size} height={size} alt="" draggable={false} />
}
