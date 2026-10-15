// xterm.js instances live outside React so they survive panel toggles and tab switches.
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { invoke, send } from '@/lib/ipc'
import { useApp } from '@/state/app'

interface Instance {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  el: HTMLDivElement
  opened: boolean
  webgl: WebglAddon | null
}

const instances = new Map<string, Instance>()
const pending = new Map<string, string[]>()

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function terminalTheme(): ITheme {
  const dark = useApp.getState().theme === 'dark'
  const base = dark
    ? {
        black: '#26262c',
        red: '#f2616d',
        green: '#5fcf8a',
        yellow: '#e8c36e',
        blue: '#6aa9ff',
        magenta: '#c59eff',
        cyan: '#4fd1c5',
        white: '#d4d4da',
        brightBlack: '#6c6c79',
        brightRed: '#ff8a93',
        brightGreen: '#82e0a6',
        brightYellow: '#f5d68d',
        brightBlue: '#94c1ff',
        brightMagenta: '#d8bcff',
        brightCyan: '#7ee3d9',
        brightWhite: '#f4f4f6'
      }
    : {
        black: '#2b2b33',
        red: '#c8323f',
        green: '#1a8a4a',
        yellow: '#9a6806',
        blue: '#2459c4',
        magenta: '#7243cf',
        cyan: '#0d7f75',
        white: '#d6d6dd',
        brightBlack: '#6b6b77',
        brightRed: '#e0505c',
        brightGreen: '#25a35b',
        brightYellow: '#b8820f',
        brightBlue: '#3a73e0',
        brightMagenta: '#8b5ee6',
        brightCyan: '#14998d',
        brightWhite: '#ffffff'
      }
  return {
    ...base,
    background: css('--bg-1'),
    foreground: css('--fg-0'),
    cursor: css('--accent'),
    cursorAccent: css('--bg-1'),
    selectionBackground: dark ? 'rgba(255,122,61,0.28)' : 'rgba(224,86,26,0.22)',
    scrollbarSliderBackground: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)',
    scrollbarSliderHoverBackground: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)',
    scrollbarSliderActiveBackground: css('--accent')
  }
}

export function ensureTerminal(id: string): Instance {
  let inst = instances.get(id)
  if (inst) return inst
  const s = useApp.getState().settings.terminal
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: 1.25,
    cursorBlink: s.cursorBlink,
    cursorStyle: 'bar',
    cursorWidth: 2,
    scrollback: 10000,
    smoothScrollDuration: 80,
    macOptionIsMeta: true,
    drawBoldTextInBrightColors: false,
    minimumContrastRatio: 1,
    theme: terminalTheme(),
    windowsPty: { backend: 'conpty' }
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon((_e, uri) => void invoke('app:openExternal', uri)))
  const uni = new Unicode11Addon()
  term.loadAddon(uni)
  term.unicode.activeVersion = '11'
  term.onData((d) => send('terminal:input', id, d))
  term.onResize(({ cols, rows }) => send('terminal:resize', id, cols, rows))
  // Ctrl+C copies when there is a selection, Ctrl+V pastes (Windows Terminal behaviour)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      return false
    }
    if (e.ctrlKey && e.key === 'v') {
      void navigator.clipboard.readText().then((t) => term.paste(t))
      return false
    }
    if (e.ctrlKey && (e.key === 'p' || e.key === 'j' || e.key === 'b' || e.key === '`' || e.key === ',')) return false
    return true
  })
  const el = document.createElement('div')
  el.className = 'xterm-host'
  inst = { term, fit, search, el, opened: false, webgl: null }
  instances.set(id, inst)
  const buffered = pending.get(id)
  if (buffered) {
    for (const d of buffered) term.write(d)
    pending.delete(id)
  }
  return inst
}

export function attachTerminal(id: string, container: HTMLElement): Instance {
  const inst = ensureTerminal(id)
  if (inst.el.parentElement !== container) container.appendChild(inst.el)
  if (!inst.opened) {
    inst.term.open(inst.el)
    inst.opened = true
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        inst!.webgl = null
      })
      inst.term.loadAddon(webgl)
      inst.webgl = webgl
    } catch {
      /* DOM renderer fallback */
    }
  }
  requestAnimationFrame(() => fitTerminal(id))
  return inst
}

export function fitTerminal(id: string): void {
  const inst = instances.get(id)
  if (!inst || !inst.opened || !inst.el.isConnected || inst.el.clientWidth < 20) return
  try {
    inst.fit.fit()
  } catch {
    /* not visible */
  }
}

export function writeTerminal(id: string, data: string): void {
  const inst = instances.get(id)
  if (inst) inst.term.write(data)
  else {
    const list = pending.get(id) ?? []
    list.push(data)
    pending.set(id, list)
  }
}

export function focusTerminal(id: string): void {
  instances.get(id)?.term.focus()
}

export function clearTerminal(id: string): void {
  instances.get(id)?.term.clear()
}

export function findInTerminal(id: string, q: string, back = false): void {
  const inst = instances.get(id)
  if (!inst || !q) return
  if (back) inst.search.findPrevious(q)
  else inst.search.findNext(q)
}

export function disposeTerminal(id: string): void {
  const inst = instances.get(id)
  if (!inst) return
  inst.term.dispose()
  inst.el.remove()
  instances.delete(id)
}

/** Claude's fonts arrived (or changed after a Claude update): measure the cell size again. */
export function remeasureTerminals(): void {
  const family = useApp.getState().settings.terminal.fontFamily
  for (const [id, inst] of instances) {
    // xterm only re-measures when the option value changes
    inst.term.options.fontFamily = `${family}, monospace`
    inst.term.options.fontFamily = family
    inst.term.clearTextureAtlas()
    fitTerminal(id)
  }
}

export function refreshTerminalOptions(): void {
  const s = useApp.getState().settings.terminal
  const theme = terminalTheme()
  for (const [id, inst] of instances) {
    inst.term.options.theme = theme
    inst.term.options.fontFamily = s.fontFamily
    inst.term.options.fontSize = s.fontSize
    inst.term.options.cursorBlink = s.cursorBlink
    fitTerminal(id)
  }
}
