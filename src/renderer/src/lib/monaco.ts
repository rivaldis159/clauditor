import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

export { monaco }

/* ---------------------------------------------------------------- TypeScript */
const ts = monaco.typescript
const compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.ReactJSX,
  allowJs: true,
  checkJs: false,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  strict: false,
  skipLibCheck: true,
  lib: ['esnext', 'dom', 'dom.iterable']
}
// Codes that only appear because Clauditor has no node_modules type information.
const ignored = [2307, 2792, 7016, 2580, 2591, 2582, 2503, 2875, 1259, 6133, 6192, 80001, 80005, 7044, 7043, 2686]
for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  d.setCompilerOptions(compilerOptions)
  d.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: ignored })
  d.setEagerModelSync(true)
}
monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: 'ignore', enableSchemaRequest: false })

/* ---------------------------------------------------------------- languages */
let extMap: Map<string, string> | null = null
let nameMap: Map<string, string> | null = null

function buildMaps() {
  extMap = new Map()
  nameMap = new Map()
  for (const lang of monaco.languages.getLanguages()) {
    for (const e of lang.extensions ?? []) if (!extMap.has(e.toLowerCase())) extMap.set(e.toLowerCase(), lang.id)
    for (const f of lang.filenames ?? []) nameMap.set(f.toLowerCase(), lang.id)
  }
  const extra: Record<string, string> = {
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.jsonc': 'json',
    '.jsonl': 'json',
    '.code-workspace': 'json',
    '.env': 'ini',
    '.gs': 'javascript',
    '.vue': 'html',
    '.svelte': 'html',
    '.astro': 'html',
    '.mq5': 'cpp',
    '.mqh': 'cpp',
    '.mq4': 'cpp',
    '.pyw': 'python',
    '.ps1': 'powershell',
    '.psm1': 'powershell',
    '.toml': 'ini',
    '.lock': 'plaintext'
  }
  for (const [e, id] of Object.entries(extra)) extMap.set(e, id)
  for (const [n, id] of Object.entries({ dockerfile: 'dockerfile', makefile: 'plaintext', '.gitignore': 'plaintext', '.env': 'ini', 'claude.md': 'markdown' })) {
    nameMap.set(n, id)
  }
}

export function languageForPath(path: string): string {
  if (!extMap || !nameMap) buildMaps()
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1).toLowerCase()
  const byName = nameMap!.get(name)
  if (byName) return byName
  const parts = name.split('.')
  for (let i = 1; i < parts.length; i++) {
    const id = extMap!.get(`.${parts.slice(i).join('.')}`)
    if (id) return id
  }
  if (name.startsWith('.env')) return 'ini'
  return 'plaintext'
}

export function languageLabel(id: string): string {
  const lang = monaco.languages.getLanguages().find((l) => l.id === id)
  return lang?.aliases?.[0] ?? id
}

