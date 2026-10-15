import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { shell } from 'electron'
import type { FileContent, FileEntry, FsChange, FsChangeBatch, WorkspaceInfo, WriteFileOptions, WriteResult } from '@shared/types'
import { decodeBuffer, encodeText } from '../lib/text-codec'
import { rgBinary } from './search'
import { t } from '../i18n'

const MAX_TEXT_BYTES = 40 * 1024 * 1024
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.avif'])
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Directories whose churn is never interesting to the explorer or editors. */
const NOISY = [`${path.sep}node_modules${path.sep}`, `${path.sep}.git${path.sep}objects`, `${path.sep}.git${path.sep}logs`, `${path.sep}__pycache__${path.sep}`]

export class WorkspaceService extends EventEmitter {
  root: string | null = null
  private watcher: fs.FSWatcher | null = null
  private pending = new Map<string, FsChange['type']>()
  private flushTimer: NodeJS.Timeout | null = null

  open(root: string): WorkspaceInfo {
    const resolved = path.resolve(root)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(t('Folder not found: {path}', { path: resolved }))
    }
    this.close()
    this.root = resolved
    this.startWatcher(resolved)
    return { root: resolved, name: path.basename(resolved) || resolved }
  }

  close(): void {
    this.watcher?.close()
    this.watcher = null
    this.root = null
    this.pending.clear()
  }

  private startWatcher(root: string): void {
    try {
      this.watcher = fs.watch(root, { recursive: true, persistent: false }, (event, filename) => {
        if (!filename) return
        const full = path.join(root, filename.toString())
        if (NOISY.some((n) => full.includes(n))) return
        this.pending.set(full, event === 'change' ? 'change' : 'rename')
        if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(root), 90)
      })
      this.watcher.on('error', (err) => console.warn('[clauditor] watcher error', err))
    } catch (err) {
      console.warn('[clauditor] cannot watch', root, err)
    }
  }

  private flush(root: string): void {
    this.flushTimer = null
    if (root !== this.root || this.pending.size === 0) {
      this.pending.clear()
      return
    }
    const changes: FsChange[] = [...this.pending].map(([p, type]) => ({ path: p, type }))
    this.pending.clear()
    const batch: FsChangeBatch = { root, changes }
    this.emit('changed', batch)
  }

  async readDir(dir: string): Promise<FileEntry[]> {
    const dirents = await fsp.readdir(dir, { withFileTypes: true })
    const entries = await Promise.all(
      dirents.map(async (d): Promise<FileEntry | null> => {
        const full = path.join(dir, d.name)
        if (d.isSymbolicLink()) {
          try {
            const st = await fsp.stat(full)
            return { name: d.name, path: full, kind: st.isDirectory() ? 'dir' : 'file', symlink: true }
          } catch {
            return { name: d.name, path: full, kind: 'file', symlink: true }
          }
        }
        if (d.isDirectory()) return { name: d.name, path: full, kind: 'dir' }
        if (d.isFile()) return { name: d.name, path: full, kind: 'file' }
        return null
      })
    )
    return entries
      .filter((e): e is FileEntry => e !== null)
      .sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1))
  }

  async readFile(file: string): Promise<FileContent> {
    let st: fs.Stats
    try {
      st = await fsp.stat(file)
    } catch {
      return { path: file, kind: 'missing', text: '', encoding: 'utf8', eol: 'LF', size: 0, mtimeMs: 0 }
    }
    const base = { path: file, size: st.size, mtimeMs: st.mtimeMs }
    const ext = path.extname(file).toLowerCase()
    if (IMAGE_EXT.has(ext) && ext !== '.svg') return { ...base, kind: 'image', text: '', encoding: 'utf8', eol: 'LF' }
    if (st.size > MAX_TEXT_BYTES) return { ...base, kind: 'too-large', text: '', encoding: 'utf8', eol: 'LF' }
    const buf = await fsp.readFile(file)
    const d = decodeBuffer(buf)
    if (d.binary) return { ...base, kind: 'binary', text: '', encoding: 'utf8', eol: 'LF' }
    return { ...base, kind: ext === '.svg' ? 'image' : 'text', text: d.text, encoding: d.encoding, eol: d.eol }
  }

  async writeFile(file: string, text: string, opts: WriteFileOptions = {}): Promise<WriteResult> {
    if (opts.expectedMtimeMs !== undefined) {
      try {
        const st = await fsp.stat(file)
        if (Math.abs(st.mtimeMs - opts.expectedMtimeMs) > 1) return { ok: false, conflict: true, mtimeMs: st.mtimeMs }
      } catch {
        /* file vanished: writing recreates it */
      }
    }
    if (opts.createDirs) await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, encodeText(text, opts.encoding ?? 'utf8'))
    const st = await fsp.stat(file)
    return { ok: true, mtimeMs: st.mtimeMs }
  }

  async stat(file: string) {
    try {
      const st = await fsp.stat(file)
      return { exists: true, kind: st.isDirectory() ? ('dir' as const) : ('file' as const), size: st.size, mtimeMs: st.mtimeMs }
    } catch {
      return { exists: false, kind: null, size: 0, mtimeMs: 0 }
    }
  }

  async createFile(file: string): Promise<void> {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const handle = await fsp.open(file, 'wx')
    await handle.close()
  }

  async createDir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true })
  }

  async rename(from: string, to: string): Promise<void> {
    if (from.toLowerCase() !== to.toLowerCase() && fs.existsSync(to)) throw new Error(t('Already exists: {name}', { name: path.basename(to) }))
    await fsp.mkdir(path.dirname(to), { recursive: true })
    await fsp.rename(from, to)
  }

  async trash(target: string): Promise<void> {
    await shell.trashItem(target)
  }

  async copy(from: string, to: string): Promise<void> {
    let dest = to
    let n = 1
    while (fs.existsSync(dest)) {
      const ext = path.extname(to)
      dest = path.join(path.dirname(to), `${path.basename(to, ext)} salinan${n > 1 ? ` ${n}` : ''}${ext}`)
      n++
    }
    await fsp.cp(from, dest, { recursive: true, errorOnExist: true })
  }

  /** All files under root respecting .gitignore (ripgrep), used by Quick Open. */
  listFiles(root: string): Promise<string[]> {
    return new Promise((resolve) => {
      const files: string[] = []
      let buf = ''
      const rg = spawn(rgBinary(), ['--files', '--hidden', '--no-require-git', '-g', '!.git', '-g', '!node_modules', '--no-messages', '.'], { cwd: root, windowsHide: true })
      rg.stdout.setEncoding('utf8')
      rg.stdout.on('data', (chunk: string) => {
        buf += chunk
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() ?? ''
        for (const l of lines) if (l) files.push(path.join(root, l))
        if (files.length > 60000) rg.kill()
      })
      rg.on('error', () => resolve(files))
      rg.on('close', () => {
        if (buf) files.push(path.join(root, buf))
        resolve(files)
      })
    })
  }
}
