import { useEffect, useState } from 'react'
import { FolderSearch, Moon, Monitor, RefreshCw, RotateCcw, Sun } from 'lucide-react'
import type { Accent, DeepPartial, Effort, ModelOption, PermissionMode, Settings, ThemeSetting } from '@shared/types'
import { defaultSettings } from '@shared/defaults'
import { LOCALES, type Locale } from '@shared/i18n'
import { allCommands, prettyKeys } from '@/lib/commands'
import { tk, useT, type T } from '@/lib/i18n'
import { ago, compact } from '@/lib/format'
import { claudeFontsActive } from '@/lib/claudeFonts'
import { claudeText, defaultModel as resolveDefaultModel, effortHint, effortName, settingSourceLabel, shortModelLabel } from '@/lib/claudeInfo'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/state/app'
import { loginClaude, useSessions } from '@/state/sessions'
import { effortsFor, modelFor, useClaude, useClaudeDefaults } from '@/state/claude'
import { useTerminals } from '@/state/terminals'
import { MODES } from '@/components/agent/Composer'

type Section = 'tampilan' | 'editor' | 'terminal' | 'claude' | 'berkas' | 'pintasan' | 'tentang'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'tampilan', label: tk('Appearance') },
  { id: 'editor', label: tk('Editor') },
  { id: 'terminal', label: tk('Terminal') },
  { id: 'claude', label: tk('Claude') },
  { id: 'berkas', label: tk('Files') },
  { id: 'pintasan', label: tk('Keyboard shortcuts') },
  { id: 'tentang', label: tk('About') }
]

