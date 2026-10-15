// Windows-first path helpers for the renderer (no Node path module in a sandboxed renderer).

export const isWin = navigator.userAgent.includes('Windows')
export const SEP = isWin ? '\\' : '/'

export function normalize(p: string): string {
  if (!p) return p
  let s = isWin ? p.replace(/\//g, '\\') : p
  s = s.replace(isWin ? /\\{2,}/g : /\/{2,}/g, SEP)
  if (s.length > 3 && s.endsWith(SEP)) s = s.slice(0, -1)
  return s
}

export function key(p: string): string {
  const n = normalize(p)
  return isWin ? n.toLowerCase() : n
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return key(a) === key(b)
}

export function basename(p: string): string {
  const n = normalize(p)
  const i = n.lastIndexOf(SEP)
  return i === -1 ? n : n.slice(i + 1) || n
}

export function dirname(p: string): string {
  const n = normalize(p)
  const i = n.lastIndexOf(SEP)
  if (i <= 0) return n
  const d = n.slice(0, i)
  return /^[A-Za-z]:$/.test(d) ? `${d}${SEP}` : d
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i).toLowerCase()
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join(SEP))
}

export function isInside(child: string, parent: string): boolean {
  const c = key(child)
  const p = key(parent)
  return c !== p && c.startsWith(p.endsWith(SEP) ? p : p + SEP)
}

export function isSameOrInside(child: string, parent: string): boolean {
  return samePath(child, parent) || isInside(child, parent)
}

export function relative(from: string, to: string): string {
  const f = normalize(from)
  const t = normalize(to)
  if (samePath(f, t)) return ''
  if (isInside(t, f)) return t.slice(f.length + (f.endsWith(SEP) ? 0 : 1))
  return t
}

/** Display path relative to the workspace when possible. */
export function displayPath(p: string, root: string | null | undefined): string {
  if (root && isInside(p, root)) return relative(root, p)
  return normalize(p)
}

/** Folder of a file as a faint hint beside its name: empty for files at the workspace root. */
export function dirHint(file: string, root: string | null | undefined): string {
  const dir = dirname(file)
  return root && samePath(dir, root) ? '' : displayPath(dir, root)
}

export function segments(p: string): string[] {
  return normalize(p).split(SEP).filter(Boolean)
}

export function fileUrl(p: string): string {
  return `clauditor-file://local/${encodeURI(normalize(p).replace(/\\/g, '/'))}`
}
