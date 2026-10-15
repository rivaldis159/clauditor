import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { shell } from 'electron'
import type { GitBranch, GitCode, GitCommitInfo, GitFileStatus, GitResult, GitStatus } from '@shared/types'
import { t } from '../i18n'

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(cwd: string, args: string[], input?: string, timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LANG: 'en_US.UTF-8' }
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => err.push(b))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: '', stderr: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

const code = (c: string): GitCode => (c === '.' ? ' ' : (c as GitCode))

/** Parse `git status --porcelain=v2 --branch -z`. Exported for tests. */
export function parsePorcelainV2(output: string, repoRoot: string): Omit<GitStatus, 'isRepo' | 'root' | 'error'> {
  const status: Omit<GitStatus, 'isRepo' | 'root' | 'error'> = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [] }
  const parts = output.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]
    if (!rec) continue
    if (rec.startsWith('# ')) {
      const [, key, ...rest] = rec.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.head') {
        status.detached = value === '(detached)'
        status.branch = status.detached ? null : value
      } else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const m = /\+(\d+) -(\d+)/.exec(value)
        if (m) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      }
      continue
    }
    const kind = rec[0]
    if (kind === '1' || kind === '2') {
      const fields = rec.split(' ')
      const xy = fields[1]
      const rel = fields.slice(kind === '1' ? 8 : 9).join(' ')
      const file: GitFileStatus = { path: path.join(repoRoot, rel), relPath: rel, index: code(xy[0]), worktree: code(xy[1]), conflicted: false }
      if (kind === '2') {
        const orig = parts[++i]
        if (orig) file.origPath = path.join(repoRoot, orig)
      }
      status.files.push(file)
    } else if (kind === 'u') {
      const fields = rec.split(' ')
      const rel = fields.slice(10).join(' ')
      status.files.push({ path: path.join(repoRoot, rel), relPath: rel, index: 'U', worktree: 'U', conflicted: true })
    } else if (kind === '?') {
      const rel = rec.slice(2)
      status.files.push({ path: path.join(repoRoot, rel), relPath: rel, index: '?', worktree: '?', conflicted: false })
    }
  }
  return status
}

