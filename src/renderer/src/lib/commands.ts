export interface Command {
  id: string
  title: string
  category?: string
  keys?: string
  run: () => void | Promise<void>
  when?: () => boolean
  /** let the key reach a focused text input/Monaco instead of running the command */
  allowInInput?: boolean
}

const registry = new Map<string, Command>()

export function registerCommands(cmds: Command[]): void {
  for (const c of cmds) registry.set(c.id, c)
}

export function allCommands(): Command[] {
  return [...registry.values()].filter((c) => !c.when || c.when())
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id)
}

export function runCommand(id: string): void {
  const c = registry.get(id)
  if (c && (!c.when || c.when())) void c.run()
}

const CODE_NAMES: Record<string, string> = {
  Backquote: '`',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'"
}

export function eventToKeys(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  let k = e.key
  if (CODE_NAMES[e.code]) k = CODE_NAMES[e.code]
  else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5)
  else if (k.length === 1) k = k.toUpperCase()
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return ''
  parts.push(k)
  return parts.join('+')
}

function inTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.closest('.monaco-editor')) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || !!el.closest('.xterm')
}

export function installKeybindings(): () => void {
  const handler = (e: KeyboardEvent) => {
    const keys = eventToKeys(e)
    if (!keys) return
    for (const c of registry.values()) {
      if (!c.keys) continue
      const variants = c.keys.split('|')
      if (!variants.includes(keys)) continue
      if (c.when && !c.when()) continue
      if (inTextInput(e.target) && !c.allowInInput && !keys.startsWith('Ctrl')) continue
      if (e.target instanceof HTMLElement && e.target.closest('.xterm') && !c.allowInInput && !/^(Ctrl\+(Shift\+)?(P|`|J|B)|F1|Ctrl\+Alt\+B)$/.test(keys)) continue
      e.preventDefault()
      e.stopPropagation()
      void c.run()
      return
    }
  }
  window.addEventListener('keydown', handler, true)
  return () => window.removeEventListener('keydown', handler, true)
}

export function prettyKeys(keys?: string): string[] {
  if (!keys) return []
  return keys.split('|')[0].split('+')
}
