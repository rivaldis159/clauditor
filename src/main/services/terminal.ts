import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import type { TerminalCreateOptions, TerminalInfo, TerminalProfile, TerminalProfileId } from '@shared/types'
import { t } from '../i18n'

interface Session {
  info: TerminalInfo
  proc: pty.IPty
  buffer: string
  timer: NodeJS.Timeout | null
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) if (p && fs.existsSync(p)) return p
  return null
}

export class TerminalService extends EventEmitter {
  private sessions = new Map<string, Session>()
  private counter = 0

  constructor(
    private readonly claudePath: () => string | null,
    private readonly extraEnv: () => Record<string, string>
  ) {
    super()
  }

  profiles(): TerminalProfile[] {
    const sys = process.env.SystemRoot || 'C:\\Windows'
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const local = process.env.LOCALAPPDATA || ''
    const pwsh = firstExisting([path.join(pf, 'PowerShell', '7', 'pwsh.exe'), path.join(local, 'Microsoft', 'WindowsApps', 'pwsh.exe')])
    const winps = path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const cmd = process.env.ComSpec || path.join(sys, 'System32', 'cmd.exe')
    const bash = firstExisting([path.join(pf, 'Git', 'bin', 'bash.exe'), path.join(local, 'Programs', 'Git', 'bin', 'bash.exe')])
    const claude = this.claudePath()
    return [
      { id: 'pwsh', label: 'PowerShell 7', path: pwsh ?? '', args: ['-NoLogo'], available: !!pwsh },
      { id: 'powershell', label: 'Windows PowerShell', path: winps, args: ['-NoLogo'], available: fs.existsSync(winps) },
      { id: 'cmd', label: 'Command Prompt', path: cmd, args: [], available: fs.existsSync(cmd) },
      { id: 'bash', label: 'Git Bash', path: bash ?? '', args: ['--login', '-i'], available: !!bash },
      { id: 'claude', label: 'Claude Code (CLI)', path: claude ?? '', args: [], available: !!claude }
    ]
  }

  defaultProfile(pref: string): TerminalProfileId {
    const list = this.profiles()
    const wanted = list.find((p) => p.id === pref && p.available)
    if (wanted) return wanted.id
    return (list.find((p) => p.id === 'pwsh' && p.available) ?? list.find((p) => p.id === 'powershell' && p.available) ?? list[2]).id
  }

  create(opts: TerminalCreateOptions, preferredShell: string): TerminalInfo {
    const profileId = opts.profile ?? this.defaultProfile(preferredShell)
    const profile = this.profiles().find((p) => p.id === profileId && p.available)
    if (!profile) throw new Error(t('Terminal profile not available: {id}', { id: profileId }))
    const cwd = fs.existsSync(opts.cwd) ? opts.cwd : process.env.USERPROFILE || process.cwd()
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ATTACH_CONSOLE
    Object.assign(env, { TERM_PROGRAM: 'clauditor', COLORTERM: 'truecolor', TERM: 'xterm-256color' }, this.extraEnv())

    const proc = pty.spawn(profile.path, [...profile.args, ...(opts.extraArgs ?? [])], {
      name: 'xterm-256color',
      cols: Math.max(2, opts.cols),
      rows: Math.max(1, opts.rows),
      cwd,
      env,
      useConpty: true
    })
    const id = randomUUID()
    this.counter++
    const short: Record<TerminalProfileId, string> = { pwsh: 'pwsh', powershell: 'PowerShell', cmd: 'cmd', bash: 'bash', claude: 'Claude Code' }
    const info: TerminalInfo = { id, pid: proc.pid, name: opts.name ?? short[profile.id], cwd, profile: profile.id }
    const s: Session = { info, proc, buffer: '', timer: null }
    proc.onData((data) => {
      s.buffer += data
      if (!s.timer) {
        s.timer = setTimeout(() => {
          s.timer = null
          const chunk = s.buffer
          s.buffer = ''
          if (chunk) this.emit('data', { id, data: chunk })
        }, 6)
      }
    })
    proc.onExit(({ exitCode }) => {
      if (s.timer) clearTimeout(s.timer)
      if (s.buffer) this.emit('data', { id, data: s.buffer })
      this.sessions.delete(id)
      this.emit('exit', { id, exitCode })
    })
    this.sessions.set(id, s)
    return info
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.proc.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)))
    } catch {
      /* pty already gone */
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.proc.kill()
    } catch {
      /* ignore */
    }
    this.sessions.delete(id)
  }

  list(): TerminalInfo[] {
    return [...this.sessions.values()].map((s) => s.info)
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