function result(r: RunResult): GitResult {
  return { ok: r.code === 0, output: (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() }
}

export class GitService {
  private rootCache = new Map<string, string | null>()

  async repoRoot(dir: string): Promise<string | null> {
    if (this.rootCache.has(dir)) return this.rootCache.get(dir) ?? null
    const r = await run(dir, ['rev-parse', '--show-toplevel'])
    const root = r.code === 0 ? path.normalize(r.stdout.trim()) : null
    this.rootCache.set(dir, root)
    return root
  }

  invalidate(dir?: string): void {
    if (dir) this.rootCache.delete(dir)
    else this.rootCache.clear()
  }

  async status(dir: string): Promise<GitStatus> {
    if (!fs.existsSync(dir)) return { isRepo: false, root: null, branch: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [] }
    const root = await this.repoRoot(dir)
    if (!root) return { isRepo: false, root: null, branch: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [] }
    const r = await run(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
    if (r.code !== 0) {
      return { isRepo: true, root, branch: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [], error: r.stderr.trim() }
    }
    return { isRepo: true, root, ...parsePorcelainV2(r.stdout, root) }
  }

  private rel(root: string, paths: string[]): string[] {
    return paths.map((p) => path.relative(root, p) || '.')
  }

  async stage(dir: string, paths: string[]): Promise<GitResult> {
    const root = await this.repoRoot(dir)
    if (!root) return { ok: false, output: t('Not a git repository') }
    return result(await run(root, ['add', '-A', '--', ...this.rel(root, paths)]))
  }

  async unstage(dir: string, paths: string[]): Promise<GitResult> {
    const root = await this.repoRoot(dir)
    if (!root) return { ok: false, output: t('Not a git repository') }
    const hasHead = (await run(root, ['rev-parse', '--verify', 'HEAD'])).code === 0
    const args = hasHead ? ['restore', '--staged', '--', ...this.rel(root, paths)] : ['rm', '--cached', '-r', '-q', '--', ...this.rel(root, paths)]
    return result(await run(root, args))
  }

  async discard(dir: string, paths: string[]): Promise<GitResult> {
    const root = await this.repoRoot(dir)
    if (!root) return { ok: false, output: t('Not a git repository') }
    const st = await this.status(root)
    const untracked = new Set(st.files.filter((f) => f.index === '?').map((f) => f.path.toLowerCase()))
    const tracked = paths.filter((p) => !untracked.has(p.toLowerCase()))
    const outputs: string[] = []
    let ok = true
    if (tracked.length) {
      const r = await run(root, ['restore', '--worktree', '--source=HEAD', '--', ...this.rel(root, tracked)])
      ok = r.code === 0
      outputs.push(result(r).output)
    }
    for (const p of paths.filter((x) => untracked.has(x.toLowerCase()))) {
      try {
        await shell.trashItem(p)
      } catch (e) {
        ok = false
        outputs.push(String(e))
      }
    }
    return { ok, output: outputs.filter(Boolean).join('\n') }
  }

  async commit(dir: string, message: string, opts: { amend?: boolean; all?: boolean } = {}): Promise<GitResult> {
    const root = await this.repoRoot(dir)
    if (!root) return { ok: false, output: t('Not a git repository') }
    const args = ['commit', '-F', '-']
    if (opts.amend) args.push('--amend')
    if (opts.all) args.push('-a')
    return result(await run(root, args, message))
  }

  async branches(dir: string): Promise<GitBranch[]> {
    const root = await this.repoRoot(dir)
    if (!root) return []
    const r = await run(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%09%(HEAD)%09%(upstream:short)%09%(subject)', 'refs/heads', 'refs/remotes'])
    if (r.code !== 0) return []
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, head, upstream, subject] = line.split('\t')
        const remote = ref.startsWith('refs/remotes/')
        const name = ref.replace(/^refs\/(heads|remotes)\//, '')
        return { name, current: head === '*', remote, upstream: upstream || undefined, lastCommit: subject }
      })
      .filter((b) => !b.name.endsWith('/HEAD'))
  }

  async checkout(dir: string, branch: string, create = false): Promise<GitResult> {
    const root = await this.repoRoot(dir)
    if (!root) return { ok: false, output: t('Not a git repository') }
    const args = create ? ['checkout', '-b', branch] : ['checkout', branch.replace(/^origin\//, '')]
    return result(await run(root, args))
  }

  async show(dir: string, file: string, ref: string): Promise<string | null> {
    const root = await this.repoRoot(dir)
    if (!root) return null
    const rel = path.relative(root, file).split(path.sep).join('/')
    const spec = ref === ':0' ? `:0:${rel}` : `${ref}:${rel}`
    const r = await run(root, ['show', spec])
    return r.code === 0 ? r.stdout : null
  }

  async log(dir: string, limit: number): Promise<GitCommitInfo[]> {
    const root = await this.repoRoot(dir)
    if (!root) return []
    const r = await run(root, ['log', `-n${limit}`, '--format=%H%x09%h%x09%an%x09%at%x09%s'])
    if (r.code !== 0) return []
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, shortHash, author, at, ...subject] = l.split('\t')
        return { hash, shortHash, author, date: Number(at) * 1000, subject: subject.join('\t') }
      })
  }

  async sync(dir: string, action: 'fetch' | 'pull' | 'push'): Promise<GitResult> {
    const root = await this.repoRoot(dir)
    if (!root) return { ok: false, output: t('Not a git repository') }
    if (action === 'push') {
      const st = await this.status(root)
      if (!st.upstream && st.branch) return result(await run(root, ['push', '-u', 'origin', st.branch], undefined, 180_000))
    }
    return result(await run(root, [action], undefined, 180_000))
  }

  async init(dir: string): Promise<GitResult> {
    this.invalidate(dir)
    return result(await run(dir, ['init']))
  }

  async diff(dir: string, staged: boolean): Promise<string> {
    const root = await this.repoRoot(dir)
    if (!root) return ''
    const r = await run(root, ['diff', '--no-color', ...(staged ? ['--staged'] : [])])
    return r.stdout
  }
}