/* ---------------------------------------------------------------- themes */
function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function hex(c: string): string {
  // monaco wants #rrggbb / #rrggbbaa; convert rgba() tokens
  const m = /^rgba?\(([^)]+)\)$/.exec(c)
  if (!m) return c
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim())
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${h(+r)}${h(+g)}${h(+b)}${Number(a) < 1 ? h(Number(a) * 255) : ''}`
}

const DARK_TOKENS = {
  comment: '6c6c79',
  keyword: 'f48a55',
  string: 'a9d68c',
  number: 'e8c36e',
  regexp: 'f290b2',
  type: '62d2c5',
  fn: '7fb8ff',
  constant: 'c59eff',
  tag: 'f2848f',
  attr: 'e8c36e',
  delimiter: 'a3a3ad',
  variable: 'e6e6ea',
  key: '86c2ff'
}
const LIGHT_TOKENS = {
  comment: '8e8e9b',
  keyword: 'c2501a',
  string: '3c8a2f',
  number: '9d6a07',
  regexp: 'b8336a',
  type: '0d8478',
  fn: '2563c9',
  constant: '7243cf',
  tag: 'c23447',
  attr: '9d6a07',
  delimiter: '5c5c68',
  variable: '23232a',
  key: '1f5fbf'
}

export function applyMonacoTheme(theme: 'dark' | 'light'): void {
  const t = theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS
  const accent = hex(css('--accent'))
  const bg = hex(css('--bg-2'))
  const bg1 = hex(css('--bg-1'))
  const bg3 = hex(css('--bg-3'))
  const bg4 = hex(css('--bg-4'))
  const line = hex(css('--line'))
  const lineStrong = hex(css('--line-strong'))
  const fg0 = hex(css('--fg-0'))
  const fg1 = hex(css('--fg-1'))
  const fg2 = hex(css('--fg-2'))
  const fg3 = hex(css('--fg-3'))
  const dark = theme === 'dark'
  monaco.editor.defineTheme('clauditor', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: t.variable },
      { token: 'comment', foreground: t.comment, fontStyle: 'italic' },
      { token: 'keyword', foreground: t.keyword },
      { token: 'keyword.flow', foreground: t.keyword },
      { token: 'keyword.json', foreground: t.constant },
      { token: 'string', foreground: t.string },
      { token: 'string.escape', foreground: t.regexp },
      { token: 'string.key.json', foreground: t.key },
      { token: 'string.value.json', foreground: t.string },
      { token: 'number', foreground: t.number },
      { token: 'regexp', foreground: t.regexp },
      { token: 'type', foreground: t.type },
      { token: 'type.identifier', foreground: t.type },
      { token: 'identifier', foreground: t.variable },
      { token: 'constant', foreground: t.constant },
      { token: 'predefined', foreground: t.fn },
      { token: 'annotation', foreground: t.attr },
      { token: 'delimiter', foreground: t.delimiter },
      { token: 'operator', foreground: t.delimiter },
      { token: 'tag', foreground: t.tag },
      { token: 'metatag', foreground: t.tag },
      { token: 'attribute.name', foreground: t.attr },
      { token: 'attribute.value', foreground: t.string },
      { token: 'variable', foreground: t.variable },
      { token: 'variable.predefined', foreground: t.constant },
      { token: 'key', foreground: t.key },
      { token: 'emphasis', fontStyle: 'italic' },
      { token: 'strong', fontStyle: 'bold' },
      { token: 'keyword.md', foreground: t.keyword },
      { token: 'string.link.md', foreground: t.fn }
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg0,
      'editorLineNumber.foreground': fg3,
      'editorLineNumber.activeForeground': fg1,
      'editorCursor.foreground': accent,
      'editor.lineHighlightBackground': dark ? '#ffffff07' : '#00000006',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': `${accent}40`,
      'editor.inactiveSelectionBackground': `${accent}22`,
      'editor.selectionHighlightBackground': `${accent}1c`,
      'editor.wordHighlightBackground': dark ? '#ffffff12' : '#0000000c',
      'editor.wordHighlightStrongBackground': dark ? '#ffffff1a' : '#00000012',
      'editor.findMatchBackground': `${accent}66`,
      'editor.findMatchHighlightBackground': `${accent}2e`,
      'editor.findRangeHighlightBackground': dark ? '#ffffff0a' : '#00000008',
      'editorBracketMatch.background': `${accent}22`,
      'editorBracketMatch.border': `${accent}88`,
      'editorIndentGuide.background1': line,
      'editorIndentGuide.activeBackground1': lineStrong,
      'editorWhitespace.foreground': lineStrong,
      'editorRuler.foreground': line,
      'editorGutter.background': bg,
      'editorGutter.modifiedBackground': hex(css('--git-modified')),
      'editorGutter.addedBackground': hex(css('--git-added')),
      'editorGutter.deletedBackground': hex(css('--git-deleted')),
      'editorWidget.background': bg1,
      'editorWidget.border': lineStrong,
      'editorWidget.foreground': fg0,
      'editorHoverWidget.background': bg1,
      'editorHoverWidget.border': lineStrong,
      'editorSuggestWidget.background': bg1,
      'editorSuggestWidget.border': lineStrong,
      'editorSuggestWidget.selectedBackground': bg4,
      'editorSuggestWidget.highlightForeground': accent,
      'editorSuggestWidget.focusHighlightForeground': accent,
      'list.hoverBackground': bg3,
      'list.activeSelectionBackground': bg4,
      'list.highlightForeground': accent,
      'input.background': bg,
      'input.border': lineStrong,
      'inputOption.activeBorder': accent,
      'focusBorder': `${accent}aa`,
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': dark ? '#ffffff16' : '#00000018',
      'scrollbarSlider.hoverBackground': dark ? '#ffffff26' : '#0000002a',
      'scrollbarSlider.activeBackground': `${accent}55`,
      'minimap.background': bg,
      'minimapSlider.background': dark ? '#ffffff10' : '#00000010',
      'editorOverviewRuler.border': '#00000000',
      'editorStickyScroll.background': bg,
      'editorStickyScrollHover.background': bg3,
      'editorStickyScroll.shadow': dark ? '#00000088' : '#00000022',
      'editorError.foreground': hex(css('--bad')),
      'editorWarning.foreground': hex(css('--warn')),
      'editorInfo.foreground': hex(css('--info')),
      'editorLink.activeForeground': accent,
      'diffEditor.insertedTextBackground': dark ? '#5fcf8a2e' : '#1e9a5526',
      'diffEditor.removedTextBackground': dark ? '#f2616d33' : '#d2384824',
      'diffEditor.insertedLineBackground': dark ? '#5fcf8a14' : '#1e9a5512',
      'diffEditor.removedLineBackground': dark ? '#f2616d16' : '#d2384810',
      'diffEditorGutter.insertedLineBackground': dark ? '#5fcf8a26' : '#1e9a551f',
      // Monaco paints this on the original column of inline diffs even for pure insertions
      'diffEditorGutter.removedLineBackground': '#00000000',
      'diffEditor.diagonalFill': dark ? '#ffffff0d' : '#0000000d',
      'diffEditor.unchangedRegionBackground': bg1,
      'diffEditor.unchangedRegionForeground': fg2,
      'peekView.border': accent,
      'peekViewEditor.background': bg1,
      'peekViewResult.background': bg1,
      'peekViewTitle.background': bg3
    }
  })
  monaco.editor.setTheme('clauditor')
}

/** Syntax-highlight a snippet to HTML using the active Monaco theme. */
export async function colorize(code: string, language: string): Promise<string> {
  try {
    return await monaco.editor.colorize(code, language, { tabSize: 2 })
  } catch {
    return escapeHtml(code)
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export function fileUri(path: string): monaco.Uri {
  return monaco.Uri.file(path)
}
