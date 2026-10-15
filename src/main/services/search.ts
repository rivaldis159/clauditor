import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { rgPath } from '@vscode/ripgrep'
import type { SearchDone, SearchFileResult, SearchMatch, SearchProgress, SearchQuery } from '@shared/types'
import { decodeBuffer, encodeText } from '../lib/text-codec'
import { unpacked } from '../lib/paths'

export function rgBinary(): string {
  return unpacked(rgPath)
}

const PREVIEW_BEFORE = 40
const PREVIEW_MAX = 220

function splitGlobs(s: string): string[] {
  return s
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
}

function byteToCharIndex(line: string, byteOffset: number): number {
  return Buffer.from(line, 'utf8').subarray(0, byteOffset).toString('utf8').length
}

export function buildRegex(q: Pick<SearchQuery, 'query' | 'isRegex' | 'matchCase' | 'wholeWord'>): RegExp {
  let src = q.isRegex ? q.query : q.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (q.wholeWord) src = `\\b${src}\\b`
  return new RegExp(src, q.matchCase ? 'gu' : 'giu')
}

export class SearchService extends EventEmitter {
  private running = new Map<string, ChildProcess>()

  start(q: SearchQuery): string {
    const id = randomUUID()
    const started = Date.now()
    const max = q.maxResults ?? 20000
    // --no-require-git: honour .gitignore even in folders that are not (yet) git repositories
    const args = ['--json', '--hidden', '--no-require-git', '--max-columns', '2000', '--max-filesize', '8M', '-g', '!.git', '-g', '!node_modules']
    if (!q.isRegex) args.push('--fixed-strings')
    args.push(q.matchCase ? '--case-sensitive' : '--ignore-case')
    if (q.wholeWord) args.push('--word-regexp')
    for (const g of splitGlobs(q.include)) args.push('-g', g)
    for (const g of splitGlobs(q.exclude)) args.push('-g', `!${g}`)
    args.push('--', q.query, '.')

    const rg = spawn(rgBinary(), args, { cwd: q.root, windowsHide: true })
    this.running.set(id, rg)
    let buf = ''
    let batch: SearchFileResult[] = []
    let current: SearchFileResult | null = null
    let totalMatches = 0
    let totalFiles = 0
    let limitHit = false
    let stderr = ''
    let flushTimer: NodeJS.Timeout | null = null

    const flush = () => {
      flushTimer = null
      if (batch.length === 0) return
      const payload: SearchProgress = { searchId: id, files: batch }
      batch = []
      this.emit('progress', payload)
    }
    const schedule = () => {
      if (!flushTimer) flushTimer = setTimeout(flush, 60)
    }

    const handle = (line: string) => {
      if (!line) return
      let msg: { type: string; data: Record<string, any> }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.type === 'begin') {
        current = { path: path.join(q.root, String(msg.data.path?.text ?? '').replace(/^\.[\\/]/, '')), matches: [] }
      } else if (msg.type === 'match' && current) {
        const text: string = msg.data.lines?.text ?? ''
        const lineText = text.replace(/\r?\n$/, '')
        for (const sm of msg.data.submatches ?? []) {
          if (totalMatches >= max) {
            limitHit = true
            break
          }
          const col = byteToCharIndex(lineText, sm.start)
          const len = byteToCharIndex(lineText, sm.end) - col
          const from = Math.max(0, col - PREVIEW_BEFORE)
          const lead = lineText.slice(from, col).replace(/^\s+/, '')
          const preview = (lead + lineText.slice(col, col + PREVIEW_MAX)).slice(0, PREVIEW_MAX)
          const match: SearchMatch = { line: msg.data.line_number, column: col + 1, length: Math.max(len, 0), preview, previewOffset: lead.length }
          current.matches.push(match)
          totalMatches++
        }
        if (limitHit) rg.kill()
      } else if (msg.type === 'end' && current) {
        if (current.matches.length) {
          batch.push(current)
          totalFiles++
          schedule()
        }
        current = null
      }
    }

    rg.stdout!.setEncoding('utf8')
    rg.stdout!.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) handle(l)
    })
    rg.stderr!.setEncoding('utf8')
    rg.stderr!.on('data', (c: string) => (stderr += c))
    const finish = (error?: string) => {
      if (!this.running.has(id)) return
      this.running.delete(id)
      if (buf) handle(buf)
      if (flushTimer) clearTimeout(flushTimer)
      flush()
      const done: SearchDone = {
        searchId: id,
        totalMatches,
        totalFiles,
        limitHit,
        elapsedMs: Date.now() - started,
        error: error ?? (stderr && totalMatches === 0 && /regex parse error|error parsing/i.test(stderr) ? stderr.trim().split('\n').slice(-3).join('\n') : undefined)
      }
      this.emit('done', done)
    }
    rg.on('error', (err) => finish(err.message))
    rg.on('close', () => finish())
    return id
  }

  cancel(id: string): void {
    const p = this.running.get(id)
    if (p) p.kill()
  }

  async replaceInFile(file: string, q: SearchQuery, replacement: string): Promise<number> {
    const buf = await fsp.readFile(file)
    const d = decodeBuffer(buf)
    if (d.binary) return 0
    const re = buildRegex(q)
    let count = 0
    const next = d.text.replace(re, (...m) => {
      count++
      if (!q.isRegex) return replacement
      // honour $1 style references when searching with a regex
      const groups = m.slice(1, -2) as string[]
      return replacement.replace(/\$(\d+)/g, (_s, n) => groups[Number(n) - 1] ?? '')
    })
    if (count > 0) await fsp.writeFile(file, encodeText(next, d.encoding))
    return count
  }
}
