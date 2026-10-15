// Diagnostic: ask a claude.exe which models / effort levels it offers, without sending a prompt.
// usage: node scripts/models-probe.mjs <claude.exe>
import { query } from '@anthropic-ai/claude-agent-sdk'

const [exe] = process.argv.slice(2)
const env = { ...process.env }
for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_.+|CLAUDE_AGENT_SDK_.+|CLAUDE_PID|ANTHROPIC_BASE_URL)$/i.test(k)) delete env[k]
const idle = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }
const t0 = Date.now()
const q = query({
  prompt: idle,
  options: { pathToClaudeCodeExecutable: exe, persistSession: false, strictMcpConfig: true, mcpServers: {}, settingSources: ['user'], env }
})
const timer = setTimeout(() => {
  console.log('TIMEOUT')
  process.exit(2)
}, 60000)
try {
  const init = await q.initializationResult?.().catch((e) => ({ error: String(e) }))
  console.log('init keys:', init ? Object.keys(init) : null, `${Date.now() - t0}ms`)
  const models = await q.supportedModels()
  console.log(JSON.stringify(models, null, 1))
  if (init?.models) console.log('init.models same?', JSON.stringify(init.models) === JSON.stringify(models))
  for (const k of ['commands', 'output_style', 'available_output_styles', 'account', 'fast_mode_state']) if (init && k in init) console.log(k, JSON.stringify(init[k]).slice(0, 300))
} finally {
  clearTimeout(timer)
  q.close()
}
console.log(`done ${Date.now() - t0}ms`)