function Row({ label, hint, children, wide, monoHint }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean; monoHint?: boolean }) {
  return (
    <div className={`set-row${wide ? ' wide' : ''}`}>
      <div className="set-text">
        <div className="set-label">{label}</div>
        {hint && <div className={`set-hint${monoHint ? ' mono' : ''}`}>{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

function authLabel(t: T, method: string | null): string {
  if (!method) return t('Signed in.')
  if (/claude|oauth|subscription/i.test(method)) return t('Signed in with a Claude account.')
  if (/api|console|key/i.test(method)) return t('Signed in with an Anthropic API key.')
  return t('Signed in ({method}).', { method })
}

function levelLabel(t: T, level: string): string {
  return level ? effortName(t, level) : t('Model default')
}

/** Every model Claude Code offers, with its context window and effort levels. */
function ModelTable({ models }: { models: ModelOption[] }) {
  const t = useT()
  const rows = models.filter((m) => m.value)
  if (!rows.length) return <span className="set-v">—</span>
  return (
    <table className="set-models">
      <thead>
        <tr>
          <th>{t('Model')}</th>
          <th>{t('Context window')}</th>
          <th>{t('Effort levels')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.value}>
            <td>
              <div className="set-model-name">{shortModelLabel(m.label)}</div>
              {m.description && <div className="set-model-desc">{claudeText(t, m.description)}</div>}
            </td>
            <td className="num">{m.contextWindow ? t('{n} tokens', { n: compact(m.contextWindow) }) : '—'}</td>
            <td>{m.effortLevels?.length ? m.effortLevels.map((l) => effortName(t, l)).join(', ') : t('None')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange(v: boolean): void }) {
  return <input type="checkbox" className="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
}

function NumberInput({ value, min, max, step = 1, onChange }: { value: number; min: number; max: number; step?: number; onChange(v: number): void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      className="input set-number"
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Math.min(max, Math.max(min, Number(text) || value))
        setText(String(n))
        if (n !== value) onChange(n)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

function TextInput({ value, placeholder, onChange, mono }: { value: string; placeholder?: string; onChange(v: string): void; mono?: boolean }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      className={`input set-text-input${mono ? ' mono' : ''}`}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: 'orange', label: tk('Ember'), color: '#ff7a3d' },
  { id: 'blue', label: tk('Blue'), color: '#5b9dff' },
  { id: 'violet', label: tk('Violet'), color: '#a98bff' },
  { id: 'green', label: tk('Green'), color: '#4fcf8a' },
  { id: 'rose', label: tk('Rose'), color: '#ff6f91' }
]

export function SettingsPage() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const info = useApp((s) => s.info)
  const ide = useApp((s) => s.ide)
  const env = useClaude((s) => s.env)
  const checkingClaude = useClaude((s) => s.checking)
  const models = env?.models ?? []
  const auth = useSessions((s) => s.auth)
  const [checkingAuth, setCheckingAuth] = useState(false)
  const profiles = useTerminals((s) => s.profiles)
  const [section, setSection] = useState<Section>('tampilan')
  const [filter, setFilter] = useState('')
  const update = (patch: DeepPartial<Settings>) => void useApp.getState().updateSettings(patch)
  const e = settings.editor
  const term = settings.terminal
  const c = settings.claude
  const d = defaultSettings()
  const modeHint = MODES.find((m) => m.value === c.defaultPermissionMode)?.hint
  const defaultModel = modelFor(models, c.defaultModel)
  const defaultEfforts = effortsFor(models, c.defaultModel)
  const claudeDefaults = useClaudeDefaults(null)
  const picked = resolveDefaultModel(models, claudeDefaults)
  const pickedLabel = picked.value ? shortModelLabel(picked.value.label) : picked.id
  const defaultModelHint = c.defaultModel
    ? defaultModel?.description
      ? claudeText(t, defaultModel.description)
      : t('For sessions started from Clauditor.')
    : pickedLabel
      ? picked.source
        ? t('Claude Code decides: {model}, set in {source}.', { model: pickedLabel, source: settingSourceLabel(t, picked.source) })
        : t("Claude Code decides: {model}, its recommendation.", { model: pickedLabel })
      : t('For sessions started from Clauditor.')

  return (
    <div className="page settings">
      <nav className="set-nav">
        <div className="set-nav-title">{t('Settings')}</div>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`set-nav-item${section === s.id ? ' active' : ''}`} onClick={() => setSection(s.id)}>
            {t(s.label)}
          </button>
        ))}
      </nav>
      <div className="set-body">
        {section === 'tampilan' && (
          <>
            <h2>{t('Appearance')}</h2>
            <Row label={t('Language')} hint={t('Language of the Clauditor interface.')}>
              <select className="input set-select" value={settings.language} onChange={(ev) => update({ language: ev.target.value as Locale })}>
                {LOCALES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('Theme')} hint={t('System follows the Windows dark/light mode.')}>
              <div className="seg">
                {(
                  [
                    ['dark', t('Dark'), Moon],
                    ['light', t('Light'), Sun],
                    ['system', t('System'), Monitor]
                  ] as [ThemeSetting, string, typeof Moon][]
                ).map(([id, label, Icon]) => (
                  <button key={id} className={`seg-btn${settings.theme === id ? ' on' : ''}`} onClick={() => update({ theme: id })}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label={t('Accent color')} hint={t('Used for highlights, the cursor, and Claude activity markers.')}>
              <div className="accent-picks">
                {ACCENTS.map((a) => (
                  <button key={a.id} className={`accent-pick${settings.accent === a.id ? ' on' : ''}`} onClick={() => update({ accent: a.id })} data-tip={t(a.label)}>
                    <span style={{ background: a.color }} />
                  </button>
                ))}
              </div>
            </Row>
            <Row label={t('Interface text size')} hint={t('Text size of menus, panels, and the sidebar, in pixels.')}>
              <NumberInput value={settings.uiFontSize} min={11} max={16} onChange={(v) => update({ uiFontSize: v })} />
            </Row>
          </>
        )}

        {section === 'editor' && (
          <>
            <h2>{t('Editor')}</h2>
            <Row label={t('Font family')} hint={t('Comma-separated list of fonts; JetBrains Mono is included.')}>
              <TextInput value={e.fontFamily} onChange={(v) => update({ editor: { fontFamily: v || d.editor.fontFamily } })} mono />
            </Row>
            <Row label={t('Font size')}>
              <NumberInput value={e.fontSize} min={9} max={32} onChange={(v) => update({ editor: { fontSize: v } })} />
            </Row>
            <Row label={t('Line height')} hint={t('In pixels.')}>
              <NumberInput value={e.lineHeight} min={12} max={48} onChange={(v) => update({ editor: { lineHeight: v } })} />
            </Row>
            <Row label={t('Tab size')} hint={t("Used when a file's indentation can't be detected automatically.")}>
              <NumberInput value={e.tabSize} min={1} max={8} onChange={(v) => update({ editor: { tabSize: v } })} />
            </Row>
            <Row label={t('Indent with spaces')}>
              <Toggle value={e.insertSpaces} onChange={(v) => update({ editor: { insertSpaces: v } })} />
            </Row>
            <Row label={t('Word wrap')}>
              <Toggle value={e.wordWrap === 'on'} onChange={(v) => update({ editor: { wordWrap: v ? 'on' : 'off' } })} />
            </Row>
            <Row label={t('Minimap')}>
              <Toggle value={e.minimap} onChange={(v) => update({ editor: { minimap: v } })} />
            </Row>
            <Row label={t('Line numbers')}>
              <select className="input set-select" value={e.lineNumbers} onChange={(ev) => update({ editor: { lineNumbers: ev.target.value as 'on' | 'relative' | 'off' } })}>
                <option value="on">{t('Shown')}</option>
                <option value="relative">{t('Relative')}</option>
                <option value="off">{t('Hidden')}</option>
              </select>
            </Row>
            <Row label={t('Show whitespace')}>
              <select className="input set-select" value={e.renderWhitespace} onChange={(ev) => update({ editor: { renderWhitespace: ev.target.value as Settings['editor']['renderWhitespace'] } })}>
                <option value="none">{t('None')}</option>
                <option value="selection">{t('In selection')}</option>
                <option value="boundary">{t('At boundaries')}</option>
                <option value="all">{t('All')}</option>
              </select>
            </Row>
            <Row label={t('Font ligatures')} hint={t('Combine symbols such as => and !== into a single glyph.')}>
              <Toggle value={e.fontLigatures} onChange={(v) => update({ editor: { fontLigatures: v } })} />
            </Row>
            <Row label={t('Auto save')} hint={t("Clauditor won't overwrite Claude's changes: saving stops when the file changes on disk.")}>
              <select className="input set-select" value={e.autoSave} onChange={(ev) => update({ editor: { autoSave: ev.target.value as Settings['editor']['autoSave'] } })}>
                <option value="off">{t('Off')}</option>
                <option value="afterDelay">{t('After delay')}</option>
                <option value="onFocusChange">{t('On focus change')}</option>
              </select>
            </Row>
            {e.autoSave === 'afterDelay' && (
              <Row label={t('Auto save delay')} hint={t('In milliseconds.')}>
                <NumberInput value={e.autoSaveDelay} min={300} max={10000} step={100} onChange={(v) => update({ editor: { autoSaveDelay: v } })} />
              </Row>
            )}
            <Row label={t('Format on save')}>
              <Toggle value={e.formatOnSave} onChange={(v) => update({ editor: { formatOnSave: v } })} />
            </Row>
            <Row label={t('Sticky scroll')} hint={t('Block headers (functions, classes) stay visible while scrolling.')}>
              <Toggle value={e.stickyScroll} onChange={(v) => update({ editor: { stickyScroll: v } })} />
            </Row>
            <Row label={t('Smooth scrolling')}>
              <Toggle value={e.smoothScrolling} onChange={(v) => update({ editor: { smoothScrolling: v } })} />
            </Row>
            <Row label={t('Bracket pair colorization')}>
              <Toggle value={e.bracketPairColorization} onChange={(v) => update({ editor: { bracketPairColorization: v } })} />
            </Row>
            <Row label={t('Git change markers in the gutter')}>
              <Toggle value={e.gitGutter} onChange={(v) => update({ editor: { gitGutter: v } })} />
            </Row>
          </>
        )}

        {section === 'terminal' && (
          <>
            <h2>{t('Terminal')}</h2>
            <Row label={t('Default shell')}>
              <select className="input set-select" value={term.shell} onChange={(ev) => update({ terminal: { shell: ev.target.value } })}>
                <option value="auto">{t('Automatic (PowerShell)')}</option>
                {profiles
                  .filter((p) => p.available && p.id !== 'claude')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </Row>
            <Row label={t('Font family')}>
              <TextInput value={term.fontFamily} onChange={(v) => update({ terminal: { fontFamily: v || d.terminal.fontFamily } })} mono />
            </Row>
            <Row label={t('Font size')}>
              <NumberInput value={term.fontSize} min={9} max={28} onChange={(v) => update({ terminal: { fontSize: v } })} />
            </Row>
            <Row label={t('Blinking cursor')}>
              <Toggle value={term.cursorBlink} onChange={(v) => update({ terminal: { cursorBlink: v } })} />
            </Row>
          </>
        )}

        {section === 'claude' && (
          <>
            <h2>{t('Claude')}</h2>
            <Row label="Claude Code" hint={info?.claudeExe ? info.claudeExe.path : t('Not found. Install Claude desktop or choose claude.exe manually.')} wide monoHint={!!info?.claudeExe}>
              <div className="set-inline">
                <span className={`chip${info?.claudeExe ? ' ok-chip' : ' warn-chip'}`}>
                  {info?.claudeExe ? `${info.claudeExe.source === 'desktop' ? t('From Claude desktop') : info.claudeExe.source === 'settings' ? t('Manual') : 'PATH'} ${info.claudeExe.version ?? ''}` : t('Not found')}
                </span>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    const f = await invoke('app:pickFile', t('Choose claude.exe'))
                    if (f) {
                      update({ claude: { executablePath: f } })
                      useApp.setState({ info: await invoke('app:info') })
                    }
                  }}
                >
                  <FolderSearch size={13} /> {t('Browse…')}
                </button>
                {c.executablePath && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      update({ claude: { executablePath: '' } })
                      useApp.setState({ info: await invoke('app:info') })
                    }}
                  >
                    <RotateCcw size={13} /> {t('Auto-detect')}
                  </button>
                )}
              </div>
            </Row>
            <Row
              label={t('Claude Code sign-in')}
              hint={
                auth?.loggedIn
                  ? `${authLabel(t, auth.method)} ${t('You can run Claude directly from the Clauditor panel.')}`
                  : auth?.loggedIn === false
                    ? t('Not signed in. Required to run Claude from Clauditor, but not to follow Claude desktop sessions.')
                    : t('Sign-in status unknown.')
              }
              wide
            >
              <div className="set-inline">
                <span className={`chip${auth?.loggedIn ? ' ok-chip' : auth?.loggedIn === false ? ' warn-chip' : ''}`}>{auth?.loggedIn ? t('Signed in') : auth?.loggedIn === false ? t('Not signed in') : t('Unknown')}</span>
                {!auth?.loggedIn && (
                  <button className="btn btn-sm btn-primary" onClick={() => void loginClaude()}>
                    {t('Sign in')}
                  </button>
                )}
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={checkingAuth}
                  onClick={async () => {
                    setCheckingAuth(true)
                    await useSessions.getState().checkAuth(true)
                    setCheckingAuth(false)
                  }}
                >
                  <RotateCcw size={13} /> {checkingAuth ? t('Checking…') : t('Check again')}
                </button>
              </div>
            </Row>
            <Row
              label={t('Claude integration')}
              hint={t('Read from Claude itself and checked again whenever Claude updates, so models, fonts and Claude Code stay in step with Claude desktop.')}
              wide
            >
              <div className="set-stack">
                <div className="set-kv">
                  <span className="set-k">{t('Claude desktop')}</span>
                  <span className="set-v">
                    {env?.desktop.version ? (
                      <>
                        {env.desktop.version}
                        <span className="set-v-note">{env.desktop.kind === 'msix' ? t('Microsoft Store') : t('Classic installer')}</span>
                      </>
                    ) : (
                      t('Not found')
                    )}
                  </span>
                  <span className="set-k">Claude Code</span>
                  <span className="set-v">{env?.cli.version ?? (env?.cli.path ? t('Unknown') : t('Not found'))}</span>
                  <span className="set-k">{t('Agent SDK')}</span>
                  <span className="set-v">
                    {env?.sdk.version ?? '—'}
                    {env && (
                      <span className="set-v-note">
                        {env.sdk.source === 'synced'
                          ? t('from npm, made for Claude Code {version}', { version: env.sdk.claudeCodeVersion ?? '' })
                          : env.sdk.source === 'bundled'
                            ? t('from node_modules (development)')
                            : t('downloaded from npm on first use')}
                      </span>
                    )}
                  </span>
                  <span className="set-k">{t('Fonts')}</span>
                  <span className="set-v">{claudeFontsActive() ? t("Claude's fonts (Anthropic Sans, Serif and Mono)") : t('Fallback fonts — Claude desktop not found')}</span>
                </div>
                <div className="set-inline">
                  <button className="btn btn-sm" disabled={checkingClaude} onClick={() => void useClaude.getState().refresh()}>
                    <RefreshCw size={13} className={checkingClaude ? 'spin' : undefined} /> {checkingClaude ? t('Checking…') : t('Check now')}
                  </button>
                  {env?.checkedAt ? <span className="set-v-note">{t('Last checked {when}', { when: ago(env.checkedAt) })}</span> : null}
                </div>
              </div>
            </Row>
            <Row label={t('Models')} hint={t('What Claude Code offers right now, read from Claude Code itself. The context window is how much of a conversation the model can keep in mind.')} wide>
              <ModelTable models={models} />
            </Row>
            <Row label={t('Keep the Agent SDK in sync with Claude')} hint={t("Claude's Agent SDK is fetched from npm on first use, and again whenever Claude desktop brings a newer Claude Code. Turn this off to keep the copy you have.")}>
              <Toggle value={c.syncSdk} onChange={(v) => update({ claude: { syncSdk: v } })} />
            </Row>
            <Row label={t('Default model')} hint={defaultModelHint}>
              <select className="input set-select" value={c.defaultModel} onChange={(ev) => update({ claude: { defaultModel: ev.target.value } })}>
                {(models.length ? models : [{ value: '', label: t('Default'), description: '' }]).map((m) => (
                  <option key={m.value || 'd'} value={m.value}>
                    {m.value ? m.label : t('Default (recommended)')}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('Default permission mode')} hint={modeHint && t(modeHint)}>
              <select className="input set-select" value={c.defaultPermissionMode} onChange={(ev) => update({ claude: { defaultPermissionMode: ev.target.value as PermissionMode } })}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {t(m.label)}
                  </option>
                ))}
              </select>
            </Row>
            <Row
              label={t('Default effort level')}
              hint={
                !defaultEfforts.length
                  ? t('The default model has no effort setting.')
                  : defaultEfforts.includes(c.defaultEffort)
                    ? effortHint(t, c.defaultEffort)
                    : t("How long Claude thinks before answering. Model default: the model's own level, or the one you saved with /effort in Claude Code.")
              }
            >
              <select
                className="input set-select"
                value={defaultEfforts.includes(c.defaultEffort) ? c.defaultEffort : ''}
                disabled={!defaultEfforts.length}
                onChange={(ev) => update({ claude: { defaultEffort: ev.target.value as Effort | '' } })}
              >
                {['', ...defaultEfforts].map((level) => (
                  <option key={level || 'd'} value={level}>
                    {levelLabel(t, level)}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('Follow running sessions')} hint={t('Follow mode turns on when you open a live session.')}>
              <Toggle value={c.followLive} onChange={(v) => update({ claude: { followLive: v } })} />
            </Row>
            <Row label={t('Open files Claude edits')} hint={t('While following, the file being edited opens automatically as a preview tab.')}>
              <Toggle value={c.followOpensFiles} onChange={(v) => update({ claude: { followOpensFiles: v } })} />
            </Row>
            <Row label={t('Typing animation')} hint={t("Claude's changes appear as if they were being typed in the editor.")}>
              <Toggle value={c.animateEdits} onChange={(v) => update({ claude: { animateEdits: v } })} />
            </Row>
            <Row label={t('Auto-follow Claude desktop sessions')} hint={t('When Claude desktop works in the open folder, Clauditor follows it right away.')}>
              <Toggle value={c.autoFollowWorkspace} onChange={(v) => update({ claude: { autoFollowWorkspace: v } })} />
            </Row>
            <Row label={t('Notify when Claude finishes')} hint={t("Shown when the Clauditor window isn't active.")}>
              <Toggle value={c.notifyOnIdle} onChange={(v) => update({ claude: { notifyOnIdle: v } })} />
            </Row>
            <Row
              label={t('Claude Code IDE bridge')}
              hint={
                ide?.enabled
                  ? t('Active on port {port}. Claude Code CLI can open diffs for approval and read the selection and diagnostics from Clauditor.', { port: ide.port ?? '' })
                  : t('Lets Claude Code CLI connect to Clauditor the way it connects to VS Code.')
              }
            >
              <Toggle value={c.ideBridge} onChange={(v) => update({ claude: { ideBridge: v } })} />
            </Row>
          </>
        )}

        {section === 'berkas' && (
          <>
            <h2>{t('Files')}</h2>
            <Row label={t('Hide from Explorer')} hint={t('Comma-separated file or folder names.')}>
              <TextInput
                value={settings.files.exclude.join(', ')}
                onChange={(v) =>
                  update({
                    files: {
                      exclude: v
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean)
                    }
                  })
                }
              />
            </Row>
            <Row label={t('Confirm before deleting')}>
              <Toggle value={settings.files.confirmDelete} onChange={(v) => update({ files: { confirmDelete: v } })} />
            </Row>
          </>
        )}

        {section === 'pintasan' && (
          <>
            <h2>{t('Keyboard shortcuts')}</h2>
            <input className="input set-filter" placeholder={t('Search commands…')} value={filter} onChange={(ev) => setFilter(ev.target.value)} />
            <div className="keys-table">
              {allCommands()
                .filter((cmd) => cmd.keys)
                .map((cmd) => ({ cmd, category: cmd.category ? t(cmd.category) : '', title: t(cmd.title) }))
                .filter((r) => `${r.category} ${r.title}`.toLowerCase().includes(filter.toLowerCase()))
                .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
                .map(({ cmd, category, title }) => (
                  <div key={cmd.id} className="keys-row">
                    <span className="keys-cat">{category}</span>
                    <span className="keys-title">{title}</span>
                    <span className="hint-keys">
                      {prettyKeys(cmd.keys).map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
            </div>
          </>
        )}

        {section === 'tentang' && (
          <>
            <h2>{t('About Clauditor')}</h2>
            <div className="about">
              <p>
                {t(
                  'Clauditor is a code editor dedicated to Claude Code: it follows Claude desktop sessions live, runs Claude Code with interactive permissions, and serves as an IDE for the Claude Code CLI.'
                )}
              </p>
              <p className="about-note">
                {t('Clauditor is an independent community project, not affiliated with, endorsed by, or sponsored by Anthropic. Claude, Claude Code and Claude desktop are trademarks of Anthropic, PBC.')}
              </p>
              <table className="viz-table">
                <tbody>
                  <tr>
                    <td>{t('Version')}</td>
                    <td>{info?.version}</td>
                  </tr>
                  <tr>
                    <td>{t('License')}</td>
                    <td>MIT</td>
                  </tr>
                  <tr>
                    <td>{t('Source code')}</td>
                    <td>
                      <button className="ws-link" onClick={() => void invoke('app:openExternal', 'https://github.com/rivaldis159/clauditor')}>
                        github.com/rivaldis159/clauditor
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>Electron / Chromium / Node</td>
                    <td>
                      {info?.electron} / {info?.chrome} / {info?.node}
                    </td>
                  </tr>
                  <tr>
                    <td>{t('Claude data')}</td>
                    <td className="mono">{info?.claudeHome}</td>
                  </tr>
                  <tr>
                    <td>{t('Clauditor data')}</td>
                    <td className="mono">{info?.userData}</td>
                  </tr>
                </tbody>
              </table>
              <div className="set-inline">
                <button className="btn btn-sm" onClick={() => info && void invoke('app:openPath', info.userData)}>
                  {t('Open Clauditor data folder')}
                </button>
                <button className="btn btn-sm" onClick={() => void invoke('app:windowAction', 'devtools')}>
                  {t('Developer tools')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
